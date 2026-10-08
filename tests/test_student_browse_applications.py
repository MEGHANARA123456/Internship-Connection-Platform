from datetime import date, timedelta

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.v1.dependencies import get_db
from app.core.security import create_token
from app.main import app
from app.models import Application, Internship, User, UserRole
from app.models.base import Base


@pytest.mark.anyio
async def test_students_do_not_see_applied_internships_until_withdrawn() -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    async def override_db():
        async with sessions() as db:
            yield db

    app.dependency_overrides[get_db] = override_db
    try:
        async with sessions() as db:
            company = User(
                email="browse-company@example.com",
                password_hash="test-hash",
                role=UserRole.COMPANY,
                is_active=True,
                is_verified=True,
            )
            student = User(
                email="browse-student@example.com",
                password_hash="test-hash",
                role=UserRole.STUDENT,
                is_active=True,
                is_verified=True,
            )
            other_student = User(
                email="other-student@example.com",
                password_hash="test-hash",
                role=UserRole.STUDENT,
                is_active=True,
                is_verified=True,
            )
            db.add_all([company, student, other_student])
            await db.flush()
            applied_job = Internship(
                company_id=company.id,
                title="Applied Internship",
                description="Already applied",
                location="Remote",
                industry="Technology",
                duration_months=3,
                stipend=1000,
                work_mode="REMOTE",
                skills="Python",
                deadline=date.today() + timedelta(days=30),
                status="PUBLISHED",
            )
            other_job = Internship(
                company_id=company.id,
                title="Other Internship",
                description="Still available",
                location="Remote",
                industry="Technology",
                duration_months=3,
                stipend=1000,
                work_mode="REMOTE",
                skills="Python",
                deadline=date.today() + timedelta(days=30),
                status="PUBLISHED",
            )
            db.add_all([applied_job, other_job])
            await db.flush()
            application = Application(
                internship_id=applied_job.id,
                student_id=student.id,
                status="APPLIED",
            )
            db.add(application)
            await db.commit()
            student_id = student.id
            other_student_id = other_student.id
            application_id = application.id
            applied_job_id = applied_job.id
            other_job_id = other_job.id

        student_header = {
            "Authorization": f"Bearer {create_token(str(student_id), 'STUDENT', 'access', timedelta(minutes=30))}",
        }
        other_student_header = {
            "Authorization": f"Bearer {create_token(str(other_student_id), 'STUDENT', 'access', timedelta(minutes=30))}",
        }
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            student_before = await client.get("/api/v1/internships", headers=student_header)
            other_student_response = await client.get("/api/v1/internships", headers=other_student_header)
            withdrawal = await client.patch(
                f"/api/v1/applications/{application_id}/withdraw",
                headers=student_header,
            )
            student_after = await client.get("/api/v1/internships", headers=student_header)

        before_ids = {item["id"] for item in student_before.json()["items"]}
        other_ids = {item["id"] for item in other_student_response.json()["items"]}
        after_ids = {item["id"] for item in student_after.json()["items"]}
        assert student_before.status_code == 200
        assert applied_job_id not in before_ids
        assert other_job_id in before_ids
        assert applied_job_id in other_ids
        assert other_job_id in other_ids
        assert withdrawal.status_code == 200
        assert applied_job_id in after_ids
    finally:
        app.dependency_overrides.clear()
        await engine.dispose()
