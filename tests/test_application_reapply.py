from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.v1.dependencies import get_db
from app.core.security import create_token
from app.main import app
from app.models import (
    Application,
    ApplicationEvent,
    ApplicationStatusEvent,
    CompanyProfile,
    Internship,
    Notification,
    Resume,
    StudentProfile,
    User,
    UserRole,
)
from app.models.base import Base
from app.services import application_events


async def _application_client(tmp_path: Path, statuses: list[str] | None = None):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'application-reapply.db'}")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    async def override_db():
        async with sessions() as db:
            yield db

    app.dependency_overrides[get_db] = override_db
    async with sessions() as db:
        student = User(
            email="reapply-student@example.com",
            password_hash="test-hash",
            role=UserRole.STUDENT,
            is_active=True,
            is_verified=True,
        )
        company = User(
            email="reapply-company@example.com",
            password_hash="test-hash",
            role=UserRole.COMPANY,
            is_active=True,
            is_verified=True,
        )
        db.add_all([student, company])
        await db.flush()
        db.add(StudentProfile(
            user_id=student.id,
            full_name="Test Student",
            university="Example University",
            major="Computer Science",
            graduation_year=2027,
            skills="Python,TypeScript",
        ))
        db.add(CompanyProfile(
            user_id=company.id,
            company_name="Test Company",
            industry="Technology",
            verification_status="VERIFIED",
        ))
        internship = Internship(
            company_id=company.id,
            title="Test Internship",
            description="An internship for testing.",
            location="Remote",
            industry="Technology",
            duration_months=3,
            stipend=1000,
            work_mode="REMOTE",
            skills="Python",
            deadline=date.today() + timedelta(days=30),
            status="PUBLISHED",
        )
        db.add(internship)
        await db.flush()
        for index, status in enumerate(statuses or []):
            status_internship_id = internship.id
            if index:
                other_internship = Internship(
                    company_id=company.id,
                    title=f"Test Internship {index + 1}",
                    description="An internship for testing.",
                    location="Remote",
                    industry="Technology",
                    duration_months=3,
                    stipend=1000,
                    work_mode="REMOTE",
                    skills="Python",
                    deadline=date.today() + timedelta(days=30),
                    status="PUBLISHED",
                )
                db.add(other_internship)
                await db.flush()
                status_internship_id = other_internship.id
            db.add(Application(
                internship_id=status_internship_id,
                student_id=student.id,
                status=status,
                created_at=datetime(2020, 1, 1, tzinfo=timezone.utc),
                updated_at=datetime(2020, 1, 1, tzinfo=timezone.utc),
            ))
        await db.commit()
        student_id = student.id
        company_id = company.id
        internship_id = internship.id

    token = create_token(str(student_id), UserRole.STUDENT.value, "access", timedelta(minutes=30))
    client = AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://application-reapply-test",
        headers={"Authorization": f"Bearer {token}"},
    )
    return engine, sessions, client, student_id, company_id, internship_id


@pytest.mark.anyio
async def test_reapply_reuses_withdrawn_application_and_records_event_and_company_notice(tmp_path: Path) -> None:
    engine, sessions, client, student_id, company_id, internship_id = await _application_client(
        tmp_path,
        ["WITHDRAWN"],
    )
    try:
        async with sessions() as db:
            existing = await db.scalar(select(Application))
            existing_id = existing.id

        async with client:
            response = await client.post(
                f"/api/v1/applications/internships/{internship_id}",
                json={"cover_note": "Updated cover note"},
            )

        assert response.status_code == 201
        assert response.json()["id"] == existing_id
        assert response.json()["status"] == "APPLIED"
        async with sessions() as db:
            application_rows = list(await db.scalars(select(Application)))
            status_event = await db.scalar(
                select(ApplicationStatusEvent).where(
                    ApplicationStatusEvent.application_id == existing_id,
                    ApplicationStatusEvent.from_status == "WITHDRAWN",
                    ApplicationStatusEvent.to_status == "APPLIED",
                )
            )
            applied_event = await db.scalar(
                select(ApplicationEvent).where(
                    ApplicationEvent.application_id == existing_id,
                    ApplicationEvent.event_type == "APPLIED",
                )
            )
            company_notice = await db.scalar(
                select(Notification).where(
                    Notification.user_id == company_id,
                    Notification.title == "Test Student re-applied to Test Internship",
                )
            )
            application = application_rows[0]
            assert len(application_rows) == 1
            assert application.status == "APPLIED"
            assert application.cover_note == "Updated cover note"
            assert application.created_at.year == datetime.now(timezone.utc).year
            assert status_event is not None
            assert applied_event is not None
            assert company_notice is not None
            assert company_notice.application_id == existing_id
            assert student_id != company_id
    finally:
        app.dependency_overrides.clear()
        await client.aclose()
        await engine.dispose()


