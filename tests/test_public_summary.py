from datetime import date, timedelta
from datetime import datetime

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.v1.dependencies import get_db
from app.main import app
from app.models import (
    Application,
    CompanyProfile,
    Internship,
    StudentProfile,
    User,
    UserRole,
)
from app.models.base import Base


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest.mark.anyio
async def test_public_summary_returns_zeros_for_empty_database(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    async def override_db():
        async with sessions() as session:
            yield session

    monkeypatch.setitem(app.dependency_overrides, get_db, override_db)
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.get("/api/v1/analytics/public-summary")

        assert response.status_code == 200
        assert response.headers["cache-control"] == "public, max-age=60"
        data = response.json()
        assert data["live_internships"] == 0
        assert data["verified_companies"] == 0
        assert data["registered_students"] == 0
        assert data["offers_made"] == 0
        assert data["openings_by_field"] == []
        assert data["openings_by_work_mode"] == []
        assert datetime.fromisoformat(data["updated_at"])
    finally:
        app.dependency_overrides.pop(get_db, None)
        await engine.dispose()


@pytest.mark.anyio
async def test_public_summary_counts_only_live_roles_and_verified_companies(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    async def override_db():
        async with sessions() as session:
            yield session

    monkeypatch.setitem(app.dependency_overrides, get_db, override_db)
    try:
        async with sessions() as session:
            verified_company = User(
                email="public-verified@example.test",
                password_hash="unused",
                role=UserRole.COMPANY,
            )
            pending_company = User(
                email="public-pending@example.test",
                password_hash="unused",
                role=UserRole.COMPANY,
            )
            student_a = User(
                email="private-student-a@example.test",
                password_hash="unused",
                role=UserRole.STUDENT,
            )
            student_b = User(
                email="private-student-b@example.test",
                password_hash="unused",
                role=UserRole.STUDENT,
            )
            session.add_all([verified_company, pending_company, student_a, student_b])
            await session.flush()
            session.add_all([
                CompanyProfile(
                    user_id=verified_company.id,
                    company_name="Verified Example",
                    industry="Software",
                    verification_status="VERIFIED",
                ),
                CompanyProfile(
                    user_id=pending_company.id,
                    company_name="Pending Example",
                    industry="Data",
                    verification_status="PENDING",
                ),
                StudentProfile(
                    user_id=student_a.id,
                    full_name="Private Student A",
                    university="Example University",
                    major="Software",
                    graduation_year=2027,
                ),
                StudentProfile(
                    user_id=student_b.id,
                    full_name="Private Student B",
                    university="Example University",
                    major="Analytics",
                    graduation_year=2028,
                ),
            ])
            live_software = Internship(
                company_id=verified_company.id,
                title="Software Intern",
                description="Public listing",
                location="Remote",
                industry="Software Engineering",
                duration_months=3,
                work_mode="REMOTE",
                deadline=date.today() + timedelta(days=30),
                status="PUBLISHED",
            )
            live_data = Internship(
                company_id=pending_company.id,
                title="Data Intern",
                description="Public listing",
                location="Hybrid",
                industry="Data Analytics",
                duration_months=3,
                work_mode="HYBRID",
                deadline=date.today() + timedelta(days=10),
                status="PUBLISHED",
            )
            expired = Internship(
                company_id=verified_company.id,
                title="Expired Intern",
                description="Expired listing",
                location="Remote",
                industry="Finance",
                duration_months=3,
                work_mode="REMOTE",
                deadline=date.today() - timedelta(days=1),
                status="PUBLISHED",
            )
            draft = Internship(
                company_id=verified_company.id,
                title="Draft Intern",
                description="Unpublished listing",
                location="Remote",
                industry="Design",
                duration_months=3,
                work_mode="REMOTE",
                deadline=date.today() + timedelta(days=30),
                status="DRAFT",
            )
            session.add_all([live_software, live_data, expired, draft])
            await session.flush()
            session.add_all([
                Application(internship_id=live_software.id, student_id=student_a.id, status="SELECTED"),
                Application(internship_id=live_data.id, student_id=student_b.id, status="ACCEPTED"),
                Application(internship_id=expired.id, student_id=student_a.id, status="APPLIED"),
            ])
            await session.commit()

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.get("/api/v1/analytics/public-summary")

        assert response.status_code == 200
        data = response.json()
        assert data["live_internships"] == 2
        assert data["verified_companies"] == 1
        assert data["registered_students"] == 2
        assert data["offers_made"] == 2
        assert data["openings_by_field"] == [
            {"name": "Software Development", "count": 1},
            {"name": "Data & Analytics", "count": 1},
        ]
        assert data["openings_by_work_mode"] == [
            {"name": "Hybrid", "count": 1},
            {"name": "Remote", "count": 1},
        ]
        assert "Private Student A" not in response.text
        assert "private-student-a@example.test" not in response.text
        assert "Private Student B" not in response.text
        assert "private-student-b@example.test" not in response.text
    finally:
        app.dependency_overrides.pop(get_db, None)
        await engine.dispose()
