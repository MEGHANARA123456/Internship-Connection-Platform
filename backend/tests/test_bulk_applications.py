from datetime import date, timedelta
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.v1.dependencies import get_db
from app.main import app
from app.models import Application, Internship, User
from app.models.base import Base


@pytest.mark.anyio
async def test_bulk_status_update(monkeypatch: pytest.MonkeyPatch) -> None:
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
        # Register 1 company and 2 students
        c_reg = await client.post("/api/v1/auth/register/company", json={"email": "bulk-co@example.com", "password": "password123", "company_name": "Bulk Corp", "industry": "Tech"})
        s1_reg = await client.post("/api/v1/auth/register/student", json={"email": "s1@example.com", "password": "password123", "full_name": "Student One", "university": "U1", "major": "CS", "graduation_year": 2026})
        s2_reg = await client.post("/api/v1/auth/register/student", json={"email": "s2@example.com", "password": "password123", "full_name": "Student Two", "university": "U2", "major": "CS", "graduation_year": 2026})

        assert c_reg.status_code == 201 and s1_reg.status_code == 201 and s2_reg.status_code == 201

        async with sessions() as session:
            for u in (await session.scalars(select(User))).all():
                u.is_verified = True
            await session.commit()

        c_token = (await client.post("/api/v1/auth/login", json={"email": "bulk-co@example.com", "password": "password123"})).json()["access_token"]
        s1_token = (await client.post("/api/v1/auth/login", json={"email": "s1@example.com", "password": "password123"})).json()["access_token"]
        s2_token = (await client.post("/api/v1/auth/login", json={"email": "s2@example.com", "password": "password123"})).json()["access_token"]


        c_headers = {"Authorization": f"Bearer {c_token}"}
        s1_headers = {"Authorization": f"Bearer {s1_token}"}
        s2_headers = {"Authorization": f"Bearer {s2_token}"}

        # Post and publish internship
        job_res = await client.post(
            "/api/v1/internships",
            headers=c_headers,
            json={
                "title": "Backend Intern",
                "description": "API work and scalable backend microservices development",
                "location": "Remote",
                "industry": "Tech",

                "duration_months": 3,
                "stipend": 1000,
                "work_mode": "REMOTE",
                "skills": ["Python"],
                "deadline": str(date.today() + timedelta(days=30)),
            },
        )
        job_id = job_res.json()["id"]
        async with sessions() as session:
            job = await session.scalar(select(Internship).where(Internship.id == job_id))
            job.status = "PUBLISHED"
            await session.commit()

        # Both students apply
        app1_res = await client.post(f"/api/v1/applications/internships/{job_id}", headers=s1_headers, json={"cover_note": "Hire me 1"})
        app2_res = await client.post(f"/api/v1/applications/internships/{job_id}", headers=s2_headers, json={"cover_note": "Hire me 2"})
        app1_id = app1_res.json()["id"]
        app2_id = app2_res.json()["id"]

        # Move to UNDER_REVIEW first or test direct transition
        # Transition APPLIED -> UNDER_REVIEW
        bulk_review = await client.post(
            "/api/v1/applications/bulk-status",
            headers=c_headers,
            json={"application_ids": [app1_id, app2_id], "status": "UNDER_REVIEW"},
        )
        assert bulk_review.status_code == 200
        assert bulk_review.json()["updated_count"] == 2

        # Bulk shortlist
        bulk_shortlist = await client.post(
            "/api/v1/applications/bulk-status",
            headers=c_headers,
            json={"application_ids": [app1_id, app2_id], "status": "SHORTLISTED"},
        )
        assert bulk_shortlist.status_code == 200
        assert bulk_shortlist.json()["updated_count"] == 2
        assert app1_id in bulk_shortlist.json()["success_ids"]

        # Verify DB status
        async with sessions() as session:
            a1 = await session.scalar(select(Application).where(Application.id == app1_id))
            a2 = await session.scalar(select(Application).where(Application.id == app2_id))
            assert a1.status == "SHORTLISTED"
            assert a2.status == "SHORTLISTED"
