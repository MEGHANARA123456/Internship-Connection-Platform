from datetime import date, datetime, timedelta, timezone
import os

import pytest
from httpx import AsyncClient
from app.core.database import async_session_factory
from app.core.security import create_token
from app.models import User, UserRole


@pytest.mark.anyio
async def test_live_docker_recruitment_flow() -> None:
    if os.getenv("LIVE_STACK") != "1":
        pytest.skip("Set LIVE_STACK=1 to run against Docker Postgres")
    suffix = datetime.now(timezone.utc).strftime("%H%M%S%f")
    async with async_session_factory() as session:
        admin = User(email=f"live-admin-{suffix}@example.com", password_hash="unused", role=UserRole.ADMIN, is_active=True)
        session.add(admin)
        await session.commit()
        await session.refresh(admin)
        admin_token = create_token(str(admin.id), UserRole.ADMIN.value, "access", timedelta(minutes=30))

    async with AsyncClient(base_url=os.getenv("LIVE_API_URL", "http://localhost:8010")) as client:
        student_data = {"email": f"live-student-{suffix}@example.com", "password": "strong-password", "full_name": "Live Student", "university": "Live University", "major": "Computer Science", "graduation_year": 2027}
        company_data = {"email": f"live-company-{suffix}@example.com", "password": "strong-password", "company_name": "Live Company", "industry": "Technology"}
        student = await client.post("/api/v1/auth/register/student", json=student_data)
        company = await client.post("/api/v1/auth/register/company", json=company_data)
        assert student.status_code == 201 and company.status_code == 201
        student_login = await client.post("/api/v1/auth/login", json={"email": student_data["email"], "password": student_data["password"]})
        company_login = await client.post("/api/v1/auth/login", json={"email": company_data["email"], "password": company_data["password"]})
        student_headers = {"Authorization": f"Bearer {student_login.json()['access_token']}"}
        company_headers = {"Authorization": f"Bearer {company_login.json()['access_token']}"}
        await client.put("/api/v1/profiles/student", headers=student_headers, json={"full_name": "Live Student", "university": "Live University", "major": "Computer Science", "graduation_year": 2027, "bio": "Live flow", "skills": "python"})
        internship = await client.post("/api/v1/internships", headers=company_headers, json={"title": "Live Platform Intern", "description": "Build platform features with the team", "location": "Remote", "industry": "Technology", "duration_months": 3, "stipend": 1000, "work_mode": "REMOTE", "skills": ["python"], "deadline": str(date.today() + timedelta(days=30))})
        internship_id = internship.json()["id"]
        await client.post(f"/api/v1/internships/{internship_id}/status", headers=company_headers, params={"target": "PENDING_APPROVAL"})
        await client.post(f"/api/v1/internships/{internship_id}/review", headers={"Authorization": f"Bearer {admin_token}"}, params={"target": "PUBLISHED"})
        application = await client.post(f"/api/v1/applications/internships/{internship_id}", headers=student_headers, json={"cover_note": "Live application"})
        application_id = application.json()["id"]
        await client.patch(f"/api/v1/applications/{application_id}/status", headers=company_headers, json={"status": "UNDER_REVIEW"})
        await client.patch(f"/api/v1/applications/{application_id}/status", headers=company_headers, json={"status": "SHORTLISTED"})
        interview = await client.post(f"/api/v1/applications/{application_id}/interviews", headers=company_headers, json={"scheduled_at": datetime.now(timezone.utc).isoformat(), "interview_type": "VIDEO", "meeting_link": "https://meet.example.test/live", "notes": "Live interview"})
        assert interview.status_code == 201
        selected = await client.patch(f"/api/v1/applications/{application_id}/status", headers=company_headers, json={"status": "SELECTED"})
        notifications = await client.get("/api/v1/notifications", headers=student_headers)
        assert selected.status_code == 200
        assert any("Selected" in notification["title"] for notification in notifications.json())