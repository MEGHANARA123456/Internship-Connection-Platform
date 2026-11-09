from __future__ import annotations

import csv
import io
from datetime import datetime, timedelta, timezone

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.v1.dependencies import get_current_user, get_db
from app.api.v1.skills import _question_results
from app.main import app
from app.models import (
    AuditLog,
    SkillAttempt,
    SkillBadge,
    SkillLearningResource,
    SkillQuestion,
    SkillTopic,
    User,
    UserRole,
)
from app.models.base import Base


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest.fixture
async def skill_admin_db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    async def override_db():
        async with sessions() as session:
            yield session

    app.dependency_overrides[get_db] = override_db
    try:
        yield sessions
    finally:
        app.dependency_overrides.clear()
        await engine.dispose()


def _user(user_id: int, role: UserRole) -> User:
    return User(
        id=user_id,
        email=f"{role.value.lower()}@example.test",
        password_hash="not-returned",
        role=role,
        is_active=True,
        is_verified=True,
    )


@pytest.mark.anyio
async def test_admin_can_update_topic_and_read_attempt_analytics(skill_admin_db) -> None:
    admin = _user(1, UserRole.ADMIN)
    student = _user(2, UserRole.STUDENT)
    now = datetime.now(timezone.utc)
    async with skill_admin_db() as db:
        db.add_all(
            [
                admin,
                student,
                SkillTopic(
                    slug="python",
                    name="Python",
                    description="Existing description",
                    icon="🐍",
                    badge_title="Python expert",
                    active=True,
                ),
                SkillAttempt(
                    student_id=2,
                    topic="python",
                    status="SUBMITTED",
                    question_ids=[],
                    question_snapshots=[],
                    option_orders=[],
                    score=85,
                    weighted_percentage=85.0,
                    passed=True,
                    started_at=now - timedelta(hours=1),
                    submitted_at=now,
                    expires_at=now + timedelta(minutes=15),
                    subtopic_scores={"syntax": {"percentage": 90}},
                ),
            ]
        )
        await db.commit()
    app.dependency_overrides[get_current_user] = lambda: admin

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        update = await client.patch(
            "/api/v1/skills/admin/topics/python",
            json={"name": "Python Systems"},
        )
        audit_logs = await client.get(
            "/api/v1/admin/audit-logs",
            params={"action": "skill_topic_updated"},
        )
        listing = await client.get("/api/v1/skills/admin/topics")
        attempts = await client.get("/api/v1/skills/admin/topics/python/attempts")
        attempt = await client.get("/api/v1/skills/admin/attempts/1")

    assert update.status_code == 200
    assert update.json()["name"] == "Python Systems"
    assert audit_logs.status_code == 200
    assert audit_logs.json()["items"][0]["target_id"] == "python"
    assert audit_logs.json()["items"][0]["target_label"] == "Skill topic: Python Systems"
    assert "active" not in update.json()
    assert listing.status_code == 200
    assert "active" not in next(item for item in listing.json() if item["topic"] == "python")
    assert attempts.status_code == 200
    assert attempts.json()["total"] == 1
    assert attempts.json()["items"][0]["student_email"] == student.email
    assert attempt.status_code == 200
    assert attempt.json()["subtopic_scores"]["syntax"]["percentage"] == 90
    async with skill_admin_db() as db:
        actions = set(await db.scalars(
            select(AuditLog.action)
        ))
    assert actions == {"skill_topic_updated"}


