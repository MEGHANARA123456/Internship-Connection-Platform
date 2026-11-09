from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.v1.dependencies import get_db
from app.core.security import create_token
from app.main import app
from app.models import (
    Application,
    CompanyProfile,
    Internship,
    SkillAttempt,
    SkillBadge,
    StudentProfile,
    User,
    UserRole,
)
from app.models.base import Base


@pytest.fixture
async def pipeline_data(monkeypatch: pytest.MonkeyPatch):
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    async def override_db():
        async with sessions() as session:
            yield session

    monkeypatch.setitem(app.dependency_overrides, get_db, override_db)
    now = datetime.now(timezone.utc)
    async with sessions() as session:
        company = User(email="pipeline-company@example.com", password_hash="x", role=UserRole.COMPANY)
        other_company = User(email="other-company@example.com", password_hash="x", role=UserRole.COMPANY)
        students = [
            User(email="amy@example.com", password_hash="x", role=UserRole.STUDENT),
            User(email="bea@example.com", password_hash="x", role=UserRole.STUDENT),
            User(email="zed@example.com", password_hash="x", role=UserRole.STUDENT),
            User(email="outsider@example.com", password_hash="x", role=UserRole.STUDENT),
        ]
        session.add_all([company, other_company, *students])
        await session.flush()
        amy, bea, zed, outsider = students
        session.add_all([
            CompanyProfile(user_id=company.id, company_name="Pipeline Co", industry="Technology"),
            CompanyProfile(user_id=other_company.id, company_name="Other Co", industry="Technology"),
            StudentProfile(
                user_id=amy.id,
                full_name="Amy Applicant",
                university="North University",
                major="Computer Science",
                graduation_year=2027,
                skills="Python, SQL",
                show_verified_badges=True,
            ),
            StudentProfile(
                user_id=bea.id,
                full_name="Bea Applicant",
                university="North University",
                major="Computer Science",
                graduation_year=2027,
                skills="Python",
            ),
            StudentProfile(
                user_id=zed.id,
                full_name="Zed Applicant",
                university="South University",
                major="Design",
                graduation_year=2027,
                skills="Java",
            ),
            StudentProfile(
                user_id=outsider.id,
                full_name="Outside Applicant",
                university="North University",
                major="Computer Science",
                graduation_year=2027,
                skills="Python, SQL",
            ),
        ])
        roles = [
            Internship(
                company_id=company.id,
                title="Python Data Intern",
                description="Build data tools.",
                location="Pune",
                industry="Technology",
                duration_months=3,
                work_mode="REMOTE",
                skills="Python, SQL",
                deadline=date.today() + timedelta(days=30),
                status="PUBLISHED",
            ),
            Internship(
                company_id=company.id,
                title="Python Data Intern",
                description="Build data tools.",
                location="Mumbai",
                industry="Technology",
                duration_months=3,
                work_mode="REMOTE",
                skills="Python, SQL",
                deadline=date.today() + timedelta(days=30),
                status="PUBLISHED",
            ),
            Internship(
                company_id=company.id,
                title="Design Assistant",
                description="Support design systems.",
                location="Remote",
                industry="Design",
                duration_months=3,
                work_mode="REMOTE",
                skills="Design",
                deadline=date.today() + timedelta(days=30),
                status="PUBLISHED",
            ),
            Internship(
                company_id=other_company.id,
                title="Other Company Role",
                description="Build data tools.",
                location="Remote",
                industry="Technology",
                duration_months=3,
                work_mode="REMOTE",
                skills="Python, SQL",
                deadline=date.today() + timedelta(days=30),
                status="PUBLISHED",
            ),
        ]
        session.add_all(roles)
        await session.flush()
        first_role, second_role, third_role, other_role = roles
        applications = [
            Application(
                internship_id=first_role.id,
                student_id=amy.id,
                status="SHORTLISTED",
                created_at=now - timedelta(days=1),
            ),
            Application(
                internship_id=second_role.id,
                student_id=bea.id,
                status="APPLIED",
                created_at=now - timedelta(days=2),
            ),
            Application(
                internship_id=third_role.id,
                student_id=zed.id,
                status="APPLIED",
                created_at=now - timedelta(days=3),
            ),
            Application(
                internship_id=other_role.id,
                student_id=outsider.id,
                status="APPLIED",
                created_at=now,
            ),
        ]
        session.add_all(applications)
        await session.flush()
        attempt = SkillAttempt(
            student_id=amy.id,
            topic="python",
            status="COMPLETED",
            question_ids=[],
            question_snapshots=[],
            option_orders=[],
            started_at=now - timedelta(days=1),
            submitted_at=now - timedelta(days=1),
            expires_at=now,
        )
        session.add(attempt)
        await session.flush()
        session.add(SkillBadge(
            student_id=amy.id,
            topic="python",
            title="Python Specialist",
            level="EXPERT",
            score=90,
            attempt_id=attempt.id,
            earned_at=now - timedelta(days=1),
            expires_at=now + timedelta(days=30),
        ))
        await session.commit()
        company_id = company.id
        other_company_id = other_company.id
        role_ids = [role.id for role in roles]
        student_ids = [student.id for student in students]

    company_token = create_token(str(company_id), UserRole.COMPANY.value, "access", timedelta(minutes=30))
    other_token = create_token(str(other_company_id), UserRole.COMPANY.value, "access", timedelta(minutes=30))
    yield {
        "sessions": sessions,
        "company_headers": {"Authorization": f"Bearer {company_token}"},
        "other_headers": {"Authorization": f"Bearer {other_token}"},
        "role_ids": role_ids,
        "student_ids": student_ids,
    }
    await engine.dispose()


