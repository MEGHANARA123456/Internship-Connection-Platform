from __future__ import annotations

from datetime import date, datetime, timezone

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.v1.dependencies import get_current_user, get_db
from app.main import app
from app.models import AuditLog, CompanyProfile, Internship, StudentProfile, User, UserRole
from app.models.base import Base


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest.fixture
async def directory_db():
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


def _account(email: str, role: UserRole, user_id: int) -> User:
    return User(
        id=user_id,
        email=email,
        password_hash="not-returned",
        role=role,
        is_active=True,
        is_verified=True,
        created_at=datetime.now(timezone.utc),
    )


@pytest.mark.anyio
async def test_student_directory_is_paginated_and_audits_filter_names(directory_db) -> None:
    admin = _account("admin@example.test", UserRole.ADMIN, 1)
    students = [
        _account("ada@example.test", UserRole.STUDENT, 10),
        _account("grace@example.test", UserRole.STUDENT, 11),
    ]
    async with directory_db() as db:
        db.add_all([admin, *students])
        db.add_all(
            [
                StudentProfile(
                    user_id=10,
                    full_name="Ada Lovelace",
                    university="Example University",
                    major="Mathematics",
                    graduation_year=2027,
                    skills="Python, SQL",
                ),
                StudentProfile(
                    user_id=11,
                    full_name="Grace Hopper",
                    university="Example University",
                    major="Computer Science",
                    graduation_year=2026,
                    skills="COBOL",
                ),
            ]
        )
        await db.commit()
    app.dependency_overrides[get_current_user] = lambda: admin

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get(
            "/api/v1/admin/students?q=ada%20lovelace&page=1&page_size=1"
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 1
    assert payload["page"] == 1
    assert payload["page_size"] == 1
    assert payload["items"][0]["full_name"] == "Ada Lovelace"
    async with directory_db() as db:
        audit = await db.scalar(
            select(AuditLog).where(AuditLog.action == "admin_listed_students")
        )
    assert audit is not None
    assert audit.metadata_ == {"filters": ["q"]}
    assert "ada" not in str(audit.metadata_).lower()


@pytest.mark.anyio
async def test_student_detail_is_role_scoped_and_audited(directory_db) -> None:
    admin = _account("admin@example.test", UserRole.ADMIN, 1)
    student = _account("student@example.test", UserRole.STUDENT, 10)
    company = _account("company@example.test", UserRole.COMPANY, 20)
    async with directory_db() as db:
        db.add_all(
            [
                admin,
                student,
                company,
                StudentProfile(
                    user_id=10,
                    full_name="Test Student",
                    university="Example University",
                    major="Computer Science",
                    graduation_year=2027,
                    skills="Python",
                ),
                CompanyProfile(
                    user_id=20,
                    company_name="Test Company",
                    industry="Technology",
                ),
            ]
        )
        await db.commit()
    app.dependency_overrides[get_current_user] = lambda: admin

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/api/v1/admin/students/10")
        wrong_role_response = await client.get("/api/v1/admin/students/20")
        repeated_response = await client.get("/api/v1/admin/students/10")

    assert response.status_code == repeated_response.status_code == 200
    assert wrong_role_response.status_code == 404
    serialized = str(response.json()).lower()
    assert "password_hash" not in serialized
    assert "mfa_secret" not in serialized
    async with directory_db() as db:
        audit_rows = list(
            await db.scalars(
                select(AuditLog).where(AuditLog.action == "admin_viewed_student")
            )
        )
    assert len(audit_rows) == 1
    assert audit_rows[0].target_id == 10


@pytest.mark.anyio
async def test_company_directory_has_paginated_company_metrics(directory_db) -> None:
    admin = _account("admin@example.test", UserRole.ADMIN, 1)
    company = _account("company@example.test", UserRole.COMPANY, 20)
    async with directory_db() as db:
        db.add_all(
            [
                admin,
                company,
                CompanyProfile(
                    user_id=20,
                    company_name="Example Inc",
                    industry="Technology",
                    location="Remote",
                    verification_status="VERIFIED",
                ),
            ]
        )
        await db.commit()
    app.dependency_overrides[get_current_user] = lambda: admin

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/api/v1/admin/companies?page=1&page_size=10")

    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 1
    assert len(payload["items"]) == 1
    assert payload["items"][0]["user_id"] == 20
    assert payload["items"][0]["active_roles"] == 0
    assert payload["items"][0]["total_applicants"] == 0


@pytest.mark.anyio
async def test_company_directory_uses_latest_posting_location_and_searches_it(directory_db) -> None:
    admin = _account("admin@example.test", UserRole.ADMIN, 1)
    companies = [
        _account("fallback@example.test", UserRole.COMPANY, 20),
        _account("missing@example.test", UserRole.COMPANY, 21),
    ]
    async with directory_db() as db:
        db.add_all(
            [
                admin,
                *companies,
                CompanyProfile(
                    user_id=20,
                    company_name="Fallback Inc",
                    industry="Technology",
                    location="",
                ),
                CompanyProfile(
                    user_id=21,
                    company_name="No Location Inc",
                    industry="Finance",
                    location=None,
                ),
                Internship(
                    company_id=20,
                    title="Older posting",
                    description="Older listing",
                    location="Pune",
                    industry="Technology",
                    duration_months=3,
                    work_mode="ONSITE",
                    deadline=date(2027, 1, 1),
                    status="DRAFT",
                    created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
                ),
                Internship(
                    company_id=20,
                    title="Most recent posting",
                    description="Latest listing",
                    location="Remote",
                    industry="Technology",
                    duration_months=3,
                    work_mode="REMOTE",
                    deadline=date(2027, 1, 1),
                    status="DRAFT",
                    created_at=datetime(2026, 2, 1, tzinfo=timezone.utc),
                ),
            ]
        )
        await db.commit()
    app.dependency_overrides[get_current_user] = lambda: admin

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        search_response = await client.get("/api/v1/admin/companies?q=Remote&page=1&page_size=10")
        list_response = await client.get("/api/v1/admin/companies?page=1&page_size=10")

    assert search_response.status_code == list_response.status_code == 200
    searched = search_response.json()
    assert searched["total"] == 1
    assert searched["items"][0]["location"] == "Remote"
    listed_by_id = {item["user_id"]: item for item in list_response.json()["items"]}
    assert listed_by_id[20]["location"] == "Remote"
    assert listed_by_id[21]["location"] == "Not provided"
