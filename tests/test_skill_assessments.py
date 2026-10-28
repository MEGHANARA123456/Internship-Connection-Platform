from datetime import datetime, timedelta, timezone

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.v1.dependencies import get_db
from app.core.security import create_token
from app.main import app
from app.models import SkillAttempt, SkillBadge, SkillQuestion, User, UserRole
from app.models.base import Base
from app.api.v1.skills import _badge_level
from app.services.skill_badges import apply_verified_badge_boost


async def _setup_skill_app():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    async def override_db():
        async with sessions() as session:
            yield session

    app.dependency_overrides[get_db] = override_db
    async with sessions() as session:
        students = [
            User(email=f"skill-student-{index}@example.com", password_hash="test", role=UserRole.STUDENT, is_active=True, is_verified=True)
            for index in (1, 2)
        ]
        admin = User(email="skill-admin@example.com", password_hash="test", role=UserRole.ADMIN, is_active=True, is_verified=True)
        session.add_all([*students, admin])
        session.add_all([
            SkillQuestion(
                topic="python",
                prompt=f"Python question {index}",
                options=["correct", "wrong", "other"],
                correct_index=0,
                explanation=f"Explanation {index}",
                difficulty=difficulty,
                subtopic=f"subtopic-{index % 3}",
                active=True,
            )
            for index, difficulty in enumerate(
                ["EASY"] * 4 + ["MEDIUM"] * 4 + ["HARD"] * 2
            )
        ])
        await session.commit()
        for user in [*students, admin]:
            await session.refresh(user)
    return engine, sessions, students, admin


def _headers(user: User) -> dict[str, str]:
    token = create_token(str(user.id), user.role.value, "access", timedelta(minutes=30))
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.anyio
async def test_assessment_withholds_answers_grades_on_server_and_rejects_double_submit() -> None:
    engine, sessions, students, _ = await _setup_skill_app()
    student = students[0]
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            started = await client.post(
                "/api/v1/skills/assessments/start",
                headers=_headers(student),
                json={"topic": "python"},
            )
            assert started.status_code == 200
            payload = started.json()
            assert len(payload["questions"]) == 10
            assert all("correct_index" not in question and "explanation" not in question for question in payload["questions"])

            async with sessions() as session:
                attempt = await session.get(SkillAttempt, payload["attempt_id"])
                answers = [order.index(snapshot["correct_index"]) for order, snapshot in zip(attempt.option_orders, attempt.question_snapshots)]

            submitted = await client.post(
                f"/api/v1/skills/assessments/{payload['attempt_id']}/submit",
                headers=_headers(student),
                json={"answers": answers},
            )
            assert submitted.status_code == 200
            result = submitted.json()
            assert result["score"] == 100
            assert result["passed"] is True
            assert result["badge"]["level"] == "Advanced"
            assert all(question["explanation"].startswith("Explanation") for question in result["questions"])
            expires_at = datetime.fromisoformat(result["badge"]["expires_at"].replace("Z", "+00:00"))
            assert expires_at > datetime.now(timezone.utc) + timedelta(days=360)

            duplicate = await client.post(
                f"/api/v1/skills/assessments/{payload['attempt_id']}/submit",
                headers=_headers(student),
                json={"answers": answers},
            )
            assert duplicate.status_code == 409

        async with sessions() as session:
            badges = list(await session.scalars(select(SkillBadge).where(SkillBadge.student_id == student.id)))
            assert len(badges) == 1
    finally:
        app.dependency_overrides.clear()
        await engine.dispose()


