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
async def test_company_reviews_flow(monkeypatch: pytest.MonkeyPatch) -> None:
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
        c_reg = await client.post("/api/v1/auth/register/company", json={"email": "rev-co@example.com", "password": "password123", "company_name": "Reviewable Inc", "industry": "Finance"})
        s_reg = await client.post("/api/v1/auth/register/student", json={"email": "rev-st@example.com", "password": "password123", "full_name": "Alice Intern", "university": "MIT", "major": "EECS", "graduation_year": 2025})
        assert c_reg.status_code == 201 and s_reg.status_code == 201

        async with sessions() as session:
            for u in (await session.scalars(select(User))).all():
                u.is_verified = True
            await session.commit()

        c_token = (await client.post("/api/v1/auth/login", json={"email": "rev-co@example.com", "password": "password123"})).json()["access_token"]
        s_token = (await client.post("/api/v1/auth/login", json={"email": "rev-st@example.com", "password": "password123"})).json()["access_token"]

        c_headers = {"Authorization": f"Bearer {c_token}"}
        s_headers = {"Authorization": f"Bearer {s_token}"}

        # Post and publish internship
        job_res = await client.post(
            "/api/v1/internships",
            headers=c_headers,
            json={
                "title": "Quantitative Intern",
                "description": "Financial modeling",
                "location": "New York, NY",
                "industry": "Finance",
                "duration_months": 3,
                "stipend": 2500,
                "work_mode": "ONSITE",
                "skills": ["Python", "Pandas"],
                "deadline": str(date.today() + timedelta(days=30)),
            },
        )
        job_id = job_res.json()["id"]
        company_id = job_res.json()["company_id"]

        async with sessions() as session:
            job = await session.scalar(select(Internship).where(Internship.id == job_id))
            job.status = "PUBLISHED"
            await session.commit()

        # Apply
        app_res = await client.post(f"/api/v1/applications/internships/{job_id}", headers=s_headers, json={"cover_note": "Excited for quant!"})
        app_id = app_res.json()["id"]

        # If student tries to review before being SELECTED -> 403 Forbidden
        rev_forbidden = await client.post(
            f"/api/v1/companies/{company_id}/reviews",
            headers=s_headers,
            json={"internship_id": job_id, "rating": 5, "review_text": "Great place to learn and grow!"},
        )
        assert rev_forbidden.status_code == 403

        # Mark application as SELECTED in DB
        async with sessions() as session:
            application = await session.scalar(select(Application).where(Application.id == app_id))
            application.status = "SELECTED"
            await session.commit()

        # Now review should succeed
        rev_success = await client.post(
            f"/api/v1/companies/{company_id}/reviews",
            headers=s_headers,
            json={"internship_id": job_id, "rating": 5, "review_text": "Incredible mentorship and challenging engineering projects!"},
        )
        assert rev_success.status_code == 201
        assert rev_success.json()["rating"] == 5
        assert rev_success.json()["student_name"] == "Alice Intern"

        # Duplicate review should be 409 Conflict
        rev_dup = await client.post(
            f"/api/v1/companies/{company_id}/reviews",
            headers=s_headers,
            json={"internship_id": job_id, "rating": 4, "review_text": "Duplicate attempt should be rejected"},
        )
        assert rev_dup.status_code == 409

        # Fetch reviews summary
        summary = await client.get(f"/api/v1/companies/{company_id}/reviews")
        assert summary.status_code == 200
        data = summary.json()
        assert data["total_reviews"] == 1
        assert data["average_rating"] == 5.0
        assert len(data["reviews"]) == 1
