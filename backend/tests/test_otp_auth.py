from datetime import timedelta
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy import select

from app.api.v1.dependencies import get_db
from app.main import app
from app.models import User, UserRole
from app.models.base import Base
from app.services.mail import get_emails_for_recipient


@pytest.mark.anyio
async def test_otp_password_reset_flow(monkeypatch: pytest.MonkeyPatch) -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    async def override_db():
        async with sessions() as session:
            yield session

    app.dependency_overrides[get_db] = override_db

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        test_email = "test-otp-user@example.com"
        initial_password = "initialPassword123!"
        new_password = "updatedSecurePassword456!"

        # 1. Register student
        reg_resp = await client.post(
            "/api/v1/auth/register/student",
            json={
                "email": test_email,
                "password": initial_password,
                "full_name": "OTP Tester",
                "university": "State University",
                "major": "Computer Science",
                "graduation_year": 2026,
            },
        )
        assert reg_resp.status_code == 201

        # 2. Trigger forgot password
        forgot_resp = await client.post("/api/v1/auth/forgot-password", json={"email": test_email})
        assert forgot_resp.status_code == 200

        # Verify email was captured in local mail log
        emails = get_emails_for_recipient(test_email)
        assert len(emails) >= 1
        latest_email = emails[0]
        assert "Password Reset" in latest_email["subject"] or "OTP" in latest_email["subject"]

        # Check OTP in database
        async with sessions() as session:
            user = await session.scalar(select(User).where(User.email == test_email))
            assert user is not None
            assert user.reset_token is not None
            assert len(user.reset_token) == 6
            assert user.reset_token.isdigit()
            otp = user.reset_token

        # 3. Test wrong OTP on /verify-otp
        wrong_otp_resp = await client.post(
            "/api/v1/auth/verify-otp",
            json={"email": test_email, "otp": "999999" if otp != "999999" else "111111"},
        )
        assert wrong_otp_resp.status_code == 400

        # 4. Test correct OTP on /verify-otp
        correct_otp_resp = await client.post(
            "/api/v1/auth/verify-otp",
            json={"email": test_email, "otp": otp},
        )
        assert correct_otp_resp.status_code == 200

        # 5. Query mailbox via public endpoint
        mailbox_public = await client.get(f"/api/v1/mailbox/public?email={test_email}")
        assert mailbox_public.status_code == 200
        assert len(mailbox_public.json()) >= 1
        assert any(otp in item.get("body", "") or otp in item.get("html", "") for item in mailbox_public.json())

        # 6. Reset password with email + OTP
        reset_resp = await client.post(
            "/api/v1/auth/reset-password",
            json={
                "email": test_email,
                "otp": otp,
                "new_password": new_password,
            },
        )
        assert reset_resp.status_code == 200
        assert reset_resp.json()["message"] == "Password reset successfully"

        # 7. Old password should fail login
        old_login = await client.post(
            "/api/v1/auth/login",
            json={"email": test_email, "password": initial_password},
        )
        assert old_login.status_code == 401

        # 8. New password should succeed login
        new_login = await client.post(
            "/api/v1/auth/login",
            json={"email": test_email, "password": new_password},
        )
        assert new_login.status_code == 200
        access_token = new_login.json()["access_token"]
        assert access_token is not None

        # 9. Query authenticated mailbox endpoint /api/v1/mailbox/my
        my_mailbox = await client.get(
            "/api/v1/mailbox/my",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        assert my_mailbox.status_code == 200
        assert len(my_mailbox.json()) >= 1