@pytest.mark.anyio
async def test_duplicate_apply_returns_conflict_with_application_id_and_status(tmp_path: Path) -> None:
    engine, sessions, client, _, _, internship_id = await _application_client(tmp_path, ["UNDER_REVIEW"])
    try:
        async with sessions() as db:
            existing_id = (await db.scalar(select(Application))).id
        async with client:
            response = await client.post(
                f"/api/v1/applications/internships/{internship_id}",
                json={"cover_note": None},
            )
        assert response.status_code == 409
        assert response.json() == {
            "detail": "You already applied to this internship (status: Under Review).",
            "code": "ALREADY_APPLIED",
            "blockers": [{
                "code": "ALREADY_APPLIED",
                "message": "You already applied to this internship (status: Under Review).",
                "action_url": f"/applications?id={existing_id}",
                "application_id": existing_id,
                "status": "UNDER_REVIEW",
            }],
        }
    finally:
        app.dependency_overrides.clear()
        await client.aclose()
        await engine.dispose()


@pytest.mark.anyio
async def test_unrelated_integrity_error_rolls_back_application_and_returns_generic_error(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    engine, sessions, client, _, _, internship_id = await _application_client(tmp_path)

    async def fail_event_insert(*args, **kwargs):
        raise IntegrityError("insert application event", {}, Exception("unrelated unique constraint"))

    monkeypatch.setattr(application_events, "record_event", fail_event_insert)
    try:
        async with client:
            response = await client.post(
                f"/api/v1/applications/internships/{internship_id}",
                json={"cover_note": "Should be rolled back"},
            )
        assert response.status_code == 500
        assert response.json()["detail"] == "Could not submit your application. Please try again."
        async with sessions() as db:
            assert await db.scalar(select(Application.id)) is None
            assert await db.scalar(select(Notification.id)) is None
            assert await db.scalar(select(ApplicationStatusEvent.id)) is None
    finally:
        app.dependency_overrides.clear()
        await client.aclose()
        await engine.dispose()


@pytest.mark.anyio
async def test_student_application_status_filter_is_case_insensitive_and_default_includes_withdrawn(
    tmp_path: Path,
) -> None:
    engine, _, client, _, _, _ = await _application_client(tmp_path, ["APPLIED", "WITHDRAWN"])
    try:
        async with client:
            lowercase = await client.get("/api/v1/applications/student?status=applied")
            uppercase = await client.get("/api/v1/applications/student?status=APPLIED")
            unfiltered = await client.get("/api/v1/applications/student")

        assert lowercase.status_code == uppercase.status_code == unfiltered.status_code == 200
        assert [item["status"] for item in lowercase.json()["applications"]] == ["APPLIED"]
        assert [item["status"] for item in uppercase.json()["applications"]] == ["APPLIED"]
        assert {item["status"] for item in unfiltered.json()["applications"]} == {"APPLIED", "WITHDRAWN"}
    finally:
        app.dependency_overrides.clear()
        await client.aclose()
        await engine.dispose()


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("blocker_code", "existing_status"),
    [
        ("EMAIL_NOT_VERIFIED", None),
        ("PROFILE_INCOMPLETE", None),
        ("INTERNSHIP_NOT_OPEN", None),
        ("DEADLINE_PASSED", None),
        ("ALREADY_APPLIED", "APPLIED"),
    ],
)
async def test_eligibility_blockers_are_shared_with_apply_errors(
    tmp_path: Path,
    blocker_code: str,
    existing_status: str | None,
) -> None:
    engine, sessions, client, student_id, company_id, internship_id = await _application_client(
        tmp_path,
        [existing_status] if existing_status else None,
    )
    try:
        async with sessions() as db:
            if blocker_code == "EMAIL_NOT_VERIFIED":
                student = await db.get(User, student_id)
                student.is_verified = False
            elif blocker_code == "PROFILE_INCOMPLETE":
                profile = await db.scalar(select(StudentProfile).where(StudentProfile.user_id == student_id))
                profile.skills = ""
            elif blocker_code == "INTERNSHIP_NOT_OPEN":
                company = await db.scalar(select(CompanyProfile).where(CompanyProfile.user_id == company_id))
                company.verification_status = "PENDING"
            elif blocker_code == "DEADLINE_PASSED":
                internship = await db.get(Internship, internship_id)
                internship.deadline = date.today() - timedelta(days=1)
            await db.commit()

        async with client:
            eligibility = await client.get(f"/api/v1/applications/eligibility/{internship_id}")
            applied = await client.post(
                f"/api/v1/applications/internships/{internship_id}",
                json={"cover_note": None},
            )

        assert eligibility.status_code == 200
        blocker = next(item for item in eligibility.json()["blockers"] if item["code"] == blocker_code)
        assert eligibility.json()["can_apply"] is False
        assert blocker["message"]
        assert applied.status_code == (409 if blocker_code == "ALREADY_APPLIED" else 422)
        assert applied.json()["code"] == blocker_code
        assert applied.json()["detail"] == blocker["message"]
        assert blocker in applied.json()["blockers"]
    finally:
        app.dependency_overrides.clear()
        await client.aclose()
        await engine.dispose()


