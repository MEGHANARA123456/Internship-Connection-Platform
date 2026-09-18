from datetime import date, timedelta
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.v1.dependencies import get_db
from app.main import app
from app.models import Internship, SavedInternship, User, UserRole
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
        assert len(items) == 1
        assert items[0]["id"] == job_id
        assert items[0]["is_saved"] is True

        # Check browse endpoint reflects is_saved = True
        browse_res = await client.get("/api/v1/internships", headers=s_headers)
        assert browse_res.status_code == 200
        browse_items = browse_res.json()["items"]
        matching = [b for b in browse_items if b["id"] == job_id]
        assert len(matching) == 1
        assert matching[0]["is_saved"] is True

        # Unsave internship
        unsave_res = await client.delete(f"/api/v1/internships/{job_id}/save", headers=s_headers)
        assert unsave_res.status_code == 200
        assert unsave_res.json()["is_saved"] is False

        # Verify saved list is empty
        saved_empty = await client.get("/api/v1/internships/saved", headers=s_headers)
        assert saved_empty.status_code == 200
        assert len(saved_empty.json()) == 0
