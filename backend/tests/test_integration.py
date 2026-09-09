from datetime import date, datetime, timedelta, timezone

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.v1.dependencies import get_db
from app.core.security import create_token
from app.main import app
from app.models import User, UserRole
from app.models.base import Base


@pytest.mark.anyio
async def test_complete_recruitment_lifecycle(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    async def override_db():
        async with sessions() as session:
            yield session

    app.dependency_overrides[get_db] = override_db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        student_data = {"email": "flow-student@example.com", "password": "strong-password", "full_name": "Flow Student", "university": "Example University", "major": "Computer Science", "graduation_year": 2027}
        company_data = {"email": "flow-company@example.com", "password": "strong-password", "company_name": "Flow Company", "industry": "Technology"}
        student = await client.post("/api/v1/auth/register/student", json=student_data)
        company = await client.post("/api/v1/auth/register/company", json=company_data)
        assert student.status_code == 201 and company.status_code == 201
        async with sessions() as session:
            users = (await session.scalars(select(User))).all()
            for u in users:
                u.is_verified = True
            await session.commit()
        student_login = await client.post("/api/v1/auth/login", json={"email": student_data["email"], "password": student_data["password"]})
        company_login = await client.post("/api/v1/auth/login", json={"email": company_data["email"], "password": company_data["password"]})
        student_headers = {"Authorization": f"Bearer {student_login.json()['access_token']}"}
        company_headers = {"Authorization": f"Bearer {company_login.json()['access_token']}"}
        profile = await client.put("/api/v1/profiles/student", headers=student_headers, json={**{key: student_data[key] for key in ("full_name", "university", "major", "graduation_year")}, "bio": "Ready to build", "skills": "python,testing"})
        assert profile.status_code == 200
        internship = await client.post("/api/v1/internships", headers=company_headers, json={"title": "Platform Intern", "description": "Build useful platform features", "location": "Remote", "industry": "Technology", "duration_months": 3, "stipend": 1000, "work_mode": "REMOTE", "skills": ["python"], "deadline": str(date.today() + timedelta(days=30))})
        assert internship.status_code == 201
        internship_id = internship.json()["id"]
        assert (await client.post(f"/api/v1/internships/{internship_id}/status", headers=company_headers, params={"target": "PENDING_APPROVAL"})).status_code == 200
        async with sessions() as session:
            admin = User(email="flow-admin@example.com", password_hash="unused", role=UserRole.ADMIN, is_active=True)
            session.add(admin)
            await session.commit()
            await session.refresh(admin)
            admin_token = create_token(str(admin.id), UserRole.ADMIN.value, "access", timedelta(minutes=30))
        admin_headers = {"Authorization": f"Bearer {admin_token}"}
        assert (await client.post(f"/api/v1/internships/{internship_id}/review", headers=admin_headers, params={"target": "PUBLISHED"})).status_code == 200
        application = await client.post(f"/api/v1/applications/internships/{internship_id}", headers=student_headers, json={"cover_note": "I would love to contribute."})
        assert application.status_code == 201
        application_id = application.json()["id"]
        for target in ("UNDER_REVIEW", "SHORTLISTED"):
            response = await client.patch(f"/api/v1/applications/{application_id}/status", headers=company_headers, json={"status": target})
            assert response.status_code == 200
        interview = await client.post(f"/api/v1/applications/{application_id}/interviews", headers=company_headers, json={"scheduled_at": datetime.now(timezone.utc).isoformat(), "interview_type": "VIDEO", "meeting_link": "https://meet.example.test/flow", "notes": "Technical discussion"})
        assert interview.status_code == 201
        selected = await client.patch(f"/api/v1/applications/{application_id}/status", headers=company_headers, json={"status": "SELECTED"})
        assert selected.status_code == 200
        notifications = await client.get("/api/v1/notifications", headers=student_headers)
        assert notifications.status_code == 200
        assert any("Selected" in notification["title"] for notification in notifications.json())
    app.dependency_overrides.clear()
    await engine.dispose()