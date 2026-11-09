import asyncio
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

import pytest
from pydantic import ValidationError
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.v1.dependencies import get_db
from app.core.security import create_token
from app.main import app
from app.models import SkillAttempt, SkillBadge, SkillQuestion, SkillTopic, User, UserRole
from app.models.base import Base
from app.api.v1.skills import SkillQuestionCreate, SkillQuestionUpdate, _badge_level
from app.services.question_import import parse_question_import_file
from app.services.skill_badges import apply_verified_badge_boost
from app.services.question_key_audit import question_key_audit_rows


async def _setup_skill_app(sqlite_path: Path | None = None):
    database_url = f"sqlite+aiosqlite:///{sqlite_path}" if sqlite_path else "sqlite+aiosqlite:///:memory:"
    engine = create_async_engine(database_url)
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


def test_admin_option_number_conversion_preserves_zero_based_storage() -> None:
    single = SkillQuestionCreate(
        topic="python", prompt="Single", options=["A", "B"], correct_option_number=1,
        explanation="Explanation",
    )
    true_false = SkillQuestionCreate(
        topic="python", prompt="True false", options=["True", "False"],
        correct_option_number=2, question_type="TRUE_FALSE", explanation="Explanation",
    )
    multi = SkillQuestionCreate(
        topic="python", prompt="Multi", options=["A", "B", "C"],
        correct_option_numbers=[3, 1], question_type="MULTI", explanation="Explanation",
    )

    assert single.correct_index == 0
    assert single.model_dump()["correct_index"] == 0
    assert true_false.correct_index == 1
    assert multi.correct_answers == [0, 2]
    updated_single = SkillQuestionUpdate(correct_option_number=2)
    updated_multi = SkillQuestionUpdate(correct_option_numbers=[3, 1])
    assert updated_single.model_dump(exclude_unset=True, exclude={"correct_option_number"})["correct_index"] == 1
    assert updated_multi.model_dump(exclude_unset=True, exclude={"correct_option_numbers"})["correct_answers"] == [0, 2]
    with pytest.raises(ValidationError):
        SkillQuestionCreate(
            topic="python", prompt="Ambiguous", options=["A", "B"],
            correct_index=0, correct_option_number=1, explanation="Explanation",
        )
    with pytest.raises(ValidationError):
        SkillQuestionUpdate(correct_answers=[0, 1], correct_option_numbers=[1, 2])


def test_question_key_audit_reports_out_of_range_keys() -> None:
    question = SkillQuestion(
        id=1,
        topic="python",
        subtopic="syntax",
        prompt="Bad key",
        options=["A", "B"],
        correct_index=4,
        explanation="Explanation",
        question_type="SINGLE",
        source="test",
    )

    row = question_key_audit_rows([question])[0]
    assert row["stored_key_number"] == "5"
    assert row["numbered_options"] == "1. A | 2. B"
    assert row["audit_issues"] == "key outside option range"