@pytest.mark.anyio
async def test_topic_creation_readiness_and_student_visibility(skill_admin_db) -> None:
    admin = _user(1, UserRole.ADMIN)
    student = _user(2, UserRole.STUDENT)
    async with skill_admin_db() as db:
        db.add_all([
            admin,
            student,
            SkillTopic(slug="legacy", name="Legacy", description="", icon="✦", badge_title="Legacy", active=False),
            SkillQuestion(
                topic="legacy",
                subtopic="syntax",
                prompt="Existing question",
                options=["A", "B"],
                correct_index=0,
                explanation="Explanation",
                difficulty="EASY",
                source="test",
            ),
        ])
        await db.flush()
        existing_question_id = await db.scalar(select(SkillQuestion.id).where(SkillQuestion.prompt == "Existing question"))
        await db.commit()
    app.dependency_overrides[get_current_user] = lambda: admin

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        created = await client.post("/api/v1/skills/admin/skill-topics", json={
            "topic": "web-security",
            "name": "Web Security",
            "description": "Secure web systems.",
            "icon": "shield",
        })
        duplicate = await client.post("/api/v1/skills/admin/skill-topics", json={
            "topic": "web-security",
            "name": "Web Security",
        })
        unready_activation = await client.patch(
            "/api/v1/skills/admin/topics/web-security",
            json={"active": True},
        )
        missing_topic_question = await client.post("/api/v1/skills/admin/questions", json={
            "topic": "unknown-topic",
            "subtopic": "general",
            "prompt": "Question for missing topic",
            "options": ["A", "B"],
            "correct_index": 0,
            "explanation": "Explanation",
        })
        missing_topic_update = await client.patch(
            f"/api/v1/skills/admin/questions/{existing_question_id}",
            json={"topic": "unknown-topic"},
        )
        created_questions = []
        for difficulty, count in (("EASY", 4), ("MEDIUM", 4), ("HARD", 2)):
            for index in range(count):
                created_questions.append(await client.post("/api/v1/skills/admin/questions", json={
                    "topic": "web-security",
                    "subtopic": "System Design",
                    "prompt": f"{difficulty} question {index}",
                    "options": ["A", "B"],
                    "correct_index": 0,
                    "explanation": "Explanation",
                    "difficulty": difficulty,
                }))
        subtopics = await client.get("/api/v1/skills/admin/skill-topics/web-security/subtopics")

    assert created.status_code == 201
    assert duplicate.status_code == 409
    assert unready_activation.status_code == 200
    assert "active" not in unready_activation.json()
    assert missing_topic_question.status_code == 404
    assert missing_topic_update.status_code == 404
    assert all(response.status_code == 201 for response in created_questions)
    assert subtopics.json() == [{"id": "system-design", "question_count": 10}]
    async with skill_admin_db() as db:
        web_security = await db.get(SkillTopic, "web-security")
        assert web_security is not None
        web_security.active = False
        await db.flush()
        ready_topics = await db.scalars(select(SkillQuestion).where(SkillQuestion.topic == "web-security"))
        questions = list(ready_topics)
        assert len(questions) == 10
        topic_ready = await db.get(SkillTopic, "web-security")
        assert topic_ready is not None and not topic_ready.active
        await db.commit()
    app.dependency_overrides[get_current_user] = lambda: student
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        ready_listed = await client.get("/api/v1/skills/topics")
        ready_search = await client.get("/api/v1/search/suggest?q=web&scope=skill_topics")
    assert [item["id"] for item in ready_listed.json()] == ["web-security"]
    assert [item["text"] for item in ready_search.json()["items"]] == ["Web Security"]

    async with skill_admin_db() as db:
        for question in await db.scalars(select(SkillQuestion).where(SkillQuestion.topic == "web-security")):
            question.active = False
        await db.commit()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        listed = await client.get("/api/v1/skills/topics")
        search = await client.get("/api/v1/search/suggest?q=web&scope=skill_topics")

    assert listed.json() == []
    assert search.json()["items"] == []
    app.dependency_overrides[get_current_user] = lambda: admin


