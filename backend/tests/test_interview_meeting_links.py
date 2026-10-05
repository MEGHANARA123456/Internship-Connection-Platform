from datetime import date, timedelta

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.v1.dependencies import get_db
from app.main import app
from app.models import Application, Interview, Internship, User
from app.models.base import Base


async def _noop_email(*args, **kwargs) -> None:
    return None


async def _create_test_context():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    async def override_db():
        async with sessions() as session:
            yield session

    app.dependency_overrides[get_db] = override_db
    client = AsyncClient(transport=ASGITransport(app=app), base_url="http://test")
    await client.__aenter__()
    return client, sessions, engine


async def _register_and_login(client: AsyncClient, sessions, email: str, role: str) -> dict[str, str]:
    if role == "COMPANY":
        route = "/api/v1/auth/register/company"
        payload = {"email": email, "password": "password123", "company_name": "Interview Co", "industry": "Technology"}
    else:
        route = "/api/v1/auth/register/student"
        payload = {"email": email, "password": "password123", "full_name": "Interview Student", "university": "Example U", "major": "CS", "graduation_year": 2027}
    response = await client.post(route, json=payload)
    assert response.status_code == 201
    async with sessions() as session:
        user = await session.scalar(select(User).where(User.email == email))
        user.is_verified = True
        await session.commit()
    login = await client.post("/api/v1/auth/login", json={"email": email, "password": "password123"})
    assert login.status_code == 200
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


async def _create_application(client: AsyncClient, sessions, company_headers: dict[str, str], student_headers: dict[str, str]) -> int:
    response = await client.post(
        "/api/v1/internships",
        headers=company_headers,
        json={
            "title": "Software Intern",
            "description": "Build software with our team",
            "location": "Remote",
            "industry": "Technology",
            "duration_months": 3,
            "stipend": 1000,
            "work_mode": "REMOTE",
            "skills": ["Python"],
            "deadline": str(date.today() + timedelta(days=30)),
        },
    )
    assert response.status_code == 201
    internship_id = response.json()["id"]
    async with sessions() as session:
        internship = await session.get(Internship, internship_id)
        internship.status = "PUBLISHED"
        await session.commit()
    application = await client.post(f"/api/v1/applications/internships/{internship_id}", headers=student_headers, json={})
    assert application.status_code == 201
    return application.json()["id"]


@pytest.mark.anyio
async def test_interview_api_handles_external_empty_and_legacy_links(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.api.v1 import auth, communication

    monkeypatch.setattr(auth, "send_dev_email", _noop_email)
    monkeypatch.setattr(communication, "send_dev_email", _noop_email)
    client, sessions, engine = await _create_test_context()
    try:
        company_headers = await _register_and_login(client, sessions, "interview-company@example.com", "COMPANY")
        student_headers = await _register_and_login(client, sessions, "interview-student@example.com", "STUDENT")
        application_id = await _create_application(client, sessions, company_headers, student_headers)
        scheduled_at = "2026-10-01T10:00:00Z"
        endpoint = f"/api/v1/applications/{application_id}/interviews"
        base_payload = {"scheduled_at": scheduled_at, "interview_type": "VIDEO"}

        invalid = await client.post(endpoint, headers=company_headers, json={**base_payload, "meeting_link": "not a url"})
        assert invalid.status_code == 422

        external = await client.post(
            endpoint,
            headers=company_headers,
            json={**base_payload, "meeting_link": "https://meet.google.com/abc-defg-hij"},
        )
        assert external.status_code == 201
        assert external.json()["meeting_link"] == "https://meet.google.com/abc-defg-hij"

        empty = await client.post(endpoint, headers=company_headers, json={**base_payload, "meeting_link": ""})
        assert empty.status_code == 201
        assert empty.json()["meeting_link"] is None

        async with sessions() as session:
            interview = await session.get(Interview, external.json()["id"])
            interview.meeting_link = "In-App Encrypted Video Room #26"
            await session.commit()

        listed = await client.get("/api/v1/interviews/my", headers=student_headers)
        assert listed.status_code == 200
        assert next(item for item in listed.json() if item["id"] == external.json()["id"])["meeting_link"] == "In-App Encrypted Video Room #26"

        updated = await client.patch(
            f"/api/v1/interviews/{empty.json()['id']}",
            headers=student_headers,
            json={"status": "RESCHEDULED", "meeting_link": ""},
        )
        assert updated.status_code == 200
        assert updated.json()["meeting_link"] is None
    finally:
        await client.__aexit__(None, None, None)
        app.dependency_overrides.pop(get_db, None)
        await engine.dispose()
