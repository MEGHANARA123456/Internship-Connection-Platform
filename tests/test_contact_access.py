from datetime import date, timedelta

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.v1.dependencies import get_db
from app.core.security import create_token
from app.main import app
from app.models import Application, CompanyProfile, Internship, StudentProfile, User, UserRole
from app.models.base import Base


@pytest.mark.anyio
async def test_contacts_only_include_relevant_people_without_email_addresses() -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    async def override_db():
        async with sessions() as session:
            yield session

    app.dependency_overrides[get_db] = override_db
    async with sessions() as db:
        student = User(email="contact-student@example.com", password_hash="fake", role=UserRole.STUDENT, is_active=True)
        company = User(email="contact-company@example.com", password_hash="fake", role=UserRole.COMPANY, is_active=True)
        unrelated_company = User(email="unrelated-company@example.com", password_hash="fake", role=UserRole.COMPANY, is_active=True)
        db.add_all([student, company, unrelated_company])
        await db.flush()
        db.add_all([
            StudentProfile(
                user_id=student.id,
                full_name="Contact Student",
                university="Example University",
                major="Computer Science",
                graduation_year=2027,
            ),
            CompanyProfile(user_id=company.id, company_name="Applied Company", industry="Technology"),
            CompanyProfile(user_id=unrelated_company.id, company_name="Unrelated Company", industry="Technology"),
        ])
        internship = Internship(
            company_id=company.id,
            title="Contact Internship",
            description="A role applied for by the student.",
            location="Remote",
            industry="Technology",
            duration_months=3,
            work_mode="REMOTE",
            deadline=date.today() + timedelta(days=30),
            status="PUBLISHED",
        )
        db.add(internship)
        await db.flush()
        db.add(Application(internship_id=internship.id, student_id=student.id))
        await db.commit()
        await db.refresh(student)

    token = create_token(str(student.id), student.role.value, "access", timedelta(minutes=30))
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.get(
                "/api/v1/contacts",
                headers={"Authorization": f"Bearer {token}"},
            )
        assert response.status_code == 200
        contacts = response.json()
        assert len(contacts) == 1
        assert contacts[0]["id"] == company.id
        assert "email" not in contacts[0]
    finally:
        app.dependency_overrides.clear()
        await engine.dispose()