@pytest.mark.anyio
async def test_eligibility_match_score_matches_internship_browse_card(tmp_path: Path) -> None:
    engine, sessions, client, student_id, _, internship_id = await _application_client(tmp_path)
    try:
        uploaded_at = datetime(2026, 10, 1, 12, tzinfo=timezone.utc)
        async with sessions() as db:
            db.add(Resume(
                student_id=student_id,
                original_filename="candidate.pdf",
                stored_filename="missing-candidate.pdf",
                content_type="application/pdf",
                file_size=128,
                uploaded_at=uploaded_at,
            ))
            await db.commit()
        async with client:
            eligibility = await client.get(f"/api/v1/applications/eligibility/{internship_id}")
            browse = await client.get("/api/v1/internships")
        browse_item = next(item for item in browse.json()["items"] if item["id"] == internship_id)
        assert eligibility.status_code == 200
        assert eligibility.json()["match_score"] == browse_item["match_score"]
        assert eligibility.json()["matched_skills"] == browse_item["matched_skills"]
        assert eligibility.json()["resume"] == {
            "filename": "candidate.pdf",
            "uploaded_at": uploaded_at.isoformat(),
        }
    finally:
        app.dependency_overrides.clear()
        await client.aclose()
        await engine.dispose()


@pytest.mark.anyio
async def test_duplicate_posting_title_and_location_are_rejected(tmp_path: Path) -> None:
    engine, sessions, _, _, company_id, internship_id = await _application_client(tmp_path)
    token = create_token(str(company_id), UserRole.COMPANY.value, "access", timedelta(minutes=30))
    company_client = AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://duplicate-posting-test",
        headers={"Authorization": f"Bearer {token}"},
    )
    try:
        create_response = await company_client.post(
            "/api/v1/internships",
            json={
                "title": "  test INTERNSHIP ",
                "description": "A competing internship posting.",
                "location": " remote ",
                "industry": "Technology",
                "duration_months": 3,
                "stipend": 1000,
                "work_mode": "REMOTE",
                "skills": ["Python"],
                "deadline": (date.today() + timedelta(days=30)).isoformat(),
            },
        )
        assert create_response.status_code == 409
        assert create_response.json()["detail"] == "You already have an active internship with this title and location"
        async with sessions() as db:
            source = await db.get(Internship, internship_id)
            source.status = "DRAFT"
            duplicate = Internship(
                company_id=company_id,
                title=source.title,
                description=source.description,
                location=source.location,
                industry=source.industry,
                duration_months=source.duration_months,
                stipend=source.stipend,
                work_mode=source.work_mode,
                skills=source.skills,
                deadline=source.deadline,
                status="PUBLISHED",
            )
            db.add(duplicate)
            await db.commit()
            draft_id = source.id
        submit_response = await company_client.post(f"/api/v1/internships/{draft_id}/submit")
        assert submit_response.status_code == 409
        assert submit_response.json()["detail"] == "You already have an active internship with this title and location"
    finally:
        app.dependency_overrides.clear()
        await company_client.aclose()
        await engine.dispose()


@pytest.mark.anyio
async def test_student_funnels_do_not_count_applied_only_as_screened(tmp_path: Path) -> None:
    engine, sessions, client, student_id, _, internship_id = await _application_client(tmp_path)
    try:
        async with sessions() as db:
            application = Application(
                internship_id=internship_id,
                student_id=student_id,
                status="APPLIED",
            )
            db.add(application)
            await db.flush()
            db.add(ApplicationEvent(
                application_id=application.id,
                event_type="APPLIED",
                actor_id=student_id,
            ))
            await db.commit()
        async with client:
            overview = await client.get("/api/v1/analytics/overview")
            insights = await client.get("/api/v1/analytics/student/insights?range=all")
        assert overview.status_code == insights.status_code == 200
        assert overview.json()["funnel"]["applied"] == 1
        assert overview.json()["funnel"]["screened"] == 0
        student_funnel = {item["stage"]: item["count"] for item in insights.json()["funnel"]}
        assert student_funnel["Applications"] == 1
        assert student_funnel["Screened"] == 0
    finally:
        app.dependency_overrides.clear()
        await client.aclose()
        await engine.dispose()