@pytest.mark.anyio
async def test_student_assessment_topics_returns_only_ready_active_question_pools(skill_admin_db) -> None:
    student = _user(1, UserRole.STUDENT)
    now = datetime.now(timezone.utc)
    async with skill_admin_db() as db:
        db.add(student)
        db.add_all(
            [
                SkillQuestion(
                    topic="ready-topic",
                    subtopic="general",
                    prompt=f"Ready {difficulty} {index}",
                    options=["A", "B"],
                    correct_index=0,
                    explanation="Explanation",
                    difficulty=difficulty,
                    active=True,
                )
                for difficulty, count in (("EASY", 4), ("MEDIUM", 4), ("HARD", 2))
                for index in range(count)
            ]
            + [
                SkillQuestion(
                    topic="ready-topic",
                    subtopic="general",
                    prompt=f"Inactive {difficulty}",
                    options=["A", "B"],
                    correct_index=0,
                    explanation="Explanation",
                    difficulty=difficulty,
                    active=False,
                )
                for difficulty in ("EASY", "MEDIUM", "HARD")
            ]
            + [
                SkillQuestion(
                    topic="incomplete-topic",
                    subtopic="general",
                    prompt=f"Incomplete {difficulty} {index}",
                    options=["A", "B"],
                    correct_index=0,
                    explanation="Explanation",
                    difficulty=difficulty,
                    active=True,
                )
                for difficulty, count in (("EASY", 4), ("MEDIUM", 4), ("HARD", 1))
                for index in range(count)
            ]
            + [
                SkillAttempt(
                    student_id=student.id,
                    topic="ready-topic",
                    status="COMPLETED",
                    question_ids=[],
                    question_snapshots=[],
                    option_orders=[],
                    score=75,
                    passed=False,
                    started_at=now - timedelta(days=2),
                    expires_at=now - timedelta(days=2) + timedelta(minutes=15),
                    submitted_at=now - timedelta(days=2) + timedelta(minutes=10),
                ),
                SkillAttempt(
                    student_id=student.id,
                    topic="ready-topic",
                    status="COMPLETED",
                    question_ids=[],
                    question_snapshots=[],
                    option_orders=[],
                    score=60,
                    passed=False,
                    started_at=now - timedelta(days=1),
                    expires_at=now - timedelta(days=1) + timedelta(minutes=15),
                    submitted_at=now - timedelta(days=1) + timedelta(minutes=10),
                ),
            ]
        )
        await db.commit()
    app.dependency_overrides[get_current_user] = lambda: student

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/api/v1/skills/topics")

    assert response.status_code == 200
    assert [topic["id"] for topic in response.json()] == ["ready-topic"]
    assert response.json()[0]["question_counts"] == {"easy": 4, "medium": 4, "hard": 2}
    assert response.json()[0]["attempt_status"] == "COMPLETED"
    assert response.json()[0]["best_score"] == 75


