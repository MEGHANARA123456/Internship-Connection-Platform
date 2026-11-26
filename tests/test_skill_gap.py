from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import event, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.v1.dependencies import get_db
from app.core.config import Settings
from app.core.security import create_token
from app.main import app
from app.models import (
    AuditLog,
    Internship,
    LearningCategory,
    LearningResource,
    RoleSkillRequirement,
    Skill,
    SkillGapReport,
    StudentProfile,
    User,
    UserRole,
)
from app.models.base import Base
from app.services.skill_gap_seed import seed_skill_gap_catalog
from app.services.learning_library_seed import seed_learning_library
from app.services import skill_gap
from app.services.interview_llm import InterviewLLMProvider


@pytest.fixture
async def skill_gap_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'skill-gap.sqlite'}")

    @event.listens_for(engine.sync_engine, "connect")
    def enable_sqlite_foreign_keys(connection, _record) -> None:
        cursor = connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    async def override_db():
        async with sessions() as db:
            yield db

    app.dependency_overrides[get_db] = override_db
    async with sessions() as db:
        student = User(
            email="gap-student@example.test",
            password_hash="test",
            role=UserRole.STUDENT,
            is_active=True,
            is_verified=True,
        )
        other_student = User(
            email="gap-other@example.test",
            password_hash="test",
            role=UserRole.STUDENT,
            is_active=True,
            is_verified=True,
        )
        company = User(
            email="gap-company@example.test",
            password_hash="test",
            role=UserRole.COMPANY,
            is_active=True,
            is_verified=True,
        )
        admin = User(
            email="gap-admin@example.test",
            password_hash="test",
            role=UserRole.ADMIN,
            is_active=True,
            is_verified=True,
        )
        db.add_all([student, other_student, company, admin])
        await db.commit()
        for user in (student, other_student, company, admin):
            await db.refresh(user)
        student_profile = StudentProfile(
            user_id=student.id,
            full_name="Gap Student",
            university="Test University",
            major="Computer Science",
            graduation_year=2027,
            skills="Python, sklearn",
        )
        db.add(student_profile)
        await db.commit()
        await seed_skill_gap_catalog(db)
        await seed_learning_library(db)
        category = await db.scalar(
            select(LearningCategory).where(LearningCategory.slug == "programming")
        )
        python_skill = await db.scalar(select(Skill).where(Skill.canonical_name == "Python"))
        db.add(
            LearningResource(
                slug="skill-gap-python-resource",
                category_id=category.id,
                title="Official Python Tutorial",
                description="Learn Python.",
                url="https://docs.python.org/3/tutorial/",
                resource_type="link",
                level="BEGINNER",
                role_tags=["python-developer"],
                topic_tags=["python"],
                active=True,
                verified_at=datetime.now(timezone.utc),
            )
        )
        company_user_id = company.id
        internship = Internship(
            company_id=company_user_id,
            title="Python Intern",
            description="A published test role.",
            location="Remote",
            industry="Software",
            duration_months=3,
            stipend=1000,
            work_mode="REMOTE",
            skills="Python, sklearn, Unknown Platform",
            deadline=date.today() + timedelta(days=30),
            status="PUBLISHED",
        )
        db.add(internship)
        await db.commit()
        await db.refresh(internship)
        ids = {
            "student": student.id,
            "other_student": other_student.id,
            "company": company.id,
            "admin": admin.id,
            "internship": internship.id,
            "python_skill": python_skill.id,
        }

    async def empty_resume(_db, _student_id: int) -> str:
        return ""

    monkeypatch.setattr(skill_gap, "get_student_resume_text", empty_resume)

    def headers(user_id: int, role: str) -> dict[str, str]:
        token = create_token(str(user_id), role, "access", timedelta(minutes=30))
        return {"Authorization": f"Bearer {token}"}

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        try:
            yield {"client": client, "headers": headers, "ids": ids, "sessions": sessions}
        finally:
            app.dependency_overrides.clear()
            await engine.dispose()


@pytest.mark.anyio
async def test_alias_matching_and_empty_resume_are_deterministic(skill_gap_env):
    client = skill_gap_env["client"]
    student_id = skill_gap_env["ids"]["student"]
    response = await client.post(
        "/api/v1/skill-gaps/reports",
        headers=skill_gap_env["headers"](student_id, "STUDENT"),
        json={"target_role": "data-scientist"},
    )
    assert response.status_code == 201
    report = response.json()
    assert {"Python", "Scikit-learn"}.issubset(set(report["matched_skills"]))
    assert "Python" not in report["missing_required_skills"]
    assert "Scikit-learn" not in report["missing_required_skills"]
    assert report["estimated_match_score"] is not None
    assert "Upload a readable resume" in report["resume_tips"][0]
    assert all(
        suggestion["message"].startswith("Learn ")
        and "then add it" in suggestion["message"]
        for suggestion in report["learning_suggestions"]
    )


@pytest.mark.anyio
async def test_unknown_role_and_internship_target_validation(skill_gap_env):
    client = skill_gap_env["client"]
    headers = skill_gap_env["headers"](skill_gap_env["ids"]["student"], "STUDENT")
    unknown = await client.post(
        "/api/v1/skill-gaps/reports",
        headers=headers,
        json={"target_role": "unlisted-role"},
    )
    assert unknown.status_code == 422
    internship = await client.post(
        "/api/v1/skill-gaps/reports",
        headers=headers,
        json={"internship_id": skill_gap_env["ids"]["internship"]},
    )
    assert internship.status_code == 201
    assert internship.json()["target_type"] == "INTERNSHIP"
    assert "Unknown Platform" not in internship.json()["matched_skills"]
    assert "Unknown Platform" in internship.json()["missing_required_skills"]


