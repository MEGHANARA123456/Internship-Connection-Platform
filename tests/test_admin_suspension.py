from datetime import timedelta

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.v1.dependencies import get_current_user, get_db
from app.core.security import create_token, hash_password
from app.main import app
from app.models import User, UserRole
from app.models.base import Base


async def setup_database():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    async def override_db():
        async with sessions() as db:
            yield db

    app.dependency_overrides[get_db] = override_db
    return engine, sessions


async def create_user(sessions, email: str, role: UserRole, password: str = "AdminPassword123", active: bool = True) -> User:
    async with sessions() as db:
        user = User(
            email=email,
            password_hash=hash_password(password),
            role=role,
            is_active=active,
            is_verified=True,
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
        return user


def auth_header(user: User) -> dict[str, str]:
    token = create_token(str(user.id), user.role.value, "access", timedelta(minutes=30))
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.anyio
async def test_admin_reactivates_suspended_admin_and_admin_can_log_in() -> None:
    engine, sessions = await setup_database()
    actor = await create_user(sessions, "actor-admin@example.com", UserRole.ADMIN)
    target = await create_user(
        sessions,
        "suspended-admin@example.com",
        UserRole.ADMIN,
        password="ReactivatedPassword123",
        active=False,
    )
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.post(
                f"/api/v1/admin/users/{target.id}/reactivate",
                headers=auth_header(actor),
            )
            login = await client.post(
                "/api/v1/auth/login",
                json={"email": target.email, "password": "ReactivatedPassword123"},
            )

        assert response.status_code == 200
        assert response.json()["is_active"] is True
        assert login.status_code == 200
        async with sessions() as db:
            reactivated = await db.scalar(select(User).where(User.id == target.id))
            assert reactivated is not None
            assert reactivated.is_active is True
            assert reactivated.suspended_at is None
    finally:
        app.dependency_overrides.clear()
        await engine.dispose()


@pytest.mark.anyio
async def test_admin_cannot_suspend_self() -> None:
    engine, sessions = await setup_database()
    admin = await create_user(sessions, "self-admin@example.com", UserRole.ADMIN)
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.post(
                f"/api/v1/admin/users/{admin.id}/suspend",
                headers=auth_header(admin),
            )
        assert response.status_code == 400
        assert response.json()["detail"] == "You cannot suspend your own account"
    finally:
        app.dependency_overrides.clear()
        await engine.dispose()


@pytest.mark.anyio
async def test_admin_cannot_suspend_last_active_admin(monkeypatch: pytest.MonkeyPatch) -> None:
    engine, sessions = await setup_database()
    last_admin = await create_user(sessions, "last-admin@example.com", UserRole.ADMIN)
    delegated_admin = User(
        id=last_admin.id + 100,
        email="delegated-admin@example.com",
        password_hash="test-hash",
        role=UserRole.ADMIN,
        is_active=True,
        is_verified=True,
    )
    app.dependency_overrides[get_current_user] = lambda: delegated_admin
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.post(
                f"/api/v1/admin/users/{last_admin.id}/suspend",
            )
        assert response.status_code == 400
        assert response.json()["detail"] == "At least one active administrator is required"
    finally:
        app.dependency_overrides.clear()
        await engine.dispose()


@pytest.mark.anyio
async def test_students_and_companies_cannot_suspend_users() -> None:
    engine, sessions = await setup_database()
    target = await create_user(sessions, "target-admin@example.com", UserRole.ADMIN)
    student = await create_user(sessions, "student@example.com", UserRole.STUDENT)
    company = await create_user(sessions, "company@example.com", UserRole.COMPANY)
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            student_response = await client.post(
                f"/api/v1/admin/users/{target.id}/suspend",
                headers=auth_header(student),
            )
            company_response = await client.post(
                f"/api/v1/admin/users/{target.id}/suspend",
                headers=auth_header(company),
            )
        assert student_response.status_code == 403
        assert company_response.status_code == 403
    finally:
        app.dependency_overrides.clear()
        await engine.dispose()
