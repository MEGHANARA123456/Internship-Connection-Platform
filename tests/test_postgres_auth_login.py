import asyncio
import os
from datetime import datetime, timezone
from uuid import uuid4

import pyotp
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, select
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.v1.dependencies import get_db
from app.core.config import get_settings
from app.core.security import hash_password
from app.main import app
from app.models import RefreshToken, User, UserRole


@pytest.mark.anyio
async def test_real_postgres_login_roles_and_failure_paths() -> None:
    database_url = (
        os.getenv("TEST_POSTGRES_URL")
        or os.getenv("DATABASE_URL")
        or get_settings().database_url
    )
    if make_url(database_url).get_backend_name() != "postgresql":
        pytest.skip("This login regression test requires PostgreSQL, not SQLite.")

    engine = create_async_engine(database_url)
    connected = False

    async def check_connection() -> None:
        async with engine.connect():
            pass

    try:
        await asyncio.wait_for(check_connection(), timeout=2)
        connected = True
    except Exception as exc:
        await engine.dispose()
        parsed_url = make_url(database_url)
        pytest.skip(
            f"PostgreSQL test database at {parsed_url.host}:{parsed_url.port or 5432} "
            f"is unreachable within 2 seconds "
            f"({type(exc).__name__}: {exc})."
        )

    sessions = async_sessionmaker(engine, expire_on_commit=False)
    suffix = uuid4().hex
    password = "Test-Login-Only-Password-42!"
    password_hash = hash_password(password)
    emails = {
        name: f"login-{name}-{suffix}@example.com"
        for name in ("student", "company", "admin", "suspended", "unverified", "mfa")
    }
    totp_secret = pyotp.random_base32()
    users = [
        User(email=emails["student"], password_hash=password_hash, role=UserRole.STUDENT, is_verified=True),
        User(email=emails["company"], password_hash=password_hash, role=UserRole.COMPANY, is_verified=False),
        User(email=emails["admin"], password_hash=password_hash, role=UserRole.ADMIN, is_verified=False),
        User(email=emails["suspended"], password_hash=password_hash, role=UserRole.STUDENT, is_active=False, is_verified=True),
        User(email=emails["unverified"], password_hash=password_hash, role=UserRole.STUDENT, is_verified=False),
        User(
            email=emails["mfa"],
            password_hash=password_hash,
            role=UserRole.STUDENT,
            is_verified=True,
            mfa_enabled=True,
            mfa_type="TOTP",
            mfa_secret=totp_secret,
        ),
    ]
    previous_overrides = app.dependency_overrides.copy()

    async def override_db():
        async with sessions() as session:
            yield session

    try:
        app.dependency_overrides[get_db] = override_db
        async with sessions() as session:
            session.add_all(users)
            await session.commit()

        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://postgres-login-test",
        ) as client:
            student_response = await client.post(
                "/api/v1/auth/login",
                json={"email": emails["student"], "password": password},
            )
            assert student_response.status_code == 200
            assert student_response.json()["role"] == "STUDENT"

            company_response = await client.post(
                "/api/v1/auth/login",
                json={"email": emails["company"], "password": password},
            )
            assert company_response.status_code == 200
            assert company_response.json()["is_first_login"] is True

            company_again = await client.post(
                "/api/v1/auth/login",
                json={"email": emails["company"], "password": password},
            )
            assert company_again.status_code == 200
            assert company_again.json()["is_first_login"] is False

            admin_response = await client.post(
                "/api/v1/auth/login",
                json={"email": emails["admin"], "password": password},
            )
            assert admin_response.status_code == 200
            assert admin_response.json()["role"] == "ADMIN"

            wrong_password = await client.post(
                "/api/v1/auth/login",
                json={"email": emails["student"], "password": "incorrect-password"},
            )
            assert wrong_password.status_code == 401

            suspended = await client.post(
                "/api/v1/auth/login",
                json={"email": emails["suspended"], "password": password},
            )
            assert suspended.status_code == 403
            assert "suspended" in suspended.json()["detail"].lower()

            unverified = await client.post(
                "/api/v1/auth/login",
                json={"email": emails["unverified"], "password": password},
            )
            assert unverified.status_code == 403
            assert "email verification required" in unverified.json()["detail"].lower()

            mfa_challenge = await client.post(
                "/api/v1/auth/login",
                json={"email": emails["mfa"], "password": password},
            )
            assert mfa_challenge.status_code == 200
            assert mfa_challenge.json()["mfa_required"] is True
            mfa_complete = await client.post(
                "/api/v1/auth/mfa/verify-login",
                json={
                    "mfa_ticket": mfa_challenge.json()["mfa_ticket"],
                    "otp": pyotp.TOTP(totp_secret).now(),
                },
            )
            assert mfa_complete.status_code == 200
            assert mfa_complete.json()["is_first_login"] is True

        async with sessions() as session:
            company_user = await session.scalar(select(User).where(User.email == emails["company"]))
            student_user = await session.scalar(select(User).where(User.email == emails["student"]))
            assert company_user is not None and company_user.first_login_at is not None
            assert student_user is not None and student_user.first_login_at is not None
            assert company_user.first_login_at <= datetime.now(timezone.utc)
    finally:
        if connected:
            app.dependency_overrides.clear()
            app.dependency_overrides.update(previous_overrides)
            async with sessions() as session:
                ids = select(User.id).where(User.email.in_(emails.values()))
                await session.execute(delete(RefreshToken).where(RefreshToken.user_id.in_(ids)))
                await session.execute(delete(User).where(User.email.in_(emails.values())))
                await session.commit()
            await engine.dispose()
