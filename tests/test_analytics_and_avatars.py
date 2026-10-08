import io
from datetime import timedelta

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.v1.dependencies import get_db
from app.core.security import create_token
from app.main import app
from app.models import User, UserRole, StudentProfile, CompanyProfile, Internship
from app.models.base import Base


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
async def test_analytics_and_avatars(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    async def override_db():
        async with sessions() as session:
            yield session

    app.dependency_overrides[get_db] = override_db

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Test public analytics overview
        res = await client.get("/api/v1/analytics/overview")
        assert res.status_code == 200
        data = res.json()
        assert "funnel" in data
        assert "domains" in data
        assert "monthly_trends" in data
        assert data["funnel"]["applied"] == 0

        # 2. Register student and verify
        student_data = {
            "email": "test-avatar-student@example.com",
            "password": "strong-password-123",
            "full_name": "Avatar Test Student",
            "university": "Test University",
            "major": "Computer Science",
            "graduation_year": 2026,
        }
        reg_res = await client.post("/api/v1/auth/register/student", json=student_data)
        assert reg_res.status_code == 201

        # Mark verified in session
        async with sessions() as session:
            student_user = await session.scalar(
                select(User).where(User.email == student_data["email"])
            )
            assert student_user is not None
            student_user.is_verified = True
            await session.commit()

        # Login
        login_res = await client.post(
            "/api/v1/auth/login",
            json={"email": student_data["email"], "password": student_data["password"]},
        )
        assert login_res.status_code == 200
        token = login_res.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        # 3. Test Avatar Upload
        fake_png = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15c4"
        files = {"file": ("test_avatar.png", io.BytesIO(fake_png), "image/png")}
        upload_res = await client.post("/api/v1/profiles/avatar", headers=headers, files=files)
        assert upload_res.status_code == 200
        avatar_url = upload_res.json()["avatar_url"]
        assert avatar_url.startswith("/api/v1/profiles/avatar/")

        # 4. Fetch uploaded avatar
        avatar_get_res = await client.get(avatar_url)
        assert avatar_get_res.status_code == 200
        assert avatar_get_res.headers.get("content-type") == "image/png"

        # 5. Test Recommended Contacts endpoint
        rec_res = await client.get("/api/v1/contacts/recommended", headers=headers)
        assert rec_res.status_code == 200
        assert isinstance(rec_res.json(), list)

        # 6. Delete Avatar
        del_res = await client.delete("/api/v1/profiles/avatar", headers=headers)
        assert del_res.status_code == 200
        assert del_res.json()["avatar_url"] is None


@pytest.mark.anyio
async def test_admin_user_growth_counts_users_without_email_verification(monkeypatch: pytest.MonkeyPatch):
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
        users = [
            User(email="growth-student-1@example.com", password_hash="unused", role=UserRole.STUDENT),
            User(email="growth-student-2@example.com", password_hash="unused", role=UserRole.STUDENT),
            User(email="growth-company@example.com", password_hash="unused", role=UserRole.COMPANY),
            User(email="growth-admin@example.com", password_hash="unused", role=UserRole.ADMIN),
        ]
        session.add_all(users)
        await session.commit()
        admin = users[-1]
        token = create_token(str(admin.id), UserRole.ADMIN.value, "access", timedelta(minutes=30))

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get(
            "/api/v1/analytics/admin/user-growth?granularity=month&periods=1",
            headers={"Authorization": f"Bearer {token}"},
        )

    assert response.status_code == 200
    current_period = response.json()[0]
    assert current_period["students"] == 2
    assert current_period["companies"] == 1
    assert current_period["admins"] == 1

    app.dependency_overrides.clear()
    await engine.dispose()