@pytest.mark.anyio
async def test_assessments_enforce_expiry_ownership_cooldown_and_weekly_limit() -> None:
    engine, sessions, students, _ = await _setup_skill_app()
    student, other_student = students
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            started = await client.post(
                "/api/v1/skills/assessments/start",
                headers=_headers(student),
                json={"topic": "python"},
            )
            attempt_id = started.json()["attempt_id"]
            wrong_owner = await client.post(
                f"/api/v1/skills/assessments/{attempt_id}/submit",
                headers=_headers(other_student),
                json={"answers": [0] * 10},
            )
            assert wrong_owner.status_code == 404
            assert (await client.get("/api/v1/skills/attempts", headers=_headers(other_student))).json() == []

            cooldown = await client.post(
                "/api/v1/skills/assessments/start",
                headers=_headers(student),
                json={"topic": "python"},
            )
            assert cooldown.status_code == 429
            assert "24 hours" in cooldown.json()["detail"]

            async with sessions() as session:
                attempt = await session.get(SkillAttempt, attempt_id)
                attempt.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
                for topic in ("react", "sql"):
                    session.add(SkillAttempt(
                        student_id=student.id,
                        topic=topic,
                        question_ids=[],
                        question_snapshots=[],
                        option_orders=[],
                        started_at=datetime.now(timezone.utc) - timedelta(hours=2),
                        expires_at=datetime.now(timezone.utc) - timedelta(hours=1),
                    ))
                await session.commit()

            late = await client.post(
                f"/api/v1/skills/assessments/{attempt_id}/submit",
                headers=_headers(student),
                json={"answers": [0] * 10},
            )
            assert late.status_code == 410
            weekly_limit = await client.post(
                "/api/v1/skills/assessments/start",
                headers=_headers(student),
                json={"topic": "python"},
            )
            assert weekly_limit.status_code == 429
            assert "limit of 3" in weekly_limit.json()["detail"]
    finally:
        app.dependency_overrides.clear()
        await engine.dispose()


@pytest.mark.anyio
async def test_assessment_questions_are_admin_only_and_duplicate_questions_are_rejected() -> None:
    engine, _, students, admin = await _setup_skill_app()
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            forbidden = await client.get("/api/v1/skills/admin/questions", headers=_headers(students[0]))
            assert forbidden.status_code == 403

            question = {
                "topic": "react",
                "prompt": "What does React render?",
                "options": ["UI", "database"],
                "correct_index": 0,
                "explanation": "React renders user interfaces.",
                "difficulty": "beginner",
            }
            created = await client.post("/api/v1/skills/admin/questions", headers=_headers(admin), json=question)
            assert created.status_code == 201
            duplicate = await client.post("/api/v1/skills/admin/questions", headers=_headers(admin), json=question)
            assert duplicate.status_code == 409
            deactivated = await client.patch(
                f"/api/v1/skills/admin/questions/{created.json()['id']}",
                headers=_headers(admin),
                json={"active": False},
            )
            assert deactivated.status_code == 200
            assert deactivated.json()["active"] is False
    finally:
        app.dependency_overrides.clear()
        await engine.dispose()


@pytest.mark.anyio
async def test_assessment_weighted_partial_score_history_and_pdf_report() -> None:
    engine, sessions, students, _ = await _setup_skill_app()
    student = students[0]
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            started = await client.post(
                "/api/v1/skills/assessments/start",
                headers=_headers(student),
                json={"topic": "python"},
            )
            assert started.status_code == 200
            attempt_id = started.json()["attempt_id"]
            assert len(started.json()["questions"]) == 10
            assert {
                difficulty: sum(question["difficulty"] == difficulty for question in started.json()["questions"])
                for difficulty in ("EASY", "MEDIUM", "HARD")
            } == {"EASY": 4, "MEDIUM": 4, "HARD": 2}

            async with sessions() as session:
                attempt = await session.get(SkillAttempt, attempt_id)
                snapshots = [dict(snapshot) for snapshot in attempt.question_snapshots]
                snapshots[0]["question_type"] = "MULTI"
                snapshots[0]["correct_answers"] = [0, 1]
                snapshots[0]["correct_index"] = 0
                attempt.question_snapshots = snapshots
                first_weight = {"EASY": 1, "MEDIUM": 2, "HARD": 3}[snapshots[0]["difficulty"]]
                await session.commit()
                answers = [
                    [order.index(0)] if index == 0
                    else [order.index(correct) for correct in snapshot.get("correct_answers", [snapshot["correct_index"]])]
                    for index, (snapshot, order) in enumerate(zip(attempt.question_snapshots, attempt.option_orders))
                ]

            submitted = await client.post(
                f"/api/v1/skills/assessments/{attempt_id}/submit",
                headers=_headers(student),
                json={"answers": answers},
            )
            assert submitted.status_code == 200
            result = submitted.json()
            assert result["raw_score"] == 9.5
            assert result["weighted_percentage"] == round((18 - first_weight * 0.5) * 100 / 18, 2)
            assert result["questions"][0]["earned_credit"] == 0.5
            assert result["passed"] is True
            assert result["percentile"] == "Not enough data yet"

            report = await client.get(
                f"/api/v1/skills/assessments/{attempt_id}/report.pdf",
                headers=_headers(student),
            )
            assert report.status_code == 200
            assert report.headers["content-type"].startswith("application/pdf")
            assert report.content.startswith(b"%PDF-1.4")

            history = await client.get("/api/v1/skills/history", headers=_headers(student))
            assert history.status_code == 200
            assert history.json()["attempts"][0]["attempt_id"] == attempt_id
            assert history.json()["attempts"][0]["change_from_previous"] is None
    finally:
        app.dependency_overrides.clear()
        await engine.dispose()


