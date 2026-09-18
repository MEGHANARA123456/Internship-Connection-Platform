from datetime import datetime, timedelta, timezone
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
async def test_mfa_full_lifecycle_and_regression() -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    async def override_db():
        async with sessions() as session:
            yield session

    app.dependency_overrides[get_db] = override_db

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # =====================================================================
        # 1. REGRESSION TEST: Existing user with mfa_enabled=False logs in normally
        # =====================================================================
        reg_user_email = "regular-user@example.com"
        reg_user_pass = "regularPassword123!"
        
        reg_resp = await client.post(
            "/api/v1/auth/register/student",
            json={
                "email": reg_user_email,
                "password": reg_user_pass,
                "full_name": "Regular Non-MFA Student",
                "university": "Tech State University",
                "major": "Computer Science",
                "graduation_year": 2026,
            },
        )
        assert reg_resp.status_code == 201

        # Manually activate and verify the user
        async with sessions() as session:
            reg_user = await session.scalar(select(User).where(User.email == reg_user_email))
            assert reg_user is not None
            reg_user.is_verified = True
            reg_user.mfa_enabled = False
            await session.commit()

        # Login without MFA
        login_reg_resp = await client.post(
            "/api/v1/auth/login",
            json={"email": reg_user_email, "password": reg_user_pass, "portal": "STUDENT"},
        )
        assert login_reg_resp.status_code == 200
        data_reg = login_reg_resp.json()
        assert "access_token" in data_reg
        assert "refresh_token" in data_reg
        assert data_reg.get("mfa_required") is False or "mfa_required" not in data_reg
        reg_token = data_reg["access_token"]
        headers_reg = {"Authorization": f"Bearer {reg_token}"}

        # Check MFA status
        status_reg_resp = await client.get("/api/v1/auth/mfa/status", headers=headers_reg)
        assert status_reg_resp.status_code == 200
        assert status_reg_resp.json()["mfa_enabled"] is False

        # =====================================================================
        # 2. MFA SETUP REQUEST: Request setup code and verify email delivery
        # =====================================================================
        setup_req_resp = await client.post("/api/v1/auth/mfa/setup-request", headers=headers_reg)
        assert setup_req_resp.status_code == 200
        assert "Verification code dispatched" in setup_req_resp.json()["message"]

        # Verify email was captured in Mailpit / memory log
        emails = get_emails_for_recipient(reg_user_email)
        assert len(emails) >= 1
        setup_email = [e for e in emails if "MFA Setup" in e["subject"] or "Two-Factor" in e["subject"]][-1]
        assert "confirmation code" in setup_email["body"].lower()

        # Retrieve OTP code from database
        async with sessions() as session:
            db_user = await session.scalar(select(User).where(User.email == reg_user_email))
            assert db_user.mfa_otp is not None
            setup_otp = db_user.mfa_otp

        # =====================================================================
        # 3. ENABLE MFA: Reject invalid OTP, succeed with valid OTP
        # =====================================================================
        # Invalid OTP
        bad_enable_resp = await client.post(
            "/api/v1/auth/mfa/enable",
            headers=headers_reg,
            json={"otp": "000000"},
        )
        assert bad_enable_resp.status_code == 400

        # Valid OTP
        good_enable_resp = await client.post(
            "/api/v1/auth/mfa/enable",
            headers=headers_reg,
            json={"otp": setup_otp},
        )
        assert good_enable_resp.status_code == 200
        assert good_enable_resp.json()["mfa_enabled"] is True

        # Verify status is now active
        status_enabled_resp = await client.get("/api/v1/auth/mfa/status", headers=headers_reg)
        assert status_enabled_resp.status_code == 200
        assert status_enabled_resp.json()["mfa_enabled"] is True

        # =====================================================================
        # 4. MFA LOGIN CHALLENGE: Login now returns challenge instead of tokens
        # =====================================================================
        mfa_login_resp = await client.post(
            "/api/v1/auth/login",
            json={"email": reg_user_email, "password": reg_user_pass, "portal": "STUDENT"},
        )
        assert mfa_login_resp.status_code == 200
        mfa_challenge = mfa_login_resp.json()
        assert mfa_challenge.get("mfa_required") is True
        assert "mfa_ticket" in mfa_challenge
        assert "access_token" not in mfa_challenge
        mfa_ticket = mfa_challenge["mfa_ticket"]

        # Check that MFA login code email was delivered
        login_emails = get_emails_for_recipient(reg_user_email)
        login_code_email = [e for e in login_emails if "Two-Factor Authentication (MFA) Security Code" in e["subject"]][-1]
        assert "security code is:" in login_code_email["body"].lower()

        # Retrieve login OTP code from database
        async with sessions() as session:
            db_user = await session.scalar(select(User).where(User.email == reg_user_email))
            login_otp = db_user.mfa_otp
            assert login_otp is not None

        # =====================================================================
        # 5. VERIFY MFA LOGIN: Reject bad OTP, succeed with good OTP
        # =====================================================================
        # Invalid OTP
        bad_verify_resp = await client.post(
            "/api/v1/auth/mfa/verify-login",
            json={"mfa_ticket": mfa_ticket, "otp": "999999"},
        )
        assert bad_verify_resp.status_code == 400

        # Valid OTP
        good_verify_resp = await client.post(
            "/api/v1/auth/mfa/verify-login",
            json={"mfa_ticket": mfa_ticket, "otp": login_otp},
        )
        assert good_verify_resp.status_code == 200
        mfa_tokens = good_verify_resp.json()
        assert "access_token" in mfa_tokens
        assert "refresh_token" in mfa_tokens
        new_auth_header = {"Authorization": f"Bearer {mfa_tokens['access_token']}"}

        # Verify OTP was cleared
        async with sessions() as session:
            db_user = await session.scalar(select(User).where(User.email == reg_user_email))
            assert db_user.mfa_otp is None

        # =====================================================================
        # 6. DISABLE MFA: Reject wrong password, succeed with correct password
        # =====================================================================
        # Wrong password
        bad_disable_resp = await client.post(
            "/api/v1/auth/mfa/disable",
            headers=new_auth_header,
            json={"password": "WrongPassword999!"},
        )
        assert bad_disable_resp.status_code == 400

        # Correct password
        good_disable_resp = await client.post(
            "/api/v1/auth/mfa/disable",
            headers=new_auth_header,
            json={"password": reg_user_pass},
        )
        assert good_disable_resp.status_code == 200
        assert good_disable_resp.json()["mfa_enabled"] is False

        # =====================================================================
        # 7. POST-DISABLE LOGIN: Logs in with zero friction again
        # =====================================================================
        post_disable_login_resp = await client.post(
            "/api/v1/auth/login",
            json={"email": reg_user_email, "password": reg_user_pass, "portal": "STUDENT"},
        )
        assert post_disable_login_resp.status_code == 200
        post_data = post_disable_login_resp.json()
        assert "access_token" in post_data
        assert post_data.get("mfa_required") is False or "mfa_required" not in post_data
