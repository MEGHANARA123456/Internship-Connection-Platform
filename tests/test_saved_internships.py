from datetime import date, timedelta
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.v1.dependencies import get_db
from app.chatbot.tools.read_only import _student_saved_internships
from app.main import app
from app.models import Application, CompanyProfile, Internship, SavedInternship, User
from app.models.base import Base


@pytest.mark.anyio
async def test_saved_internships_flow(monkeypatch: pytest.MonkeyPatch) -> None:
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
        # Register student & company
        student_reg = await client.post(
            "/api/v1/auth/register/student",
            json={
                "email": "saved-student@example.com",
                "password": "password123",
                "full_name": "Saved Tester",
                "university": "Tech State",
                "major": "Computer Science",
                "graduation_year": 2026,
            },
        )
        company_reg = await client.post(
            "/api/v1/auth/register/company",
            json={
                "email": "saved-company@example.com",
                "password": "password123",
                "company_name": "Bookmarked Corp",
                "industry": "Technology",
            },
        )
        assert student_reg.status_code == 201
        assert company_reg.status_code == 201

        # Verify users
        async with sessions() as session:
            for u in (await session.scalars(select(User))).all():
                u.is_verified = True
            await session.commit()

        # Login
        s_login = await client.post("/api/v1/auth/login", json={"email": "saved-student@example.com", "password": "password123"})
        c_login = await client.post("/api/v1/auth/login", json={"email": "saved-company@example.com", "password": "password123"})
        s_token = s_login.json()["access_token"]
        c_token = c_login.json()["access_token"]
        s_headers = {"Authorization": f"Bearer {s_token}"}
        c_headers = {"Authorization": f"Bearer {c_token}"}

        # Company posts internship
        job_res = await client.post(
            "/api/v1/internships",
            headers=c_headers,
            json={
                "title": "React Frontend Intern",
                "description": "Build high-performance UIs",
                "location": "Remote",
                "industry": "Technology",
                "duration_months": 3,
                "stipend": 1200,
                "work_mode": "REMOTE",
                "skills": ["React", "TypeScript"],
                "deadline": str(date.today() + timedelta(days=30)),
            },
        )
        assert job_res.status_code == 201
        job_id = job_res.json()["id"]

        # Publish internship
        await client.post(f"/api/v1/internships/{job_id}/status", headers=c_headers, params={"target": "PENDING_APPROVAL"})
        # Directly publish via DB for test speed
        async with sessions() as session:
            job = await session.scalar(select(Internship).where(Internship.id == job_id))
            job.status = "PUBLISHED"
            company_profile = await session.scalar(
                select(CompanyProfile).where(CompanyProfile.user_id == job.company_id)
            )
            company_profile.verification_status = "VERIFIED"
            extra_roles = [
                Internship(
                    company_id=job.company_id,
                    title="Applied Role",
                    description="A role with an active student application.",
                    location="Remote",
                    industry="Technology",
                    duration_months=3,
                    stipend=1000,
                    work_mode="REMOTE",
                    skills="Python",
                    deadline=date.today() + timedelta(days=30),
                    status="PUBLISHED",
                ),
                Internship(
                    company_id=job.company_id,
                    title="Closed Role",
                    description="A role closed by the company.",
                    location="Remote",
                    industry="Technology",
                    duration_months=3,
                    stipend=1000,
                    work_mode="REMOTE",
                    skills="Python",
                    deadline=date.today() + timedelta(days=30),
                    status="CLOSED",
                ),
                Internship(
                    company_id=job.company_id,
                    title="Expired Role",
                    description="A role with a passed deadline.",
                    location="Remote",
                    industry="Technology",
                    duration_months=3,
                    stipend=1000,
                    work_mode="REMOTE",
                    skills="Python",
                    deadline=date.today() - timedelta(days=1),
                    status="PUBLISHED",
                ),
                Internship(
                    company_id=job.company_id,
                    title="Draft Role",
                    description="A draft role not available to students.",
                    location="Remote",
                    industry="Technology",
                    duration_months=3,
                    stipend=1000,
                    work_mode="REMOTE",
                    skills="Python",
                    deadline=date.today() + timedelta(days=30),
                    status="DRAFT",
                ),
                Internship(
                    company_id=job.company_id,
                    title="Withdrawn Application Role",
                    description="A role whose application was withdrawn.",
                    location="Remote",
                    industry="Technology",
                    duration_months=3,
                    stipend=1000,
                    work_mode="REMOTE",
                    skills="Python",
                    deadline=date.today() + timedelta(days=30),
                    status="PUBLISHED",
                ),
            ]
            session.add_all(extra_roles)
            await session.flush()
            student = await session.scalar(
                select(User).where(User.email == "saved-student@example.com")
            )
            student_id = student.id
            session.add_all([
                SavedInternship(student_id=student_id, internship_id=role.id)
                for role in extra_roles
            ])
            session.add_all([
                Application(
                    student_id=student_id,
                    internship_id=extra_roles[0].id,
                    status="SHORTLISTED",
                ),
                Application(
                    student_id=student_id,
                    internship_id=extra_roles[4].id,
                    status="WITHDRAWN",
                ),
            ])
            await session.commit()

        # Student saves internship
        save_res = await client.post(f"/api/v1/internships/{job_id}/save", headers=s_headers)
        assert save_res.status_code == 200
        assert save_res.json()["is_saved"] is True

        # Duplicate save should be idempotent
        save_dup = await client.post(f"/api/v1/internships/{job_id}/save", headers=s_headers)
        assert save_dup.status_code == 200
        assert save_dup.json()["is_saved"] is True

        # Check list of saved internships
        saved_list = await client.get("/api/v1/internships/saved", headers=s_headers)
        assert saved_list.status_code == 200
        items = saved_list.json()
        assert len(items) == 6
        saved_by_title = {item["title"]: item for item in items}
        assert saved_by_title["React Frontend Intern"]["availability"] == "OPEN"
        assert saved_by_title["Closed Role"]["availability"] == "CLOSED"
        assert saved_by_title["Expired Role"]["availability"] == "EXPIRED"
        assert saved_by_title["Draft Role"]["availability"] == "UNAVAILABLE"
        assert saved_by_title["Applied Role"]["application_status"] == "SHORTLISTED"
        assert saved_by_title["Applied Role"]["application_id"] is not None
        assert saved_by_title["Withdrawn Application Role"]["application_status"] == "WITHDRAWN"
        assert saved_by_title["Withdrawn Application Role"]["availability"] == "OPEN"
        assert all(item["is_saved"] is True and "match_score" in item for item in items)

        summary = await client.get("/api/v1/internships/saved/summary", headers=s_headers)
        assert summary.status_code == 200
        assert summary.json() == {"total": 6, "open": 2, "applied": 1, "closed": 3}
        nav_counts = await client.get("/api/v1/students/me/nav-counts", headers=s_headers)
        assert nav_counts.json()["saved"] == summary.json()["total"]
        insights = await client.get(
            "/api/v1/students/me/insights?range=all",
            headers=s_headers,
        )
        assert insights.json()["kpis"]["saved_roles"]["value"] == summary.json()["total"]
        async with sessions() as session:
            student = await session.scalar(
                select(User).where(User.email == "saved-student@example.com")
            )
            saved_answer = await _student_saved_internships(session, student)
            assert saved_answer.answer.startswith("6 saved roles (2 open, 1 applied).")

        # Check browse endpoint reflects is_saved = True
        browse_res = await client.get("/api/v1/internships", headers=s_headers)
        assert browse_res.status_code == 200
        browse_items = browse_res.json()["items"]
        matching = [b for b in browse_items if b["id"] == job_id]
        assert len(matching) == 1
        assert matching[0]["is_saved"] is True
        assert all(item["id"] != saved_by_title["Applied Role"]["id"] for item in browse_items)

        # Unsave internship
        unsave_res = await client.delete(f"/api/v1/internships/{job_id}/save", headers=s_headers)
        assert unsave_res.status_code == 200
        assert unsave_res.json()["is_saved"] is False

        # Other saved roles remain after unsaving one role.
        saved_remaining = await client.get("/api/v1/internships/saved", headers=s_headers)
        assert saved_remaining.status_code == 200
        assert len(saved_remaining.json()) == 5
        assert (await client.get("/api/v1/internships/saved/summary", headers=s_headers)).json()["total"] == 5