@pytest.mark.anyio
async def test_reports_are_immutable_history_and_owner_scoped(skill_gap_env):
    client = skill_gap_env["client"]
    owner_id = skill_gap_env["ids"]["student"]
    owner_headers = skill_gap_env["headers"](owner_id, "STUDENT")
    first = await client.post(
        "/api/v1/skill-gaps/reports",
        headers=owner_headers,
        json={"target_role": "python-developer"},
    )
    second = await client.post(
        "/api/v1/skill-gaps/reports",
        headers=owner_headers,
        json={"target_role": "python-developer"},
    )
    assert first.status_code == second.status_code == 201
    assert first.json()["id"] != second.json()["id"]
    other_headers = skill_gap_env["headers"](skill_gap_env["ids"]["other_student"], "STUDENT")
    denied = await client.get(
        f"/api/v1/skill-gaps/reports/{first.json()['id']}",
        headers=other_headers,
    )
    assert denied.status_code == 404
    history = await client.get("/api/v1/skill-gaps/reports", headers=owner_headers)
    assert len(history.json()) == 2
    own_report = await client.get(
        f"/api/v1/skill-gaps/reports/{first.json()['id']}",
        headers=owner_headers,
    )
    assert own_report.status_code == 200


@pytest.mark.anyio
async def test_company_and_admin_cannot_read_student_reports(skill_gap_env):
    client = skill_gap_env["client"]
    for role in ("COMPANY", "ADMIN"):
        response = await client.get(
            "/api/v1/skill-gaps/reports",
            headers=skill_gap_env["headers"](skill_gap_env["ids"][role.lower()], role),
        )
        assert response.status_code == 403
    unauthenticated = await client.get("/api/v1/skill-gaps/reports")
    assert unauthenticated.status_code == 401


@pytest.mark.anyio
async def test_admin_role_map_edit_is_audited_without_student_content(skill_gap_env):
    client = skill_gap_env["client"]
    admin_headers = skill_gap_env["headers"](skill_gap_env["ids"]["admin"], "ADMIN")
    listed = await client.get("/api/v1/admin/skill-gaps/roles", headers=admin_headers)
    assert listed.status_code == 200
    updated = await client.put(
        "/api/v1/admin/skill-gaps/roles/python-developer",
        headers=admin_headers,
        json={
            "role_label": "Python Developer",
            "requirements": [
                {"skill_id": skill_gap_env["ids"]["python_skill"], "requirement_type": "required"}
            ],
        },
    )
    assert updated.status_code == 200
    audit = await client.get("/api/v1/admin/skill-gaps/audit", headers=admin_headers)
    assert audit.status_code == 200
    assert audit.json()[0]["action"] == "SKILL_GAP_ROLE_UPDATED"
    assert "student" not in str(audit.json()[0]).casefold()


@pytest.mark.anyio
async def test_rephrase_disabled_and_provider_failure_keep_deterministic_tips(
    monkeypatch: pytest.MonkeyPatch,
):
    tips = ["Add an education section.", "Quantify a result where accurate."]
    monkeypatch.setattr(
        skill_gap,
        "get_settings",
        lambda: SimpleNamespace(
            skill_gap_llm_enabled=False,
            interview_llm_api_key="",
            interview_llm_model="test-model",
            interview_llm_timeout_seconds=1,
            interview_llm_base_url="https://api.groq.com/openai",
            interview_allowed_provider_hosts=["api.groq.com"],
        ),
    )
    assert await skill_gap._rephrase_tips(tips) == tips

    monkeypatch.setattr(
        skill_gap,
        "get_settings",
        lambda: SimpleNamespace(
            skill_gap_llm_enabled=True,
            interview_llm_api_key="test-key",
            interview_llm_model="test-model",
            interview_llm_timeout_seconds=1,
            interview_llm_base_url="https://api.groq.com/openai",
            interview_allowed_provider_hosts=["api.groq.com"],
        ),
    )
    provider = InterviewLLMProvider(
        Settings(
            llm_providers="groq",
            llm_max_retries=1,
            groq_api_key="test-key",
            groq_base_url="https://api.groq.com/openai",
            groq_model="test-model",
        ),
        transport=httpx.MockTransport(lambda _request: httpx.Response(503)),
    )
    monkeypatch.setattr(skill_gap, "get_interview_provider", lambda: provider)
    assert await skill_gap._rephrase_tips(tips) == tips


@pytest.mark.anyio
async def test_deleting_student_cascades_skill_gap_reports(skill_gap_env):
    async with skill_gap_env["sessions"]() as db:
        report = SkillGapReport(
            student_id=skill_gap_env["ids"]["student"],
            target_type="ROLE",
            target_label="Data Scientist",
            estimated_match_score=50,
            snapshot={"matched_skills": ["Python"]},
        )
        db.add(report)
        await db.commit()
        await db.delete(
            await db.get(User, skill_gap_env["ids"]["student"])
        )
        await db.commit()
        remaining = await db.scalar(
            select(SkillGapReport).where(SkillGapReport.student_id == skill_gap_env["ids"]["student"])
        )
        assert remaining is None
