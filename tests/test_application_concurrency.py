import asyncio
from datetime import date, timedelta
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.v1.dependencies import get_db
from app.core.security import create_token
from app.main import app
from app.models import Application, CompanyProfile, Internship, StudentProfile, User, UserRole
from app.models.base import Base


@pytest.mark.anyio
async def test_concurrent_duplicate_applications_return_one_created_and_conflicts(tmp_path: Path) -> None:
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{tmp_path / 'concurrent-applications.db'}",
        connect_args={"timeout": 30},
    )
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    async def override_db():
        async with sessions() as session:
            yield session

    app.dependency_overrides[get_db] = override_db
    async with sessions() as session:
        student = User(
            email="parallel-student@example.com",
            password_hash="unused",
            role=UserRole.STUDENT,
            is_verified=True,
        )
        company = User(
            email="parallel-company@example.com",
            password_hash="unused",
            role=UserRole.COMPANY,
            is_verified=True,
        )
        session.add_all([student, company])
        await session.flush()
        session.add_all([
            StudentProfile(
                user_id=student.id,
                full_name="Parallel Student",
                university="Example University",
                major="Computer Science",
                graduation_year=2027,
                skills="Python",
            ),
            CompanyProfile(
                user_id=company.id,
                company_name="Example Company",
                industry="Technology",
                verification_status="VERIFIED",
            ),
        ])
        internship = Internship(
            company_id=company.id,
            title="Concurrency Intern",
            description="Test duplicate submissions",
            location="Remote",
            industry="Technology",
            duration_months=3,
            stipend=1000,
            work_mode="REMOTE",
            skills="Python",
            deadline=date.today() + timedelta(days=30),
            status="PUBLISHED",
        )
        session.add(internship)
        await session.commit()
        await session.refresh(student)
        await session.refresh(internship)
        student_id = student.id
        internship_id = internship.id

    token = create_token(str(student_id), UserRole.STUDENT.value, "access", timedelta(minutes=30))
    headers = {"Authorization": f"Bearer {token}"}
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app, client=("198.51.100.31", 4567)),
            base_url="http://application-concurrency-test",
        ) as client:
            responses = await asyncio.gather(*[
                client.post(
                    f"/api/v1/applications/internships/{internship_id}",
                    headers=headers,
                    json={"cover_note": "Submitting concurrently"},
                )
                for _ in range(5)
            ])

        statuses = [response.status_code for response in responses]
        assert statuses.count(201) == 1
        assert statuses.count(409) == 4
        async with sessions() as session:
            applications = await session.scalars(select(Application))
            assert len(list(applications)) == 1
    finally:
        app.dependency_overrides.clear()
        await engine.dispose()
