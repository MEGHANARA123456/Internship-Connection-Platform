from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.v1.dependencies import get_current_user, get_db
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
            json={"name": "Python Systems", "active": False},
        )
        listing = await client.get("/api/v1/skills/admin/topics")
        attempts = await client.get("/api/v1/skills/admin/topics/python/attempts")
        attempt = await client.get("/api/v1/skills/admin/attempts/1")

    assert update.status_code == 200
    assert update.json()["name"] == "Python Systems"
    assert update.json()["active"] is False
    assert listing.status_code == 200
    assert next(item for item in listing.json() if item["topic"] == "python")["active"] is False
    assert attempts.status_code == 200
    assert attempts.json()["total"] == 1
    assert attempts.json()["items"][0]["student_email"] == student.email
    assert attempt.status_code == 200
    assert attempt.json()["subtopic_scores"]["syntax"]["percentage"] == 90
    async with skill_admin_db() as db:
        actions = set(await db.scalars(
            select(AuditLog.action)
        ))
    assert actions == {"skill_topic_deactivated"}


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
        activated = await client.patch(
            "/api/v1/skills/admin/topics/web-security",
            json={"active": True},
        )

    assert created.status_code == 201
    assert duplicate.status_code == 409
    assert unready_activation.status_code == 422
    assert "Easy: 0/4" in unready_activation.json()["detail"]
    assert missing_topic_question.status_code == 404
    assert missing_topic_update.status_code == 404
    assert all(response.status_code == 201 for response in created_questions)
    assert subtopics.json() == [{"id": "system-design", "question_count": 10}]
    assert activated.status_code == 200 and activated.json()["active"] is True

    async with skill_admin_db() as db:
        for question in await db.scalars(select(SkillQuestion).where(SkillQuestion.topic == "web-security")):
            question.active = False
        await db.commit()
    app.dependency_overrides[get_current_user] = lambda: student
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        listed = await client.get("/api/v1/skills/topics")
        deactivated = await client.patch(
            "/api/v1/skills/admin/topics/web-security",
            json={"active": False},
        )

    assert [item["id"] for item in listed.json()] == ["web-security"]
    assert listed.json()[0]["available"] is False
    assert "Add 4 more active easy question(s)" in listed.json()[0]["unavailable_reason"]
    assert deactivated.status_code == 403
    app.dependency_overrides[get_current_user] = lambda: admin


@pytest.mark.anyio
async def test_topic_archive_preserves_history_and_delete_requires_no_history(skill_admin_db) -> None:
    admin = _user(1, UserRole.ADMIN)
    student = _user(2, UserRole.STUDENT)
    now = datetime.now(timezone.utc)
    async with skill_admin_db() as db:
        db.add_all([
            admin,
            student,
            SkillTopic(slug="legacy", name="Legacy Topic", description="", icon="✦", badge_title="Legacy", active=False),
            SkillTopic(slug="empty", name="Empty Topic", description="", icon="✦", badge_title="Empty", active=False),
        ])
        await db.flush()
        completed = SkillAttempt(
            student_id=student.id,
            topic="legacy",
            status="COMPLETED",
            question_ids=[],
            question_snapshots=[],
            option_orders=[],
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
            question_ids=[],
            question_snapshots=[],
            option_orders=[],
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
        blocked = await client.post("/api/v1/skills/admin/skill-topics/legacy/archive")
        async with skill_admin_db() as db:
            active_attempt = await db.get(SkillAttempt, in_progress.id)
            assert active_attempt is not None
            active_attempt.status = "EXPIRED"
            active_attempt.submitted_at = now
            await db.commit()
        archived = await client.post("/api/v1/skills/admin/skill-topics/legacy/archive")
        archived_list = await client.get("/api/v1/skills/admin/skill-topics?include_archived=true")
        active_list = await client.get("/api/v1/skills/admin/skill-topics")
        deleted_history = await client.delete("/api/v1/skills/admin/skill-topics/legacy")
        deleted_empty = await client.delete("/api/v1/skills/admin/skill-topics/empty")

    assert blocked.status_code == 409
    assert blocked.json()["detail"]["in_progress_attempts"] == 1
    assert archived.status_code == 200
    assert archived.json()["total_attempts"] == 2
    assert archived.json()["expired_attempts"] == 1
    assert archived.json()["active_badges"] == 1
    assert archived.json()["expiring_badges"] == 1
    assert "legacy" in {item["topic"] for item in archived_list.json()}
    assert "legacy" not in {item["topic"] for item in active_list.json()}
    assert deleted_history.status_code == 409
    assert deleted_history.json()["detail"]["total_badges"] == 1
    assert deleted_empty.status_code == 200

    app.dependency_overrides[get_current_user] = lambda: student
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        student_topics = await client.get("/api/v1/skills/topics")
        start_archived = await client.post("/api/v1/skills/assessments/start", json={"topic": "legacy"})
    assert all(item["id"] != "legacy" for item in student_topics.json())
    assert start_archived.status_code == 404


@pytest.mark.anyio
async def test_inactive_topic_cannot_start_assessment(skill_admin_db) -> None:
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
    assert response.json()["detail"] == "This assessment topic is inactive"


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
