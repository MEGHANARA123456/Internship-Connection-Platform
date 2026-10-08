from datetime import timedelta

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.v1.dependencies import get_db
from app.core.security import create_token
from app.main import app
from app.models import User, UserRole
from app.models.base import Base


@pytest.mark.anyio
async def test_institution_endpoint(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    async def override_db():
        async with sessions() as session:
            yield session

    app.dependency_overrides[get_db] = override_db
    async with sessions() as session:
        admin = User(email="institution-admin@example.com", password_hash="fake", role=UserRole.ADMIN, is_active=True)
        student = User(email="institution-student@example.com", password_hash="fake", role=UserRole.STUDENT, is_active=True)
        session.add_all([admin, student])
        await session.commit()
        await session.refresh(admin)
        await session.refresh(student)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        student_token = create_token(str(student.id), student.role.value, "access", timedelta(minutes=30))
        admin_token = create_token(str(admin.id), admin.role.value, "access", timedelta(minutes=30))
        denied = await client.get(
            "/api/v1/institution/placement-stats",
            headers={"Authorization": f"Bearer {student_token}"},
        )
        assert denied.status_code == 403
        res = await client.get(
            "/api/v1/institution/placement-stats",
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        assert res.status_code == 200
        data = res.json()
        assert "placement_rate_pct" in data
        assert "total_students" in data
        assert "department_stats" in data

    app.dependency_overrides.clear()
    await engine.dispose()
