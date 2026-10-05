from datetime import date, timedelta

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.v1.dependencies import get_db
from app.main import app
from app.models import Application, Internship, Notification, User
from app.models.base import Base


async def _noop_email(*args, **kwargs) -> None:
    return None


async def _create_client():
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


async def _register(client: AsyncClient, sessions, email: str, role: str) -> dict:
    if role == "COMPANY":
        payload = {"email": email, "password": "password123", "company_name": "Acme Labs", "industry": "Technology"}
        route = "/api/v1/auth/register/company"
    else:
        payload = {"email": email, "password": "password123", "full_name": email.split("@")[0], "university": "Example U", "major": "CS", "graduation_year": 2027}
        route = "/api/v1/auth/register/student"
    response = await client.post(route, json=payload)
    assert response.status_code == 201
    async with sessions() as session:
        user = await session.scalar(select(User).where(User.email == email))
        user.is_verified = True
        await session.commit()
    login = await client.post("/api/v1/auth/login", json={"email": email, "password": "password123"})
    assert login.status_code == 200
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


async def _create_published_internship(client: AsyncClient, sessions, company_headers: dict) -> int:
    response = await client.post(
        "/api/v1/internships",
        headers=company_headers,
        json={
            "title": "Software Intern",
            "description": "Build software with our team",
            "location": "Remote",
            "industry": "Technology",
            "duration_months": 3,
            "stipend": 1200,
            "work_mode": "REMOTE",
            "skills": ["Python"],
            "deadline": str(date.today() + timedelta(days=30)),
        },
    )
    assert response.status_code == 201
    internship_id = response.json()["id"]
    async with sessions() as session:
        internship = await session.scalar(select(Internship).where(Internship.id == internship_id))
        internship.status = "PUBLISHED"
        await session.commit()
    return internship_id


@pytest.mark.anyio
async def test_closing_internship_notifies_active_applicants(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.api.v1 import internships

    monkeypatch.setattr(internships, "send_dev_email", _noop_email)
    client, sessions, engine = await _create_client()
    try:
        company_headers = await _register(client, sessions, "close-company@example.com", "COMPANY")
        student_headers = [
            await _register(client, sessions, "close-student-one@example.com", "STUDENT"),
            await _register(client, sessions, "close-student-two@example.com", "STUDENT"),
        ]
        internship_id = await _create_published_internship(client, sessions, company_headers)
        for headers in student_headers:
            response = await client.post(f"/api/v1/applications/internships/{internship_id}", headers=headers, json={})
            assert response.status_code == 201

        close_response = await client.post(f"/api/v1/internships/{internship_id}/close", headers=company_headers)
        assert close_response.status_code == 200
        assert close_response.json()["status"] == "CLOSED"

        async with sessions() as session:
            notifications = list(await session.scalars(select(Notification).order_by(Notification.id)))
            applications = list(await session.scalars(select(Application).order_by(Application.id)))
            assert len(notifications) == 2
            assert {item.user_id for item in notifications} == {item.student_id for item in applications}
            assert all("Acme Labs has closed Software Intern." in item.body for item in notifications)
            assert [item.status for item in applications] == ["APPLIED", "APPLIED"]
    finally:
        await client.__aexit__(None, None, None)
        app.dependency_overrides.clear()
        await engine.dispose()


@pytest.mark.anyio
async def test_accept_offer_authorization_transition_and_idempotency(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.api.v1 import applications

    monkeypatch.setattr(applications, "send_dev_email", _noop_email)
    client, sessions, engine = await _create_client()
    try:
        company_headers = await _register(client, sessions, "offer-company@example.com", "COMPANY")
        student_headers = await _register(client, sessions, "offer-student@example.com", "STUDENT")
        other_student_headers = await _register(client, sessions, "other-student@example.com", "STUDENT")
        internship_id = await _create_published_internship(client, sessions, company_headers)
        created = await client.post(f"/api/v1/applications/internships/{internship_id}", headers=student_headers, json={})
        application_id = created.json()["id"]
        url = f"/api/v1/applications/{application_id}/accept-offer"
        body = {"signature_name": "Offer Student", "signature_mode": "type"}

        wrong_student = await client.post(url, headers=other_student_headers, json=body)
        assert wrong_student.status_code == 404
        wrong_status = await client.post(url, headers=student_headers, json=body)
        assert wrong_status.status_code == 409

        async with sessions() as session:
            application = await session.get(Application, application_id)
            application.status = "SELECTED"
            await session.commit()

        accepted = await client.post(url, headers=student_headers, json=body)
        assert accepted.status_code == 200
        assert accepted.json()["status"] == "ACCEPTED"
        assert accepted.json()["offer_signed_name"] == "Offer Student"
        assert accepted.json()["offer_accepted_at"]

        repeated = await client.post(url, headers=student_headers, json={"signature_name": "Changed Name", "signature_mode": "draw"})
        assert repeated.status_code == 200
        assert repeated.json()["offer_signed_name"] == "Offer Student"

        async with sessions() as session:
            notifications = list(await session.scalars(select(Notification)))
            assert len(notifications) == 1
            assert notifications[0].body == "offer-student accepted the offer for Software Intern"
    finally:
        await client.__aexit__(None, None, None)
        app.dependency_overrides.clear()
        await engine.dispose()
