from datetime import timedelta

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.v1.dependencies import get_db
from app.core.security import create_token
from app.main import app
from app.models import EmailMessage, User, UserRole
from app.models.base import Base


@pytest.mark.anyio
async def test_user_email_records_are_isolated() -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    async def override_db():
        async with sessions() as session:
            yield session

    app.dependency_overrides[get_db] = override_db
    async with sessions() as session:
        user_a = User(email="a@example.com", password_hash="fake", role=UserRole.STUDENT, is_verified=True)
        user_b = User(email="b@example.com", password_hash="fake", role=UserRole.STUDENT, is_verified=True)
        session.add_all([user_a, user_b])
        await session.flush()
        session.add_all(
            [
                EmailMessage(user_id=user_a.id, recipient_email=user_a.email, sender_email="noreply@example.com", subject="A only", message_type="EMAIL_VERIFICATION", body="A body"),
                EmailMessage(user_id=user_b.id, recipient_email=user_b.email, sender_email="noreply@example.com", subject="B only", message_type="PASSWORD_RESET", body="B body"),
            ]
        )
        await session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        token_a = create_token(str(user_a.id), user_a.role.value, "access", timedelta(minutes=30))
        token_b = create_token(str(user_b.id), user_b.role.value, "access", timedelta(minutes=30))
        response_a = await client.get("/api/v1/me/emails", headers={"Authorization": f"Bearer {token_a}"})
        response_b = await client.get("/api/v1/me/emails", headers={"Authorization": f"Bearer {token_b}"})
        unauthenticated = await client.get("/api/v1/me/emails")
        public = await client.get("/api/v1/mailbox/public?email=b@example.com")

    assert response_a.status_code == 200
    assert [item["subject"] for item in response_a.json()] == ["A only"]
    assert [item["subject"] for item in response_b.json()] == ["B only"]
    assert unauthenticated.status_code == 401
    assert public.status_code == 404

    app.dependency_overrides.clear()
    await engine.dispose()