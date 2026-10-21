from datetime import datetime, timedelta, timezone

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.v1.dependencies import get_db
from app.core.security import create_token, decode_token
from app.main import app
from app.models import RefreshToken, User, UserRole
from app.models.base import Base


@pytest.mark.anyio
async def test_refresh_token_reuse_returns_same_pair_for_30_seconds_then_rejects() -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    async def override_db():
        async with sessions() as session:
            yield session

    app.dependency_overrides[get_db] = override_db
    async with sessions() as session:
        user = User(
            email="refresh-window@example.com",
            password_hash="unused",
            role=UserRole.STUDENT,
            is_verified=True,
        )
        session.add(user)
        await session.flush()
        old_refresh = create_token(
            str(user.id),
            user.role.value,
            "refresh",
            timedelta(days=7),
        )
        payload = decode_token(old_refresh)
        session.add(
            RefreshToken(
                jti=payload["jti"],
                user_id=user.id,
                expires_at=datetime.fromtimestamp(payload["exp"], timezone.utc),
            )
        )
        await session.commit()
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app, client=("198.51.100.32", 4567)),
            base_url="http://refresh-window-test",
        ) as client:
            first = await client.post("/api/v1/auth/refresh", json={"refresh_token": old_refresh})
            second = await client.post("/api/v1/auth/refresh", json={"refresh_token": old_refresh})

            assert first.status_code == 200
            assert second.status_code == 200
            assert second.json()["access_token"] == first.json()["access_token"]
            assert second.json()["refresh_token"] == first.json()["refresh_token"]

            async with sessions() as session:
                old_token = await session.scalar(
                    select(RefreshToken).where(RefreshToken.jti == payload["jti"])
                )
                assert old_token is not None
                assert old_token.reuse_until is not None
                assert old_token.replacement_tokens is not None
                old_token.reuse_until = datetime.now(timezone.utc) - timedelta(seconds=1)
                await session.commit()

            expired_reuse = await client.post(
                "/api/v1/auth/refresh",
                json={"refresh_token": old_refresh},
            )
            assert expired_reuse.status_code == 401
            async with sessions() as session:
                old_token = await session.scalar(
                    select(RefreshToken).where(RefreshToken.jti == payload["jti"])
                )
                assert old_token is not None
                assert old_token.replacement_tokens is None
    finally:
        app.dependency_overrides.clear()
        await engine.dispose()