@pytest.mark.anyio
async def test_company_pipeline_filters_combine_and_remain_company_scoped(pipeline_data) -> None:
    role_ids = pipeline_data["role_ids"]
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        role_filter = await client.get(
            f"/api/v1/applications/company/search?internship={role_ids[1]}",
            headers=pipeline_data["company_headers"],
        )
        shortlisted = await client.get(
            "/api/v1/applications/company/search?applicant_filter=shortlisted",
            headers=pipeline_data["company_headers"],
        )
        not_reviewed = await client.get(
            "/api/v1/applications/company/search?applicant_filter=not_reviewed",
            headers=pipeline_data["company_headers"],
        )
        verified = await client.get(
            "/api/v1/applications/company/search?verified_skill=true",
            headers=pipeline_data["company_headers"],
        )
        combined = await client.get(
            f"/api/v1/applications/company/search?internship={role_ids[1]}&applicant_filter=not_reviewed&skills=Python&education=North&search=bea%40example.com",
            headers=pipeline_data["company_headers"],
        )
        other_company = await client.get(
            "/api/v1/applications/company/search",
            headers=pipeline_data["other_headers"],
        )

    assert role_filter.status_code == shortlisted.status_code == 200
    assert [item["student_name"] for item in role_filter.json()["items"]] == ["Bea Applicant"]
    assert [item["student_name"] for item in shortlisted.json()["items"]] == ["Amy Applicant"]
    assert {item["student_name"] for item in not_reviewed.json()["items"]} == {"Bea Applicant", "Zed Applicant"}
    assert [item["student_name"] for item in verified.json()["items"]] == ["Amy Applicant"]
    assert [item["student_name"] for item in combined.json()["items"]] == ["Bea Applicant"]
    assert other_company.status_code == 200
    assert [item["student_name"] for item in other_company.json()["items"]] == ["Outside Applicant"]


@pytest.mark.anyio
async def test_company_pipeline_high_match_and_best_match_are_server_sorted_across_pages(pipeline_data) -> None:
    headers = pipeline_data["company_headers"]
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        high_match = await client.get(
            "/api/v1/applications/company/search?applicant_filter=high_match",
            headers=headers,
        )
        first_page = await client.get(
            "/api/v1/applications/company/search?sort=best_match&page=1&page_size=1",
            headers=headers,
        )
        second_page = await client.get(
            "/api/v1/applications/company/search?sort=best_match&page=2&page_size=1",
            headers=headers,
        )
        alphabetical = await client.get(
            "/api/v1/applications/company/search?sort=name",
            headers=headers,
        )

    assert high_match.status_code == 200
    assert all(item["match_score"] is not None and item["match_score"] >= 70 for item in high_match.json()["items"])
    assert first_page.status_code == second_page.status_code == alphabetical.status_code == 200
    scores = [first_page.json()["items"][0]["match_score"], second_page.json()["items"][0]["match_score"]]
    assert scores[0] >= scores[1]
    assert alphabetical.json()["items"][0]["student_name"] == "Amy Applicant"