@pytest.mark.anyio
async def test_student_assessment_topics_skips_and_logs_a_bad_topic(
    skill_admin_db,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    import app.api.v1.skills as skills

    student = _user(1, UserRole.STUDENT)
    async with skill_admin_db() as db:
        db.add(student)
        db.add_all(
            SkillQuestion(
                topic=topic,
                subtopic="general",
                prompt=f"{topic} {difficulty} {index}",
                options=["A", "B"],
                correct_index=0,
                explanation="Explanation",
                difficulty=difficulty,
                active=True,
            )
            for topic in ("ready-topic", "broken-topic")
            for difficulty, count in (("EASY", 4), ("MEDIUM", 4), ("HARD", 2))
            for index in range(count)
        )
        await db.commit()

    class BrokenTopicDefaults(dict):
        def get(self, key, default=None):
            if key == "broken-topic":
                raise ValueError("invalid topic metadata")
            return super().get(key, default)

    monkeypatch.setattr(skills, "TOPIC_INFO", BrokenTopicDefaults(skills.TOPIC_INFO))
    app.dependency_overrides[get_current_user] = lambda: student

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/api/v1/skills/topics")

    assert response.status_code == 200
    assert [topic["id"] for topic in response.json()] == ["ready-topic"]
    assert "Skipping invalid skill assessment topic 'broken-topic'." in caplog.text


@pytest.mark.anyio
async def test_topic_archive_preserves_history_and_delete_requires_no_history(skill_admin_db) -> None:
    admin = _user(1, UserRole.ADMIN)
    student = _user(2, UserRole.STUDENT)
    now = datetime.now(timezone.utc)
    async with skill_admin_db() as db:
        db.add_all([
            admin,
            student,
            SkillTopic(slug="legacy", name="Legacy Topic", description="", icon="✦", badge_title="Legacy", active=True),
            SkillTopic(slug="empty", name="Empty Topic", description="", icon="✦", badge_title="Empty", active=False),
        ])
        await db.flush()
        completed = SkillAttempt(
            student_id=student.id,
            topic="legacy",
            status="COMPLETED",
            question_ids=list(range(10)),
            question_snapshots=[{
                "prompt": f"Question {index}",
                "options": ["A", "B"],
                "correct_index": 0,
                "correct_answers": [0],
                "explanation": "A is correct.",
                "difficulty": "MEDIUM",
                "subtopic": "general",
                "question_type": "SINGLE",
            } for index in range(10)],
            option_orders=[[0, 1] for _ in range(10)],
            score=90,
            weighted_percentage=90,
            passed=True,
            started_at=now - timedelta(days=1),
            submitted_at=now - timedelta(days=1),
            expires_at=now + timedelta(minutes=15),
        )
        in_progress = SkillAttempt(
            student_id=student.id,
            topic="legacy",
            status="IN_PROGRESS",
            question_ids=list(range(10)),
            question_snapshots=[{
                "prompt": f"Question {index}",
                "options": ["A", "B"],
                "correct_index": 0,
                "correct_answers": [0],
                "explanation": "A is correct.",
                "difficulty": "MEDIUM",
                "subtopic": "general",
                "question_type": "SINGLE",
            } for index in range(10)],
            option_orders=[[0, 1] for _ in range(10)],
            started_at=now,
            expires_at=now + timedelta(minutes=10),
        )
        db.add_all([completed, in_progress])
        await db.flush()
        db.add(SkillBadge(
            student_id=student.id,
            topic="legacy",
            title="Legacy badge",
            level="EXPERT",
            score=90,
            attempt_id=completed.id,
            earned_at=now - timedelta(days=1),
            expires_at=now + timedelta(days=10),
        ))
        await db.commit()
    app.dependency_overrides[get_current_user] = lambda: admin

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        archived = await client.post("/api/v1/skills/admin/skill-topics/legacy/archive")
        archived_again = await client.post("/api/v1/skills/admin/skill-topics/legacy/archive")
        archived_list = await client.get("/api/v1/skills/admin/skill-topics?include_archived=true")
        active_list = await client.get("/api/v1/skills/admin/skill-topics")
        deleted_history = await client.delete("/api/v1/skills/admin/skill-topics/legacy")
        deleted_empty = await client.delete("/api/v1/skills/admin/skill-topics/empty")

    assert archived.status_code == 200
    assert archived.json()["archived"] is True
    assert archived_again.status_code == 200
    assert archived_again.json()["archived"] is True
    assert archived.json()["total_attempts"] == 2
    assert archived.json()["expired_attempts"] == 0
    assert archived.json()["active_badges"] == 1
    assert archived.json()["expiring_badges"] == 1
    assert "legacy" in {item["topic"] for item in archived_list.json()}
    assert "legacy" not in {item["topic"] for item in active_list.json()}
    assert deleted_history.status_code == 409
    assert deleted_history.json()["detail"]["total_badges"] == 1
    assert deleted_empty.status_code == 200
    async with skill_admin_db() as db:
        archive_events = list(await db.scalars(
            select(AuditLog).where(AuditLog.action == "skill_topic_archived")
        ))
    assert len(archive_events) == 1
    assert archive_events[0].target_type == "skill_topic"
    assert archive_events[0].metadata_["topic_key"] == "legacy"
    assert archive_events[0].metadata_["topic_name"] == "Legacy Topic"
    async with skill_admin_db() as db:
        legacy_topic = await db.get(SkillTopic, "legacy")
        assert legacy_topic is not None
        assert legacy_topic.active is True
        assert legacy_topic.archived_at is not None

    app.dependency_overrides[get_current_user] = lambda: student
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        student_topics = await client.get("/api/v1/skills/topics")
        resumed = await client.post("/api/v1/skills/assessments/start", json={"topic": "legacy"})
        submitted = await client.post(
            f"/api/v1/skills/assessments/{in_progress.id}/submit",
            json={"answers": [0] * 10},
        )
        start_archived = await client.post("/api/v1/skills/assessments/start", json={"topic": "legacy"})
        archived_search = await client.get("/api/v1/search/suggest?q=legacy&scope=skill_topics")
    assert all(item["id"] != "legacy" for item in student_topics.json())
    assert resumed.status_code == 200
    assert resumed.json()["resumed"] is True
    assert submitted.status_code == 200
    assert submitted.json()["attempt_id"] == in_progress.id
    assert submitted.json()["score"] == 100
    assert start_archived.status_code == 404
    assert archived_search.json()["items"] == []


@pytest.mark.anyio
async def test_skill_topic_history_and_delete_guardrails(skill_admin_db) -> None:
    admin = _user(1, UserRole.ADMIN)
    async with skill_admin_db() as db:
        db.add_all([
            admin,
            SkillTopic(slug="topic-a", name="Topic A", description="", icon="✦", badge_title="Topic A", active=False),
        ])
        await db.commit()

    app.dependency_overrides[get_current_user] = lambda: admin
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        created = await client.post("/api/v1/skills/admin/skill-topics", json={
            "topic": "topic-b",
            "name": "Topic B",
            "description": "Topic B",
            "icon": "✦",
        })
        archive = await client.post("/api/v1/skills/admin/skill-topics/topic-b/archive")
        archive_again = await client.post("/api/v1/skills/admin/skill-topics/topic-b/archive")
        restore = await client.post("/api/v1/skills/admin/skill-topics/topic-b/restore")
        restore_again = await client.post("/api/v1/skills/admin/skill-topics/topic-b/restore")
        history = await client.get("/api/v1/skills/admin/skill-topics/topic-b/history")
        delete_unarchived = await client.delete("/api/v1/skills/admin/skill-topics/topic-a")

    assert created.status_code == 201
    assert archive.status_code == 200
    assert archive_again.status_code == 200
    assert restore.status_code == 200
    assert restore_again.status_code == 200
    assert history.status_code == 200
    assert any(event["label"] == "Created" for event in history.json()["events"])
    assert any(event["label"] == "Archived" for event in history.json()["events"])
    assert delete_unarchived.status_code == 200
    assert delete_unarchived.json()["deleted"] is True


@pytest.mark.anyio
async def test_question_key_review_api_audit_and_role_access(skill_admin_db) -> None:
    admin = _user(1, UserRole.ADMIN)
    student = _user(2, UserRole.STUDENT)
    now = datetime.now(timezone.utc)
    async with skill_admin_db() as db:
        db.add_all([
            admin,
            student,
            SkillTopic(slug="python", name="Python", description="", icon="✦", badge_title="Python"),
            SkillQuestion(
                topic="python",
                subtopic="syntax",
                prompt="Legacy answer key",
                options=["first", "second"],
                correct_index=0,
                explanation="Explanation",
                source="Admin curated question",
            ),
            SkillQuestion(
                topic="python",
                subtopic="syntax",
                prompt="Injected invalid key",
                options=["one", "two"],
                correct_index=7,
                explanation="Explanation",
                source="Admin curated question",
            ),
            SkillAttempt(
                student_id=2,
                topic="python",
                status="SUBMITTED",
                question_ids=[2],
                question_snapshots=[{
                    "prompt": "Injected invalid key",
                    "options": ["one", "two"],
                    "correct_index": 0,
                    "correct_answers": [0],
                    "explanation": "Explanation",
                    "question_type": "SINGLE",
                }],
                option_orders=[[0, 1]],
                answers=[0],
                score=100,
                weighted_percentage=100,
                passed=True,
                started_at=now - timedelta(minutes=5),
                expires_at=now + timedelta(minutes=10),
                submitted_at=now,
            ),
        ])
        await db.commit()
    app.dependency_overrides[get_current_user] = lambda: admin

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        created = await client.post("/api/v1/skills/admin/questions", json={
            "topic": "python",
            "subtopic": "syntax",
            "prompt": "One-based API answer",
            "options": ["first", "second"],
            "correct_option_number": 2,
            "explanation": "The second option is right.",
            "source": "Admin curated question",
        })
        ambiguous = await client.post("/api/v1/skills/admin/questions", json={
            "topic": "python",
            "subtopic": "syntax",
            "prompt": "Ambiguous API answer",
            "options": ["first", "second"],
            "correct_index": 0,
            "correct_option_number": 1,
            "explanation": "Conflicting field formats.",
        })
        pending = await client.get("/api/v1/skills/admin/questions/key-review")
        audit = await client.get("/api/v1/skills/admin/questions/key-audit")
        fixed = await client.post(
            "/api/v1/skills/admin/questions/2/key-review",
            json={"correct_option_number": 2},
        )
        reviewed = await client.post("/api/v1/skills/admin/questions/1/key-review", json={})

    assert created.status_code == 201
    assert created.json()["correct_index"] == 1
    assert created.json()["correct_option_number"] == 2
    assert created.json()["key_reviewed_at"] is not None
    assert ambiguous.status_code == 422
    assert pending.status_code == 200
    assert len(pending.json()) == 2
    assert pending.json()[0]["correct_option_number"] == 1
    assert fixed.status_code == 200
    assert fixed.json()["correct_index"] == 1
    assert fixed.json()["correct_option_number"] == 2
    assert fixed.json()["key_reviewed_at"] is not None
    assert reviewed.status_code == 200
    async with skill_admin_db() as db:
        old_attempt = await db.get(SkillAttempt, 1)
        assert old_attempt is not None
        assert old_attempt.question_snapshots[0]["correct_index"] == 0
        assert _question_results(old_attempt)[0]["correct_answer"] == "one"
    assert "stored_key_number" in audit.text
    assert "key outside option range" in audit.text

    app.dependency_overrides[get_current_user] = lambda: student
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        forbidden = await client.get("/api/v1/skills/admin/questions/key-review")
    assert forbidden.status_code == 403


@pytest.mark.anyio
async def test_inactive_unready_topic_is_hidden_and_cannot_start(skill_admin_db) -> None:
    student = _user(2, UserRole.STUDENT)
    async with skill_admin_db() as db:
        db.add_all(
            [
                student,
                SkillTopic(
                    slug="python",
                    name="Python",
                    description="",
                    icon="🐍",
                    badge_title="Python expert",
                    active=False,
                ),
            ]
        )
        await db.commit()
    app.dependency_overrides[get_current_user] = lambda: student

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/api/v1/skills/assessments/start", json={"topic": "python"})

    assert response.status_code == 409
    assert response.json()["detail"] == "This assessment topic is not ready yet"


@pytest.mark.anyio
async def test_topic_template_round_trips_and_escapes_spreadsheet_formulas(skill_admin_db) -> None:
    admin = _user(1, UserRole.ADMIN)
    student = _user(2, UserRole.STUDENT)
    async with skill_admin_db() as db:
        db.add_all([
            admin,
            student,
            SkillTopic(slug="source-topic", name="Source", description="", icon="✦", badge_title="Source"),
            SkillTopic(slug="target-topic", name="Target", description="", icon="✦", badge_title="Target"),
            SkillTopic(slug="empty-topic", name="Empty", description="", icon="✦", badge_title="Empty"),
            SkillQuestion(
                topic="source-topic",
                subtopic="general",
                prompt="=SUM(1,1)",
                options=["=2+2", "four"],
                correct_index=1,
                explanation="Four is correct.",
                difficulty="EASY",
                question_type="SINGLE",
                source="@source",
            ),
        ])
        await db.commit()
    app.dependency_overrides[get_current_user] = lambda: admin

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        template = await client.get(
            "/api/v1/skills/admin/questions/import/template?topic_id=source-topic"
        )
        empty_template = await client.get(
            "/api/v1/skills/admin/questions/import/template?topic_id=empty-topic"
        )
        imported = await client.post(
            "/api/v1/skills/admin/questions/import?topic_id=target-topic",
            files={"file": ("template.csv", template.content, "text/csv")},
        )

    assert template.status_code == 200
    assert "skill-source-topic-template-" in template.headers["content-disposition"]
    template_text = template.content.decode("utf-8")
    rows = list(csv.DictReader(io.StringIO(template_text)))
    assert "correct_option" in rows[0]
    assert rows[0]["prompt"] == "'=SUM(1,1)"
    assert rows[0]["source"] == "'@source"
    assert rows[0]["correct_option"] == "2"
    assert empty_template.status_code == 200
    empty_rows = list(csv.DictReader(io.StringIO(empty_template.content.decode("utf-8"))))
    assert len(empty_rows) == 1
    assert "EXAMPLE" in empty_rows[0]["prompt"]
    assert imported.status_code == 200
    assert imported.json()["errors"] == []
    assert imported.json()["imported"] == 1
    async with skill_admin_db() as db:
        round_trip = await db.scalar(
            select(SkillQuestion).where(
                SkillQuestion.topic == "target-topic",
                SkillQuestion.prompt == "=SUM(1,1)",
            )
        )
        assert round_trip is not None
        assert round_trip.options == ["=2+2", "four"]
        assert round_trip.correct_index == 1
        assert round_trip.source == "@source"

    app.dependency_overrides[get_current_user] = lambda: student
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        forbidden = await client.get(
            "/api/v1/skills/admin/questions/import/template?topic_id=source-topic"
        )
    assert forbidden.status_code == 403


@pytest.mark.anyio
async def test_admin_topic_metrics_and_endpoints_are_scoped_and_consistent(skill_admin_db) -> None:
    admin = _user(1, UserRole.ADMIN)
    now = datetime.now(timezone.utc)
    async with skill_admin_db() as db:
        db.add(admin)
        db.add_all(
            [
                User(
                    id=user_id,
                    email=f"student{user_id}@example.test",
                    password_hash="not-returned",
                    role=UserRole.STUDENT,
                    is_active=True,
                    is_verified=True,
                )
                for user_id in range(2, 10)
            ]
        )
        db.add_all(
            [
                SkillTopic(slug="python", name="Python", description="", icon="🐍", badge_title="Python"),
                SkillTopic(slug="react", name="React", description="", icon="⚛", badge_title="React"),
                SkillQuestion(
                    topic="python",
                    subtopic="syntax",
                    prompt="Python-only question",
                    options=["A", "B"],
                    correct_index=0,
                    explanation="Answer",
                    difficulty="EASY",
                    source="test",
                ),
                SkillQuestion(
                    topic="react",
                    subtopic="hooks",
                    prompt="React-only question",
                    options=["A", "B"],
                    correct_index=0,
                    explanation="Answer",
                    difficulty="HARD",
                    source="test",
                ),
                SkillLearningResource(
                    topic="python",
                    subtopic="syntax",
                    title="Python resource",
                    url="https://example.test/python",
                ),
                SkillLearningResource(
                    topic="react",
                    subtopic="hooks",
                    title="React resource",
                    url="https://example.test/react",
                ),
            ]
        )
        for offset in range(5):
            db.add(SkillAttempt(
                student_id=offset + 2,
                topic="python",
                status="COMPLETED",
                question_ids=[],
                question_snapshots=[],
                option_orders=[],
                score=80 + offset,
                weighted_percentage=80 + offset,
                passed=offset > 0,
                started_at=now - timedelta(days=offset + 1),
                submitted_at=now - timedelta(days=offset + 1),
                expires_at=now + timedelta(minutes=15),
                subtopic_scores={"syntax": {"percentage": 70 + offset}},
            ))
        db.add_all([
            SkillAttempt(
                student_id=7,
                topic="python",
                status="EXPIRED",
                question_ids=[],
                question_snapshots=[],
                option_orders=[],
                score=0,
                weighted_percentage=0,
                passed=False,
                started_at=now - timedelta(hours=2),
                submitted_at=now - timedelta(hours=1),
                expires_at=now - timedelta(hours=1),
            ),
            SkillAttempt(
                student_id=8,
                topic="python",
                status="IN_PROGRESS",
                question_ids=[],
                question_snapshots=[],
                option_orders=[],
                started_at=now - timedelta(minutes=5),
                expires_at=now + timedelta(minutes=10),
            ),
            SkillAttempt(
                student_id=9,
                topic="react",
                status="COMPLETED",
                question_ids=[],
                question_snapshots=[],
                option_orders=[],
                score=100,
                weighted_percentage=100,
                passed=True,
                started_at=now - timedelta(days=1),
                submitted_at=now - timedelta(days=1),
                expires_at=now + timedelta(minutes=15),
                subtopic_scores={"hooks": {"percentage": 100}},
            ),
        ])
        await db.commit()
    app.dependency_overrides[get_current_user] = lambda: admin

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        stats = await client.get("/api/v1/skills/admin/stats?topic_id=python")
        topic_list = await client.get("/api/v1/skills/admin/topics?topic_id=python")
        topic_detail = await client.get("/api/v1/skills/admin/topics/python?topic_id=python")
        questions = await client.get("/api/v1/skills/admin/questions?topic_id=python")
        resources = await client.get("/api/v1/skills/admin/resources?topic_id=python")
        attempts = await client.get(
            "/api/v1/skills/admin/topics/python/attempts?topic_id=python&page_size=10"
        )
        react_attempts = await client.get(
            "/api/v1/skills/admin/topics/react/attempts?topic_id=react"
        )
        expired = await client.get(
            "/api/v1/skills/admin/topics/python/attempts?topic_id=python&status=EXPIRED"
        )
        python_attempt_id = attempts.json()["items"][0]["id"]
        react_attempt_id = react_attempts.json()["items"][0]["id"]
        expired_attempt_id = expired.json()["items"][0]["id"]
        attempt_detail = await client.get(
            f"/api/v1/skills/admin/attempts/{python_attempt_id}?topic_id=python"
        )
        expired_detail = await client.get(
            f"/api/v1/skills/admin/attempts/{expired_attempt_id}?topic_id=python"
        )
        mismatch_detail = await client.get(
            f"/api/v1/skills/admin/attempts/{react_attempt_id}?topic_id=python"
        )
        template = await client.get(
            "/api/v1/skills/admin/questions/import/template?topic_id=python"
        )
        imported = await client.post(
            "/api/v1/skills/admin/questions/import?topic_id=python",
            files={
                "file": (
                    "topic-questions.csv",
                    b'topic,prompt,options,correct_index,explanation,difficulty,question_type,subtopic,source\n'
                    b'react,"Imported topic question","A|B",0,"Explanation",EASY,SINGLE,basic,test\n',
                    "text/csv",
                )
            },
        )
        questions_after_import = await client.get(
            "/api/v1/skills/admin/questions?topic_id=python"
        )

    assert stats.status_code == topic_list.status_code == topic_detail.status_code == questions.status_code == resources.status_code == 200
    assert len(stats.json()) == len(topic_list.json()) == 1
    summary = stats.json()[0]
    assert topic_detail.json() == summary
    assert summary["topic"] == "python"
    assert summary["attempts"] == 7
    assert summary["attempt_status_counts"] == {"completed": 5, "expired": 1, "in_progress": 1}
    assert sum(summary["attempt_status_counts"].values()) == summary["attempts"]
    assert summary["pass_rate"] == 80
    assert summary["average_score"] == 82
    assert summary["score_sample_size"] == 5
    assert summary["analytics_ready"] is True
    assert summary["question_pool_sizes"] == {
        "EASY": {"active": 1, "inactive": 0},
        "MEDIUM": {"active": 0, "inactive": 0},
        "HARD": {"active": 0, "inactive": 0},
    }
    assert summary["weakest_subtopics"] == [{"subtopic": "syntax", "average_percentage": 72, "attempts": 5}]
    assert all(item["topic"] == "python" for item in questions.json())
    assert [item["title"] for item in resources.json()] == ["Python resource"]
    assert attempts.json()["total"] == attempts.json()["filtered_total"] == summary["attempts"]
    assert len(attempts.json()["items"]) == 7
    assert expired.json()["total"] == 7
    assert expired.json()["filtered_total"] == 1
    assert expired.json()["items"][0]["status"] == "EXPIRED"
    assert expired.json()["items"][0]["score"] is None
    assert attempt_detail.status_code == 200
    assert attempt_detail.json()["topic"] == "python"
    assert expired_detail.json()["score"] is None
    assert expired_detail.json()["passed"] is None
    assert mismatch_detail.status_code == 404
    assert b"python" in template.content
    assert imported.status_code == 200
    assert imported.json()["imported"] == 1
    assert any(item["prompt"] == "Imported topic question" for item in questions_after_import.json())
