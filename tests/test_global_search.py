from datetime import date

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.v1.dependencies import get_current_user, get_db
from app.main import app
from app.models import Application, CompanyProfile, Internship, StudentProfile, User, UserRole
from app.models.base import Base


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
async def test_global_search_is_role_scoped_and_escapes_wildcards():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    async def override_db():
        async with sessions() as session:
            yield session

    app.dependency_overrides[get_db] = override_db
    student_a = User(email="student-a@example.com", password_hash="x", role=UserRole.STUDENT)
    student_b = User(email="student-b@example.com", password_hash="x", role=UserRole.STUDENT)
    company_a = User(email="company-a@example.com", password_hash="x", role=UserRole.COMPANY)
    company_b = User(email="company-b@example.com", password_hash="x", role=UserRole.COMPANY)
    admin = User(email="admin@example.com", password_hash="x", role=UserRole.ADMIN)

    try:
        async with sessions() as session:
            session.add_all([student_a, student_b, company_a, company_b, admin])
            await session.flush()
            session.add_all([
                StudentProfile(user_id=student_a.id, full_name="A Student", university="North", major="CS", graduation_year=2027),
                StudentProfile(user_id=student_b.id, full_name="B Student", university="South", major="CS", graduation_year=2027),
                CompanyProfile(user_id=company_a.id, company_name="Company A", industry="Tech", verification_status="VERIFIED"),
                CompanyProfile(user_id=company_b.id, company_name="Company B", industry="Tech", verification_status="VERIFIED"),
            ])
            role_a = Internship(
                company_id=company_a.id, title="Backend%_Intern", description="d", location="Remote",
                industry="Tech", duration_months=3, work_mode="REMOTE", skills="Python",
                deadline=date(2027, 1, 1), status="PUBLISHED",
            )
            role_b = Internship(
                company_id=company_b.id, title="BackendXYZIntern", description="d", location="Remote",
                industry="Tech", duration_months=3, work_mode="REMOTE", skills="Python",
                deadline=date(2027, 1, 1), status="PUBLISHED",
            )
            session.add_all([role_a, role_b])
            await session.flush()
            application_a = Application(internship_id=role_a.id, student_id=student_a.id, status="APPLIED")
            application_b = Application(internship_id=role_b.id, student_id=student_b.id, status="APPLIED")
            session.add_all([application_a, application_b])
            await session.commit()
            app_a_id = application_a.id
            app_b_id = application_b.id
            role_a_id = role_a.id

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            app.dependency_overrides[get_current_user] = lambda: student_a
            short = await client.get("/api/v1/search", params={"q": "x"})
            assert short.status_code == 200
            assert short.json() == {"groups": []}

            literal_match = await client.get("/api/v1/search", params={"q": "%_"})
            assert literal_match.status_code == 200
            student_body = literal_match.json()
            role_items = next(group["items"] for group in student_body["groups"] if group["type"] == "internships")
            assert [item["id"] for item in role_items] == [role_a_id]
            assert all("@" not in str(item) for group in student_body["groups"] for item in group["items"])

            app.dependency_overrides[get_current_user] = lambda: student_a
            own_applications = await client.get("/api/v1/search", params={"q": "APPLIED"})
            own_ids = {
                item["id"]
                for group in own_applications.json()["groups"]
                if group["type"] == "applications"
                for item in group["items"]
            }
            assert app_a_id in own_ids
            assert app_b_id not in own_ids

            app.dependency_overrides[get_current_user] = lambda: company_a
            company_results = await client.get("/api/v1/search", params={"q": "Student"})
            applicant_items = next(
                group["items"] for group in company_results.json()["groups"]
                if group["type"] == "applicants"
            )
            assert all(item["title"] != "B Student" for item in applicant_items)
            assert all("@" not in str(item) for group in company_results.json()["groups"] for item in group["items"])

            app.dependency_overrides[get_current_user] = lambda: admin
            admin_results = await client.get("/api/v1/search", params={"q": "student-a@example.com"})
            user_items = next(group["items"] for group in admin_results.json()["groups"] if group["type"] == "users")
            assert any("student-a@example.com" in item["title"] or "student-a@example.com" in item["subtitle"] for item in user_items)
    finally:
        app.dependency_overrides.clear()
        await engine.dispose()
