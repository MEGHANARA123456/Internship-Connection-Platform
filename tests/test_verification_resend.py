import hashlib
import time
from datetime import datetime, timedelta, timezone

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.v1 import auth
from app.api.v1.dependencies import get_db
from app.main import app
from app.models import EmailVerificationToken, User, UserRole
from app.models.base import Base


@pytest.mark.anyio
async def test_resend_uses_generic_response_replaces_tokens_and_returns_stable_codes(monkeypatch) -> None:
    sent_emails: list[str] = []

    async def send_email(to: str, *_args, **_kwargs) -> None:
        sent_emails.append(to)

    monkeypatch.setattr(auth, "send_dev_email", send_email)
    monkeypatch.setattr(auth, "_check_verification_resend_limit", lambda _email, _ip: 0)
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    async def override_db():
        async with sessions() as db:
            yield db

    app.dependency_overrides[get_db] = override_db
    client = AsyncClient(transport=ASGITransport(app=app), base_url="http://test")
    await client.__aenter__()
    old_token = "old-verification-token"
    try:
        async with sessions() as db:
            user = User(
                email="resend@example.com",
                password_hash="unused",
                role=UserRole.STUDENT,
                is_verified=False,
                verification_token=old_token,
                verification_token_expires_at=datetime.now(timezone.utc) + timedelta(days=1),
            )
            db.add(user)
            await db.flush()
            db.add(
                EmailVerificationToken(
                    user_id=user.id,
                    token_digest=hashlib.sha256(old_token.encode()).hexdigest(),
                    expires_at=datetime.now(timezone.utc) + timedelta(days=1),
                )
            )
            await db.commit()

        generic_message = "If an account exists and still needs verification, a new email has been sent"
        resend = await client.post("/api/v1/auth/resend-verification", json={"email": "resend@example.com"})
        unknown = await client.post("/api/v1/auth/resend-verification", json={"email": "unknown@example.com"})
        assert resend.status_code == unknown.status_code == 200
        assert resend.json()["message"] == unknown.json()["message"] == generic_message

        async with sessions() as db:
            updated = await db.scalar(select(User).where(User.email == "resend@example.com"))
            assert updated is not None
            new_token = updated.verification_token
            assert new_token and new_token != old_token
            assert updated.verification_token_expires_at is not None
            assert updated.verification_token_expires_at.replace(tzinfo=timezone.utc) > datetime.now(timezone.utc) + timedelta(hours=23)
            previous = await db.scalar(
                select(EmailVerificationToken).where(
                    EmailVerificationToken.token_digest == hashlib.sha256(old_token.encode()).hexdigest()
                )
            )
            assert previous is not None and previous.used_at is not None

        invalidated = await client.get(f"/api/v1/auth/verify/{old_token}")
        assert invalidated.status_code == 400
        assert invalidated.json()["detail"] == "token_invalid"
        verified = await client.get(f"/api/v1/auth/verify/{new_token}")
        assert verified.status_code == 200
        already_verified = await client.get(f"/api/v1/auth/verify/{new_token}")
        assert already_verified.status_code == 409
        assert already_verified.json()["detail"] == "already_verified"
        await client.post("/api/v1/auth/resend-verification", json={"email": "resend@example.com"})
        assert sent_emails == ["resend@example.com"]
    finally:
        await client.__aexit__(None, None, None)
        app.dependency_overrides.pop(get_db, None)
        await engine.dispose()


def test_resend_rate_limit_enforces_email_ip_cooldown_and_hourly_cap(monkeypatch) -> None:
    auth._verification_resend_attempts.clear()
    now = 1000.0
    monkeypatch.setattr(auth.time, "monotonic", lambda: now)
    try:
        assert auth._check_verification_resend_limit("a@example.com", "ip-a") == 0
        assert auth._check_verification_resend_limit("a@example.com", "ip-b") >= 1
        assert auth._check_verification_resend_limit("b@example.com", "ip-a") >= 1

        for attempt in range(1, 5):
            now += 61
            assert auth._check_verification_resend_limit("a@example.com", f"ip-{attempt}") == 0
        now += 61
        assert auth._check_verification_resend_limit("a@example.com", "ip-final") >= 1
    finally:
        auth._verification_resend_attempts.clear()
