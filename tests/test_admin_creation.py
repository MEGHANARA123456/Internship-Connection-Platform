from datetime import timedelta

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.v1 import admin as admin_api
from app.api.v1.dependencies import get_db
from app.core.security import create_token
from app.main import app
from app.models import AuditLog, User, UserRole
from app.models.base import Base
from app.scripts.create_admin import create_admin_user


async def _setup_database(monkeypatch: pytest.MonkeyPatch):
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    async def override_db():
        async with sessions() as db:
            yield db

    app.dependency_overrides[get_db] = override_db
    return engine, sessions


async def _create_user(sessions, email: str, role: UserRole) -> User:
    async with sessions() as db:
        user = User(
            email=email,
            password_hash="test-hash",
            role=role,
            is_active=True,
            is_verified=True,
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
        return user


def _auth_header(user: User) -> dict[str, str]:
    token = create_token(str(user.id), user.role.value, "access", timedelta(minutes=30))
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.anyio
async def test_admin_creates_verified_admin_with_atomic_audit_and_safe_email(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    engine, sessions = await _setup_database(monkeypatch)
    sent_emails: list[tuple[str, str, str]] = []

    async def capture_email(to: str, subject: str, body: str) -> None:
        sent_emails.append((to, subject, body))

    monkeypatch.setattr(admin_api, "send_dev_email", capture_email)
    creator = await _create_user(sessions, "creator@example.com", UserRole.ADMIN)
    password = "SafePassword123"
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.post(
                "/api/v1/admin/admins",
                headers=_auth_header(creator),
                json={"email": "new-admin@example.com", "password": password},
            )

        assert response.status_code == 201
        assert response.json()["role"] == "ADMIN"
        assert response.json()["is_active"] is True
        assert response.json()["is_verified"] is True
        async with sessions() as db:
            created = await db.scalar(select(User).where(User.email == "new-admin@example.com"))
            assert created is not None
            audit = await db.scalar(
                select(AuditLog).where(
                    AuditLog.action == "admin_created",
                    AuditLog.target_id == created.id,
                )
            )
            assert created.role == UserRole.ADMIN
            assert created.is_verified is True
            assert audit is not None
            assert audit.actor_id == creator.id
            assert audit.metadata_ == {"email": "new-admin@example.com"}
        assert len(sent_emails) == 1
        assert sent_emails[0][0] == "new-admin@example.com"
        assert creator.email in sent_emails[0][2]
        assert "/login" in sent_emails[0][2]
        assert password not in sent_emails[0][2]
    finally:
        app.dependency_overrides.clear()
        await engine.dispose()


@pytest.mark.anyio
async def test_admin_creation_rejects_non_admin_and_anonymous_users(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    engine, sessions = await _setup_database(monkeypatch)
    student = await _create_user(sessions, "student@example.com", UserRole.STUDENT)
    company = await _create_user(sessions, "company@example.com", UserRole.COMPANY)
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            payload = {"email": "new-admin@example.com", "password": "SafePassword123"}
            assert (await client.post("/api/v1/admin/admins", json=payload)).status_code == 401
            assert (await client.post("/api/v1/admin/admins", headers=_auth_header(student), json=payload)).status_code == 403
            assert (await client.post("/api/v1/admin/admins", headers=_auth_header(company), json=payload)).status_code == 403
    finally:
        app.dependency_overrides.clear()
        await engine.dispose()


@pytest.mark.anyio
async def test_admin_creation_rejects_duplicate_email_and_weak_password(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    engine, sessions = await _setup_database(monkeypatch)
    creator = await _create_user(sessions, "creator@example.com", UserRole.ADMIN)
    await _create_user(sessions, "existing@example.com", UserRole.STUDENT)
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            headers = _auth_header(creator)
            duplicate = await client.post(
                "/api/v1/admin/admins",
                headers=headers,
                json={"email": "existing@example.com", "password": "SafePassword123"},
            )
            weak_password = await client.post(
                "/api/v1/admin/admins",
                headers=headers,
                json={"email": "weak@example.com", "password": "short"},
            )
        assert duplicate.status_code == 409
        assert weak_password.status_code == 422
    finally:
        app.dependency_overrides.clear()
        await engine.dispose()


@pytest.mark.anyio
async def test_public_admin_signup_route_is_removed() -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post(
            "/api/v1/auth/register/admin",
            json={"email": "public-admin@example.com", "password": "SafePassword123"},
        )
    assert response.status_code in {404, 405}


@pytest.mark.anyio
async def test_bootstrap_script_creates_admin_and_audit_with_null_actor(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    engine, sessions = await _setup_database(monkeypatch)
    try:
        async with sessions() as db:
            user = await create_admin_user(db, "bootstrap@example.com", "Bootstrap1234")
            audit = await db.scalar(
                select(AuditLog).where(
                    AuditLog.action == "admin_created",
                    AuditLog.target_id == user.id,
                )
            )
        assert user.role == UserRole.ADMIN
        assert user.is_active is True
        assert user.is_verified is True
        assert audit is not None
        assert audit.actor_id is None
    finally:
        app.dependency_overrides.clear()
        await engine.dispose()