@pytest.mark.anyio
async def test_percentile_is_returned_only_after_thirty_topic_attempts() -> None:
    engine, sessions, students, _ = await _setup_skill_app()
    student, other_student = students
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            started = await client.post(
                "/api/v1/skills/assessments/start",
                headers=_headers(student),
                json={"topic": "python"},
            )
            attempt_id = started.json()["attempt_id"]
            now = datetime.now(timezone.utc)
            async with sessions() as session:
                for index in range(29):
                    session.add(SkillAttempt(
                        student_id=other_student.id,
                        topic="python",
                        question_ids=[],
                        question_snapshots=[],
                        option_orders=[],
                        answers=[],
                        score=50,
                        weighted_percentage=50.0,
                        passed=False,
                        started_at=now - timedelta(days=index + 1),
                        expires_at=now - timedelta(days=index + 1) + timedelta(minutes=15),
                        submitted_at=now - timedelta(days=index + 1),
                    ))
                await session.commit()
                attempt = await session.get(SkillAttempt, attempt_id)
                answers = [
                    [order.index(correct) for correct in snapshot.get("correct_answers", [snapshot["correct_index"]])]
                    for snapshot, order in zip(attempt.question_snapshots, attempt.option_orders)
                ]

            submitted = await client.post(
                f"/api/v1/skills/assessments/{attempt_id}/submit",
                headers=_headers(student),
                json={"answers": answers},
            )
            assert submitted.status_code == 200
            assert isinstance(submitted.json()["percentile"], float)
            assert submitted.json()["percentile"] == 100.0
    finally:
        app.dependency_overrides.clear()
        await engine.dispose()


def test_verified_skill_bonus_is_limited_to_fifteen_points() -> None:
    now = datetime.now(timezone.utc)
    badges = [
        SkillBadge(
            student_id=1,
            topic=topic,
            title=f"Verified {topic}",
            level="Gold",
            score=100,
            attempt_id=index,
            earned_at=now,
            expires_at=now + timedelta(days=365),
        )
        for index, topic in enumerate(("python", "react", "sql", "typescript"), start=1)
    ]

    result = apply_verified_badge_boost(
        {"score": 70, "matched_skills": ["Python", "React", "SQL", "TypeScript"]},
        ["Python", "React", "SQL", "TypeScript"],
        badges,
    )

    assert result["base_match_score"] == 70
    assert result["score"] == 85
    assert result["verified_skill_bonus"] == 15
    assert "capped at +15" in result["match_explanation"]


def test_assessment_level_boundaries() -> None:
    assert _badge_level(59.99) == "Beginner"
    assert _badge_level(60) == "Intermediate"
    assert _badge_level(79.99) == "Intermediate"
    assert _badge_level(80) == "Advanced"