@pytest.mark.anyio
async def test_question_import_accepts_new_and_legacy_keys_and_rejects_conflicts() -> None:
    engine, sessions, _, admin = await _setup_skill_app()
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            new_key_csv = b'topic,prompt,options,correct_option,explanation,difficulty,question_type\npython,New key,A|B|C,2,Explanation,medium,SINGLE\n'
            new_key = await client.post(
                "/api/v1/skills/admin/questions/import?partial=false",
                headers=_headers(admin),
                files={"file": ("new.csv", new_key_csv, "text/csv")},
            )
            legacy_csv = b'topic,prompt,options,correct_index,explanation,difficulty,question_type\npython,Legacy key,A|B|C,0,Explanation,medium,SINGLE\n'
            legacy = await client.post(
                "/api/v1/skills/admin/questions/import?partial=false",
                headers=_headers(admin),
                files={"file": ("legacy.csv", legacy_csv, "text/csv")},
            )
            conflict_csv = b'topic,prompt,options,correct_index,correct_option,explanation,difficulty,question_type\npython,Conflicting key,A|B|C,0,2,Explanation,medium,SINGLE\n'
            conflict = await client.post(
                "/api/v1/skills/admin/questions/import?partial=true",
                headers=_headers(admin),
                files={"file": ("conflict.csv", conflict_csv, "text/csv")},
            )
        assert new_key.status_code == 200
        assert new_key.json()["imported"] == 1
        assert legacy.status_code == 200
        assert legacy.json()["imported"] == 1
        assert conflict.status_code == 422

        async with sessions() as session:
            imported = list(await session.scalars(
                select(SkillQuestion).where(SkillQuestion.prompt.in_(["New key", "Legacy key"]))
            ))
        assert {question.prompt: question.correct_index for question in imported} == {"New key": 1, "Legacy key": 0}
        assert all(question.key_reviewed_at is not None for question in imported)
    finally:
        app.dependency_overrides.clear()
        await engine.dispose()


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
async def test_active_assessment_resume_and_answer_saving_preserve_private_question_data() -> None:
    engine, sessions, students, _ = await _setup_skill_app()
    student, other_student = students
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            started = await client.post(
                "/api/v1/skills/assessments/start",
                headers=_headers(student),
                json={"topic": "python"},
            )
            assert started.status_code == 200
            start_payload = started.json()
            expected_keys = {
                "attempt_id",
                "topic",
                "started_at",
                "expires_at",
                "remaining_seconds",
                "resumed",
                "answers",
                "questions",
            }
            assert set(start_payload) == expected_keys
            assert start_payload["resumed"] is False
            assert start_payload["answers"] is None
            assert start_payload["remaining_seconds"] > 0
            original_questions = start_payload["questions"]
            async with sessions() as session:
                attempt = await session.get(SkillAttempt, start_payload["attempt_id"])
                snapshots = [dict(snapshot) for snapshot in attempt.question_snapshots]
                snapshots[0]["question_type"] = "MULTI"
                attempt.question_snapshots = snapshots
                await session.commit()
            original_questions[0]["question_type"] = "MULTI"

            active = await client.get(
                "/api/v1/skills/assessments/active",
                headers=_headers(student),
                params={"topic": "python"},
            )
            assert active.status_code == 200
            active_payload = active.json()
            assert set(active_payload) == expected_keys
            assert active_payload["attempt_id"] == start_payload["attempt_id"]
            assert active_payload["resumed"] is True
            assert active_payload["questions"] == original_questions
            assert active_payload["answers"] == [[], *([None] * 9)]
            assert all(
                "correct_index" not in question
                and "correct_answers" not in question
                and "explanation" not in question
                for question in active_payload["questions"]
            )

            saved_selections = [[], None, *([0] * 8)]
            saved = await client.put(
                f"/api/v1/skills/attempts/{start_payload['attempt_id']}/answers",
                headers=_headers(student),
                json={"answers": saved_selections},
            )
            assert saved.status_code == 200
            assert saved.json() == {"saved": True}
            rejected_key_data = await client.put(
                f"/api/v1/skills/attempts/{start_payload['attempt_id']}/answers",
                headers=_headers(student),
                json={"answers": saved_selections, "correct_answers": [0]},
            )
            assert rejected_key_data.status_code == 422

            resumed = await client.get(
                "/api/v1/skills/assessments/active",
                headers=_headers(student),
                params={"topic": "python"},
            )
            assert resumed.json()["questions"] == original_questions
            assert resumed.json()["answers"] == saved_selections
            assert resumed.json()["resumed"] is True

            other_active = await client.get(
                "/api/v1/skills/assessments/active",
                headers=_headers(other_student),
                params={"topic": "python"},
            )
            assert other_active.status_code == 200
            assert other_active.json() is None
    finally:
        app.dependency_overrides.clear()
        await engine.dispose()


