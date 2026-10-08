from __future__ import annotations

from datetime import date

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.v1.dependencies import get_current_user, get_db
from app.core.security import hash_password
from app.main import app
from app.models import (
    Application,
    AuditLog,
    Internship,
    Notification,
    User,
    UserRole,
)
from app.models.base import Base


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest.fixture
async def db_setup():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    async def override_db():
        async with sessions() as session:
            yield session

    app.dependency_overrides[get_db] = override_db
    try:
        yield sessions
    finally:
        app.dependency_overrides.clear()
        await engine.dispose()


async def create_user(sessions, email: str, role: UserRole) -> User:
    async with sessions() as db:
        user = User(
            email=email,
            password_hash=hash_password("ValidPassword123"),
            role=role,
            is_active=True,
            is_verified=True,
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
        return user


def _authorize(user: User) -> None:
    app.dependency_overrides[get_current_user] = lambda: user


@pytest.mark.anyio
async def test_admin_deletes_user_and_writes_audit(db_setup) -> None:
    admin = await create_user(db_setup, "admin@example.com", UserRole.ADMIN)
    target = await create_user(db_setup, "target@example.com", UserRole.STUDENT)
    _authorize(admin)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.request(
            "DELETE",
            f"/api/v1/admin/users/{target.id}",
            json={"confirmation_email": target.email, "reason": "Account requested removal"},
        )

    assert response.status_code == 200
    assert response.json()["success"] is True
    async with db_setup() as db:
        assert await db.get(User, target.id) is None
        audit = await db.scalar(
            select(AuditLog).where(AuditLog.action == "ADMIN_USER_DELETED")
        )
    assert audit is not None
    assert audit.actor_id == admin.id
    assert audit.metadata_ == {
        "reason": "Account requested removal",
        "deleted_email": target.email,
        "deleted_role": UserRole.STUDENT.value,
    }


@pytest.mark.anyio
async def test_admin_cannot_delete_self(db_setup) -> None:
    admin = await create_user(db_setup, "admin@example.com", UserRole.ADMIN)
    _authorize(admin)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.request(
            "DELETE",
            f"/api/v1/admin/users/{admin.id}",
            json={"confirmation_email": admin.email, "reason": "Remove my own account"},
        )

    assert response.status_code == 400
    async with db_setup() as db:
        assert await db.get(User, admin.id) is not None


@pytest.mark.anyio
async def test_admin_cannot_delete_last_administrator(db_setup) -> None:
    last_admin = await create_user(db_setup, "last@example.com", UserRole.ADMIN)
    delegated_admin = User(
        id=last_admin.id + 100,
        email="delegated@example.com",
        password_hash="test-hash",
        role=UserRole.ADMIN,
        is_active=True,
    )
    _authorize(delegated_admin)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.request(
            "DELETE",
            f"/api/v1/admin/users/{last_admin.id}",
            json={"confirmation_email": last_admin.email, "reason": "Remove last admin"},
        )

    assert response.status_code == 400
    async with db_setup() as db:
        assert await db.get(User, last_admin.id) is not None


@pytest.mark.anyio
async def test_admin_deletion_requires_matching_confirmation_email(db_setup) -> None:
    admin = await create_user(db_setup, "admin@example.com", UserRole.ADMIN)
    target = await create_user(db_setup, "target@example.com", UserRole.STUDENT)
    _authorize(admin)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.request(
            "DELETE",
            f"/api/v1/admin/users/{target.id}",
            headers={"Origin": "http://localhost:5173"},
            json={"confirmation_email": "other@example.com", "reason": "Account requested removal"},
        )

    assert response.status_code == 400
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"
    async with db_setup() as db:
        assert await db.get(User, target.id) is not None


@pytest.mark.anyio
async def test_non_admin_cannot_delete_user(db_setup) -> None:
    student = await create_user(db_setup, "student@example.com", UserRole.STUDENT)
    target = await create_user(db_setup, "target@example.com", UserRole.STUDENT)
    _authorize(student)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.request(
            "DELETE",
            f"/api/v1/admin/users/{target.id}",
            json={"confirmation_email": target.email, "reason": "Account requested removal"},
        )

    assert response.status_code == 403


@pytest.mark.anyio
async def test_admin_deletion_returns_404_for_unknown_user(db_setup) -> None:
    admin = await create_user(db_setup, "admin@example.com", UserRole.ADMIN)
    _authorize(admin)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.request(
            "DELETE",
            "/api/v1/admin/users/99999",
            json={"confirmation_email": "missing@example.com", "reason": "Account requested removal"},
        )

    assert response.status_code == 404


@pytest.mark.anyio
async def test_company_deletion_notifies_impacted_students_in_app(db_setup) -> None:
    admin = await create_user(db_setup, "admin@example.com", UserRole.ADMIN)
    company = await create_user(db_setup, "company@example.com", UserRole.COMPANY)
    student = await create_user(db_setup, "student@example.com", UserRole.STUDENT)
    async with db_setup() as db:
        internship = Internship(
            company_id=company.id,
            title="Intern role",
            description="Role description",
            location="Remote",
            industry="Technology",
            duration_months=3,
            work_mode="REMOTE",
            deadline=date(2030, 1, 1),
        )
        db.add(internship)
        await db.flush()
        db.add(Application(internship_id=internship.id, student_id=student.id))
        await db.commit()
        internship_id = internship.id
    _authorize(admin)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.request(
            "DELETE",
            f"/api/v1/admin/users/{company.id}",
            json={"confirmation_email": company.email, "reason": "Company requested removal"},
        )

    assert response.status_code == 200
    async with db_setup() as db:
        notification = await db.scalar(
            select(Notification).where(
                Notification.user_id == student.id,
                Notification.notification_type == "COMPANY_ACCOUNT_DELETED",
            )
        )
        assert await db.get(Internship, internship_id) is None
        assert await db.scalar(
            select(Application.id).where(Application.student_id == student.id)
        ) is None
    assert notification is not None


@pytest.mark.anyio
async def test_privacy_account_deletion_uses_shared_erasure_service(db_setup) -> None:
    student = await create_user(db_setup, "student@example.com", UserRole.STUDENT)
    _authorize(student)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post(
            "/api/v1/privacy/delete-account",
            json={
                "password": "ValidPassword123",
                "confirmation_phrase": "DELETE MY ACCOUNT",
                "reason": "No longer using the service",
            },
        )

    assert response.status_code == 200
    async with db_setup() as db:
        assert await db.get(User, student.id) is None
        audit = await db.scalar(
            select(AuditLog).where(
                AuditLog.action == "GDPR_RIGHT_TO_ERASURE_EXECUTED"
            )
        )
    assert audit is not None
