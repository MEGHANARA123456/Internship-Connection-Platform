"""
Tests for audit-log wiring, new admin endpoints, and new analytics endpoints.

Uses an in-memory SQLite database (sqlite+aiosqlite:///:memory:) to keep the
test suite isolated from the production PostgreSQL instance — matching the
pattern used throughout the rest of the test suite.
"""
from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.v1.dependencies import get_current_user, get_db
from app.main import app
from app.models import (
    Application,
    AuditLog,
    CompanyProfile,
    Internship,
    User,
    UserRole,
)
from app.models.base import Base

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture
async def db_setup():
    """Creates an isolated in-memory SQLite engine and yields (engine, session_factory, client)."""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async def override_db():
        async with sessions() as session:
            yield session

    app.dependency_overrides[get_db] = override_db
    yield engine, sessions
    app.dependency_overrides.clear()
    await engine.dispose()


def _make_admin() -> User:
    return User(id=1, email="admin@test.com", role=UserRole.ADMIN, is_active=True, is_verified=True,
                password_hash="x", mfa_enabled=False)


def _make_student(user_id: int = 10) -> User:
    return User(id=user_id, email=f"student{user_id}@test.com", role=UserRole.STUDENT,
                is_active=True, is_verified=True, password_hash="x", mfa_enabled=False)


def _make_company_user(user_id: int = 20) -> User:
    return User(id=user_id, email=f"company{user_id}@test.com", role=UserRole.COMPANY,
                is_active=True, is_verified=True, password_hash="x", mfa_enabled=False)


# ---------------------------------------------------------------------------
# 1. Role guard — non-admin cannot access audit-logs
# ---------------------------------------------------------------------------

@pytest.mark.anyio
async def test_get_audit_logs_requires_admin(db_setup) -> None:
    app.dependency_overrides[get_current_user] = lambda: _make_student()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.get("/api/v1/admin/audit-logs")
    assert res.status_code == 403


# ---------------------------------------------------------------------------
# 2. suspend_user → audit log created
# ---------------------------------------------------------------------------

@pytest.mark.anyio
async def test_audit_log_created_on_suspend(db_setup) -> None:
    _, sessions = db_setup
    admin = _make_admin()
    student = _make_student()

    async with sessions() as session:
        session.add_all([admin, student])
        await session.commit()

    app.dependency_overrides[get_current_user] = lambda: admin
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.post(f"/api/v1/admin/users/{student.id}/suspend")

    assert res.status_code == 200
    data = res.json()
    assert data["is_active"] is False

    async with sessions() as session:
        logs = list(await session.scalars(
            select(AuditLog).where(AuditLog.action == "user_suspended")
        ))
    assert len(logs) == 1
    assert logs[0].target_id == student.id
    assert logs[0].target_type == "user"


# ---------------------------------------------------------------------------
# 3. reactivate_user → audit log created
# ---------------------------------------------------------------------------

@pytest.mark.anyio
async def test_audit_log_created_on_reactivate(db_setup) -> None:
    _, sessions = db_setup
    admin = _make_admin()
    student = _make_student()
    student.is_active = False

    async with sessions() as session:
        session.add_all([admin, student])
        await session.commit()

    app.dependency_overrides[get_current_user] = lambda: admin
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.post(f"/api/v1/admin/users/{student.id}/reactivate")

    assert res.status_code == 200
    assert res.json()["is_active"] is True

    async with sessions() as session:
        logs = list(await session.scalars(
            select(AuditLog).where(AuditLog.action == "user_reinstated")
        ))
    assert len(logs) == 1
    assert logs[0].target_id == student.id


# ---------------------------------------------------------------------------
# 4. verify_company → audit log created
# ---------------------------------------------------------------------------

@pytest.mark.anyio
async def test_audit_log_created_on_verify_company(db_setup) -> None:
    _, sessions = db_setup
    admin = _make_admin()
    company_user = _make_company_user()
    cp = CompanyProfile(
        user_id=company_user.id, company_name="AcmeCorp",
        industry="Tech", verification_status="PENDING",
    )

    async with sessions() as session:
        session.add_all([admin, company_user, cp])
        await session.commit()

    app.dependency_overrides[get_current_user] = lambda: admin
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.post(
            f"/api/v1/admin/companies/{company_user.id}/verification",
            json={"status": "VERIFIED"},
        )

    assert res.status_code == 200
    assert res.json()["verification_status"] == "VERIFIED"

    async with sessions() as session:
        logs = list(await session.scalars(
            select(AuditLog).where(AuditLog.action == "company_verified")
        ))
    assert len(logs) == 1
    assert logs[0].target_id == company_user.id


# ---------------------------------------------------------------------------
# 5. moderate_internship → audit log created
# ---------------------------------------------------------------------------

@pytest.mark.anyio
async def test_audit_log_created_on_moderate_internship(db_setup) -> None:
    _, sessions = db_setup
    admin = _make_admin()
    company_user = _make_company_user()
    from datetime import date
    internship = Internship(
        id=100, company_id=company_user.id, title="ML Intern", description="desc",
        location="Remote", industry="AI", duration_months=3, work_mode="REMOTE",
        skills="python", deadline=date(2027, 1, 1), status="PENDING_APPROVAL",
    )

    async with sessions() as session:
        session.add_all([admin, company_user, internship])
        await session.commit()

    app.dependency_overrides[get_current_user] = lambda: admin
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.post(
            f"/api/v1/admin/internships/{internship.id}/moderate",
            json={"status": "PUBLISHED"},
        )

    assert res.status_code == 200
    assert res.json()["status"] == "PUBLISHED"

    async with sessions() as session:
        logs = list(await session.scalars(
            select(AuditLog).where(AuditLog.action == "posting_approved")
        ))
    assert len(logs) == 1
    assert logs[0].target_id == internship.id