@pytest.mark.anyio
async def test_simultaneous_assessment_starts_return_one_active_attempt() -> None:
    database_path = Path(f".skill_assessments_{uuid4().hex}.db")
    engine, sessions, students, _ = await _setup_skill_app(database_path)
    student = students[0]
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            responses = await asyncio.gather(*[
                client.post(
                    "/api/v1/skills/assessments/start",
                    headers=_headers(student),
                    json={"topic": "python"},
                )
                for _ in range(2)
            ])
            assert [response.status_code for response in responses] == [200, 200]
            assert responses[0].json()["attempt_id"] == responses[1].json()["attempt_id"]
            async with sessions() as session:
                attempts = list(await session.scalars(
                    select(SkillAttempt).where(
                        SkillAttempt.student_id == student.id,
                        SkillAttempt.topic == "python",
                        SkillAttempt.status == "IN_PROGRESS",
                    )
                ))
                assert len(attempts) == 1
    finally:
        app.dependency_overrides.clear()
        await engine.dispose()
        database_path.unlink(missing_ok=True)


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

            resumed = await client.post(
                "/api/v1/skills/assessments/start",
                headers=_headers(student),
                json={"topic": "python"},
            )
            assert resumed.status_code == 200
            assert resumed.json()["attempt_id"] == attempt_id
            assert resumed.json()["resumed"] is True
            async with sessions() as session:
                attempt = await session.get(SkillAttempt, attempt_id)
                attempt.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
                await session.commit()

            cooldown = await client.post(
                "/api/v1/skills/assessments/start",
                headers=_headers(student),
                json={"topic": "python"},
            )
            assert cooldown.status_code == 429
            assert "24 hours" in cooldown.json()["detail"]
            assert cooldown.json()["code"] == "COOLDOWN"
            assert cooldown.json()["next_available_at"]
            async with sessions() as session:
                attempt = await session.get(SkillAttempt, attempt_id)
                assert attempt.status == "EXPIRED"

            async with sessions() as session:
                attempt = await session.get(SkillAttempt, attempt_id)
                for topic in ("react", "sql"):
                    session.add(SkillAttempt(
                        student_id=student.id,
                        topic=topic,
                        status="EXPIRED",
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
            assert weekly_limit.json()["code"] == "WEEKLY_LIMIT"
            assert weekly_limit.json()["next_available_at"]
    finally:
        app.dependency_overrides.clear()
        await engine.dispose()


@pytest.mark.anyio
async def test_assessment_questions_are_admin_only_and_duplicate_questions_are_rejected() -> None:
    engine, sessions, students, admin = await _setup_skill_app()
    try:
        async with sessions() as session:
            session.add(SkillTopic(
                slug="react",
                name="React",
                description="Frontend topic",
                icon="⚛️",
                badge_title="Verified React Pro",
                active=True,
            ))
            await session.commit()
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
                        status="COMPLETED",
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


def test_question_import_parser_accepts_alias_headers_and_validates_bad_rows() -> None:
    csv_payload = b"""topic,question,choices,answer,explanation,difficulty,question_type\npython,What is the capital of France?,\"Paris|Berlin|Rome\",0,France is a country in Europe,medium,SINGLE\npython,This row is invalid,\"One|Two\",9,Missing valid answer,medium,SINGLE\n"""
    parsed = parse_question_import_file("questions.csv", csv_payload)

    assert len(parsed["rows"]) == 2
    assert parsed["rows"][0]["data"]["topic"] == "python"
    assert parsed["rows"][0]["data"]["prompt"] == "What is the capital of France?"
    assert parsed["rows"][0]["data"]["options"] == ["Paris", "Berlin", "Rome"]
    assert parsed["rows"][1]["errors"]
    assert any(error["field"] == "correct_index" for error in parsed["rows"][1]["errors"])

    json_payload = b'{"questions":[{"topic":"react","question":"Which hook tracks state?","options":["useMemo","useState","useEffect"],"answer":"B","explanation":"useState manages component state.","difficulty":"easy","question_type":"SINGLE"}]}'
    parsed_json = parse_question_import_file("questions.json", json_payload)

    assert len(parsed_json["rows"]) == 1
    assert parsed_json["rows"][0]["data"]["correct_index"] == 1
