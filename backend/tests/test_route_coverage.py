from datetime import timedelta
# pyrefly: ignore [missing-import]
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.v1.dependencies import get_db
from app.core.security import create_token
from app.main import app
from app.models import Notification, User, UserRole
from app.models.base import Base


@pytest.mark.anyio
async def test_notification_read_routes_and_public_institution(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    async def override_db():
        async with sessions() as session:
            yield session

    app.dependency_overrides[get_db] = override_db

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # 1. Test public institutional stats
        inst_res = await client.get("/api/v1/institution/placement-stats")
        assert inst_res.status_code == 200
        inst_data = inst_res.json()
        assert "placement_rate_pct" in inst_data
        assert "institution_name" in inst_data

        # 2. Create user and notifications
        async with sessions() as session:
            user = User(
                email="notif-test@example.com",
                password_hash="fake",
                role=UserRole.STUDENT,
                is_active=True,
                is_verified=True,
            )
            session.add(user)
            await session.commit()
            await session.refresh(user)

            n1 = Notification(
                user_id=user.id,
                notification_type="APPLICATION_STATUS",
                title="Status Update 1",
                body="First update",
            )
            n2 = Notification(
                user_id=user.id,
                notification_type="APPLICATION_STATUS",
                title="Status Update 2",
                body="Second update",
            )
            session.add_all([n1, n2])
            await session.commit()
            await session.refresh(n1)
            await session.refresh(n2)
            n1_id = n1.id
            n2_id = n2.id

        user_token = create_token(str(user.id), user.role.value, "access", timedelta(minutes=30))
        headers = {"Authorization": f"Bearer {user_token}"}

        # 3. Test PATCH single notification
        patch_res = await client.patch(f"/api/v1/notifications/{n1_id}/read", headers=headers)
        assert patch_res.status_code == 204

        # 4. Test POST read-all notifications
        read_all_res = await client.post("/api/v1/notifications/read-all", headers=headers)
        assert read_all_res.status_code == 204

        # 5. Verify all notifications are read
        list_res = await client.get("/api/v1/notifications", headers=headers)
        assert list_res.status_code == 200
        items = list_res.json()
        assert len(items) == 2
        assert all(item["read_at"] is not None for item in items)

    app.dependency_overrides.clear()
    await engine.dispose()
