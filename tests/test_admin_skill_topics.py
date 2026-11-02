from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.v1.dependencies import get_current_user, get_db
from app.main import app
from app.models import AuditLog, SkillAttempt, SkillTopic, User, UserRole
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
    assert "skill_topic_updated" in actions
    assert "admin_viewed_skill_topics" in actions
    assert "admin_viewed_skill_topic_attempts" in actions
    assert "admin_viewed_skill_attempt" in actions


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
