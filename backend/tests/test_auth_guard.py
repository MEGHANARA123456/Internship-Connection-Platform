import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.v1.dependencies import get_db
from app.main import app
from app.models.base import Base


@pytest.mark.anyio
async def test_auth_guard_and_differentiations():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async def override_db():
        async with sessions() as s:
            yield s

    app.dependency_overrides[get_db] = override_db

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # 1. Company registration should reject personal email domains.
        bad_company = await client.post(
            "/api/v1/auth/register/company",
            json={
            "email": "recruiter@gmail.com",
                "password": "Password123!",
                "company_name": "Fake Tech",
                "industry": "Technology",
            },
        )
        assert bad_company.status_code == 400
        assert "official company or institute email" in bad_company.json()["detail"]

        # Institutional organization emails are valid for company/institute accounts.
        check_academic = await client.post(
            "/api/v1/auth/check-email",
            json={"email": "student@mit.edu", "role": "COMPANY"},
        )
        assert check_academic.status_code == 200
        assert check_academic.json()["available"] is True
        assert check_academic.json()["classification"] == "INSTITUTION_EMAIL"

        # 2. Forgot password for missing email should return 404 with clear reason
        missing_fp = await client.post(
            "/api/v1/auth/forgot-password",
            json={"email": "nonexistent.user.12345@gmail.com"},
        )
        assert missing_fp.status_code == 404
        assert "No account found with email" in missing_fp.json()["detail"]

        # 3. Login for missing email should return 404 with clear reason
        missing_login = await client.post(
            "/api/v1/auth/login",
            json={"email": "nonexistent.user.12345@gmail.com", "password": "AnyPassword123!"},
        )
        assert missing_login.status_code == 404
        assert "No account found with email" in missing_login.json()["detail"]

        # 4. Valid Student Registration
        student_reg = await client.post(
            "/api/v1/auth/register/student",
            json={
                "email": "alice@university.edu",
                "password": "StudentPass123!",
                "full_name": "Alice Wonderland",
                "university": "State University",
                "major": "Computer Science",
                "graduation_year": 2026,
            },
        )
        assert student_reg.status_code == 201

        # Resend verification
        resend_resp = await client.post(
            "/api/v1/auth/resend-verification",
            json={"email": "alice@university.edu"},
        )
        assert resend_resp.status_code == 200
        assert "Verification link has been sent" in resend_resp.json()["message"]

        # Portal mismatch: Student trying to sign in through COMPANY portal
        mismatch_login = await client.post(
            "/api/v1/auth/login",
            json={
                "email": "alice@university.edu",
                "password": "StudentPass123!",
                "portal": "COMPANY",
            },
        )
        assert mismatch_login.status_code == 403
        assert "Role mismatch" in mismatch_login.json()["detail"]

        # Correct portal student login BEFORE email verification: must return 403
        unverified_login = await client.post(
            "/api/v1/auth/login",
            json={
                "email": "alice@university.edu",
                "password": "StudentPass123!",
                "portal": "STUDENT",
            },
        )
        assert unverified_login.status_code == 403
        assert "Email verification required" in unverified_login.json()["detail"]

        # Fetch verification token from database and verify email
        async with sessions() as s:
            from sqlalchemy import select
            from app.models import User
            user = await s.scalar(select(User).where(User.email == "alice@university.edu"))
            assert user is not None
            token_val = user.verification_token
            assert token_val is not None

        verify_resp = await client.get(f"/api/v1/auth/verify/{token_val}")
        assert verify_resp.status_code == 200

        # Now login should succeed
        correct_login = await client.post(
            "/api/v1/auth/login",
            json={
                "email": "alice@university.edu",
                "password": "StudentPass123!",
                "portal": "STUDENT",
            },
        )
        assert correct_login.status_code == 200
        token = correct_login.json()["access_token"]

        # 5. Change Password via authenticated endpoint
        wrong_pwd_change = await client.post(
            "/api/v1/auth/change-password",
            headers={"Authorization": f"Bearer {token}"},
            json={"current_password": "WrongPassword!", "new_password": "BrandNewPassword123!"},
        )
        assert wrong_pwd_change.status_code == 400
        assert "Current password is incorrect" in wrong_pwd_change.json()["detail"]

        valid_pwd_change = await client.post(
            "/api/v1/auth/change-password",
            headers={"Authorization": f"Bearer {token}"},
            json={"current_password": "StudentPass123!", "new_password": "BrandNewPassword123!"},
        )
        assert valid_pwd_change.status_code == 200
        assert "Password updated successfully" in valid_pwd_change.json()["message"]