# ---------------------------------------------------------------------------
# 6. GET /admin/audit-logs — pagination and filtering
# ---------------------------------------------------------------------------

@pytest.mark.anyio
async def test_get_audit_logs_returns_paginated(db_setup) -> None:
    _, sessions = db_setup
    admin = _make_admin()

    async with sessions() as session:
        session.add(admin)
        for i in range(5):
            session.add(AuditLog(
                actor_id=admin.id, actor_email=admin.email,
                action="user_suspended", target_type="user", target_id=i + 100,
            ))
        await session.commit()

    app.dependency_overrides[get_current_user] = lambda: admin
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.get("/api/v1/admin/audit-logs?page=1&page_size=3")

    assert res.status_code == 200
    body = res.json()
    assert body["total"] == 5
    assert body["page"] == 1
    assert body["page_size"] == 3
    assert len(body["items"]) == 3


@pytest.mark.anyio
async def test_get_audit_logs_filter_by_action(db_setup) -> None:
    _, sessions = db_setup
    admin = _make_admin()

    async with sessions() as session:
        session.add(admin)
        session.add(AuditLog(actor_id=admin.id, actor_email=admin.email,
                              action="user_suspended", target_type="user", target_id=50))
        session.add(AuditLog(actor_id=admin.id, actor_email=admin.email,
                              action="company_verified", target_type="company", target_id=60))
        await session.commit()

    app.dependency_overrides[get_current_user] = lambda: admin
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.get("/api/v1/admin/audit-logs?action=company_verified")

    assert res.status_code == 200
    body = res.json()
    assert body["total"] == 1
    assert body["items"][0]["action"] == "company_verified"


# ---------------------------------------------------------------------------
# 7. GET /admin/users/{id} — student detail includes applications
# ---------------------------------------------------------------------------

@pytest.mark.anyio
async def test_get_user_detail_returns_student_applications(db_setup) -> None:
    _, sessions = db_setup
    admin = _make_admin()
    student = _make_student()
    company_user = _make_company_user()
    cp = CompanyProfile(user_id=company_user.id, company_name="TechCorp", industry="Tech", verification_status="VERIFIED")
    from datetime import date
    internship = Internship(
        id=200, company_id=company_user.id, title="Backend Intern", description="d",
        location="NYC", industry="Tech", duration_months=3, work_mode="HYBRID",
        skills="python", deadline=date(2027, 1, 1), status="PUBLISHED",
    )
    application = Application(internship_id=200, student_id=student.id, status="APPLIED", cover_note="hi")

    async with sessions() as session:
        session.add_all([admin, student, company_user, cp, internship, application])
        await session.commit()

    app.dependency_overrides[get_current_user] = lambda: admin
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.get(f"/api/v1/admin/users/{student.id}")

    assert res.status_code == 200
    body = res.json()
    assert body["id"] == student.id
    assert body["role"] == "STUDENT"
    assert isinstance(body["applications"], list)
    assert len(body["applications"]) == 1
    assert body["applications"][0]["status"] == "APPLIED"
    assert body["applications"][0]["internship_title"] == "Backend Intern"


# ---------------------------------------------------------------------------
# 8. GET /admin/companies/{id}/postings
# ---------------------------------------------------------------------------

@pytest.mark.anyio
async def test_get_company_postings(db_setup) -> None:
    _, sessions = db_setup
    admin = _make_admin()
    company_user = _make_company_user()
    cp = CompanyProfile(user_id=company_user.id, company_name="MegaCorp", industry="Finance", verification_status="VERIFIED")
    from datetime import date
    p1 = Internship(
        id=300, company_id=company_user.id, title="Data Intern", description="d",
        location="Remote", industry="Finance", duration_months=6, work_mode="REMOTE",
        skills="sql", deadline=date(2027, 1, 1), status="PUBLISHED",
    )
    p2 = Internship(
        id=301, company_id=company_user.id, title="Risk Intern", description="d",
        location="London", industry="Finance", duration_months=3, work_mode="ONSITE",
        skills="excel", deadline=date(2027, 6, 1), status="DRAFT",
    )
    # 2 applications to posting 300
    s1 = _make_student(user_id=30)
    s2 = _make_student(user_id=31)
    a1 = Application(internship_id=300, student_id=30, status="APPLIED")
    a2 = Application(internship_id=300, student_id=31, status="SHORTLISTED")

    async with sessions() as session:
        session.add_all([admin, company_user, cp, p1, p2, s1, s2, a1, a2])
        await session.commit()

    app.dependency_overrides[get_current_user] = lambda: admin
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.get(f"/api/v1/admin/companies/{company_user.id}/postings")

    assert res.status_code == 200
    postings = res.json()
    assert len(postings) == 2
    by_id = {p["id"]: p for p in postings}
    assert by_id[300]["applicant_count"] == 2
    assert by_id[301]["applicant_count"] == 0
    assert by_id[300]["title"] == "Data Intern"
