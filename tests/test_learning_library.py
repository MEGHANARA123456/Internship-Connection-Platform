from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import event, func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.v1.dependencies import get_db
from app.core.security import create_token
from app.main import app
from app.models import (
    InterviewReport,
    InterviewSession,
    LearningCategory,
    LearningPath,
    LearningPathResource,
    LearningResource,
    StudentLearningBookmark,
    StudentLearningPreference,
    StudentResourceProgress,
    User,
    UserRole,
)
from app.models.base import Base
from app.services.learning_library_seed import seed_learning_library


@pytest.fixture
async def learning_env(tmp_path: Path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'learning-library.sqlite'}")

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
        students = [
            User(
                email=f"learning-student-{index}@example.test",
                password_hash="test",
                role=UserRole.STUDENT,
                is_active=True,
                is_verified=True,
            )
            for index in (1, 2)
        ]
        company = User(
            email="learning-company@example.test",
            password_hash="test",
            role=UserRole.COMPANY,
            is_active=True,
            is_verified=True,
        )
        admin = User(
            email="learning-admin@example.test",
            password_hash="test",
            role=UserRole.ADMIN,
            is_active=True,
            is_verified=True,
        )
        db.add_all([*students, company, admin])
        await db.commit()
        for user in [*students, company, admin]:
            await db.refresh(user)
        ids = {
            "students": [user.id for user in students],
            "company": company.id,
            "admin": admin.id,
        }
        await seed_learning_library(db)

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
async def test_progress_bookmarks_and_path_progress_are_student_scoped(learning_env):
    client = learning_env["client"]
    student_one, student_two = learning_env["ids"]["students"]
    headers = learning_env["headers"]

    listing = await client.get(
        "/api/v1/learning/resources",
        headers=headers(student_one, "STUDENT"),
    )
    assert listing.status_code == 200
    resource = next(
        item for item in listing.json()["items"]
        if item["slug"] == "python-language-tutorial"
    )
    await client.put(
        f"/api/v1/learning/resources/{resource['id']}/progress",
        headers=headers(student_one, "STUDENT"),
        json={"status": "COMPLETED"},
    )
    await client.put(
        f"/api/v1/learning/resources/{resource['id']}/progress",
        headers=headers(student_one, "STUDENT"),
        json={"status": "VIEWED"},
    )
    for _ in range(2):
        response = await client.put(
            f"/api/v1/learning/resources/{resource['id']}/bookmark",
            headers=headers(student_one, "STUDENT"),
        )
        assert response.status_code == 200

    other_student_resources = await client.get(
        "/api/v1/learning/resources",
        headers=headers(student_two, "STUDENT"),
    )
    other_resource = next(
        item for item in other_student_resources.json()["items"]
        if item["id"] == resource["id"]
    )
    assert other_resource["progress"] is None
    assert other_resource["bookmarked"] is False

    data_path = next(
        item for item in (
            await client.get(
                "/api/v1/learning/paths",
                headers=headers(student_one, "STUDENT"),
                params={"role": "data-scientist"},
            )
        ).json()
        if item["slug"] == "data-scientist"
    )
    path_resource_id = data_path["resources"][0]["id"]
    await client.put(
        f"/api/v1/learning/resources/{path_resource_id}/progress",
        headers=headers(student_one, "STUDENT"),
        json={"status": "COMPLETED"},
    )
    refreshed_path = await client.get(
        f"/api/v1/learning/paths/{data_path['id']}",
        headers=headers(student_one, "STUDENT"),
    )
    assert refreshed_path.status_code == 200
    assert refreshed_path.json()["completed_count"] == 1
    assert refreshed_path.json()["progress_percent"] == 25


@pytest.mark.anyio
async def test_recommendations_map_latest_weak_skill_to_verified_resources(learning_env):
    student_id = learning_env["ids"]["students"][0]
    client = learning_env["client"]
    student_headers = learning_env["headers"](student_id, "STUDENT")
    async with learning_env["sessions"]() as db:
        session = InterviewSession(
            student_id=student_id,
            session_type="ASSESSMENT",
            interview_mode="TEXT",
            category="TECHNICAL",
            difficulty="INTERMEDIATE",
            question_count=5,
            time_limit_seconds=1200,
            status="COMPLETED",
            consent_acknowledged=True,
            consent_acknowledged_at=datetime.now(timezone.utc),
            completed_at=datetime.now(timezone.utc),
        )
        db.add(session)
        await db.flush()
        db.add(
            InterviewReport(
                session_id=session.id,
                status="COMPLETED",
                overall_score=64,
                skill_breakdown={
                    "technical_correctness": 4,
                    "communication": 9,
                },
                answer_count=5,
                completed_at=datetime.now(timezone.utc),
            )
        )
        await db.commit()
        python_practice_id = await db.scalar(
            select(LearningResource.id).where(
                LearningResource.slug == "hackerrank-python-practice"
            )
        )
    await client.put(
        f"/api/v1/learning/resources/{python_practice_id}/bookmark",
        headers=student_headers,
    )

    response = await client.get(
        "/api/v1/learning/recommendations",
        headers=student_headers,
    )
    assert response.status_code == 200
    data = response.json()
    assert data["weakest_skill"] == "technical_correctness"
    assert "hackerrank-python-practice" in {
        item["slug"] for item in data["resources"]
    }
    recommended = next(
        item for item in data["resources"]
        if item["slug"] == "hackerrank-python-practice"
    )
    assert recommended["bookmarked"] is True
    another_student_response = await client.get(
        "/api/v1/learning/recommendations",
        headers=learning_env["headers"](
            learning_env["ids"]["students"][1],
            "STUDENT",
        ),
    )
    assert another_student_response.status_code == 200
    assert another_student_response.json()["weakest_skill"] is None


@pytest.mark.anyio
async def test_catalog_seed_is_idempotent(learning_env):
    async with learning_env["sessions"]() as db:
        await seed_learning_library(db)
        await seed_learning_library(db)
        counts = {
            "categories": await db.scalar(select(func.count()).select_from(LearningCategory)),
            "resources": await db.scalar(select(func.count()).select_from(LearningResource)),
            "paths": await db.scalar(select(func.count()).select_from(LearningPath)),
            "assignments": await db.scalar(select(func.count()).select_from(LearningPathResource)),
        }
    assert counts == {"categories": 4, "resources": 18, "paths": 8, "assignments": 28}


@pytest.mark.anyio
async def test_learning_records_cascade_when_student_is_deleted(learning_env):
    student_id = learning_env["ids"]["students"][0]
    async with learning_env["sessions"]() as db:
        resource_id = await db.scalar(
            select(LearningResource.id).where(
                LearningResource.slug == "python-language-tutorial"
            )
        )
        db.add_all([
            StudentResourceProgress(
                student_id=student_id,
                resource_id=resource_id,
                status="COMPLETED",
            ),
            StudentLearningBookmark(student_id=student_id, resource_id=resource_id),
            StudentLearningPreference(
                student_id=student_id,
                target_role="python-developer",
            ),
        ])
        await db.commit()
        student = await db.get(User, student_id)
        await db.delete(student)
        await db.commit()
        remaining = {
            "progress": await db.scalar(
                select(func.count()).select_from(StudentResourceProgress).where(
                    StudentResourceProgress.student_id == student_id
                )
            ),
            "bookmarks": await db.scalar(
                select(func.count()).select_from(StudentLearningBookmark).where(
                    StudentLearningBookmark.student_id == student_id
                )
            ),
            "preferences": await db.scalar(
                select(func.count()).select_from(StudentLearningPreference).where(
                    StudentLearningPreference.student_id == student_id
                )
            ),
        }
    assert remaining == {"progress": 0, "bookmarks": 0, "preferences": 0}


@pytest.mark.anyio
async def test_admin_requires_role_validates_https_and_audits_changes(learning_env):
    client = learning_env["client"]
    student_id = learning_env["ids"]["students"][0]
    company_id = learning_env["ids"]["company"]
    admin_id = learning_env["ids"]["admin"]
    headers = learning_env["headers"]

    for user_id, role in [(student_id, "STUDENT"), (company_id, "COMPANY")]:
        forbidden = await client.get(
            "/api/v1/admin/learning/resources",
            headers=headers(user_id, role),
        )
        assert forbidden.status_code == 403
    company_categories = await client.get(
        "/api/v1/learning/categories",
        headers=headers(company_id, "COMPANY"),
    )
    assert company_categories.status_code == 403

    category_response = await client.get(
        "/api/v1/admin/learning/categories",
        headers=headers(admin_id, "ADMIN"),
    )
    category = next(item for item in category_response.json() if item["slug"] == "programming")
    payload = {
        "slug": "new-resource-for-validation",
        "category_id": category["id"],
        "title": "New resource for validation",
        "description": "A test entry that requires a valid secure URL.",
        "url": "http://example.test/unsafe",
        "resource_type": "link",
        "level": "ALL",
        "role_tags": ["python-developer"],
        "topic_tags": ["python"],
        "active": True,
    }
    invalid_url = await client.post(
        "/api/v1/admin/learning/resources",
        headers=headers(admin_id, "ADMIN"),
        json=payload,
    )
    assert invalid_url.status_code == 422

    payload["url"] = "https://example.test/learning"
    created = await client.post(
        "/api/v1/admin/learning/resources",
        headers=headers(admin_id, "ADMIN"),
        json=payload,
    )
    assert created.status_code == 201
    resource_id = created.json()["id"]
    assert created.json()["verified_at"] is None
    verified = await client.post(
        f"/api/v1/admin/learning/resources/{resource_id}/verify",
        headers=headers(admin_id, "ADMIN"),
    )
    assert verified.status_code == 200
    filtered_resources = await client.get(
        "/api/v1/learning/resources",
        headers=headers(student_id, "STUDENT"),
        params={"search": "New resource", "category": "programming", "level": "ALL"},
    )
    assert resource_id in {item["id"] for item in filtered_resources.json()["items"]}
    deactivated = await client.patch(
        f"/api/v1/admin/learning/resources/{resource_id}",
        headers=headers(admin_id, "ADMIN"),
        json={"active": False},
    )
    assert deactivated.status_code == 200

    student_resources = await client.get(
        "/api/v1/learning/resources",
        headers=headers(student_id, "STUDENT"),
    )
    assert resource_id not in {item["id"] for item in student_resources.json()["items"]}

    audit = await client.get(
        "/api/v1/admin/learning/audit",
        headers=headers(admin_id, "ADMIN"),
    )
    assert audit.status_code == 200
    actions = {entry["action"] for entry in audit.json()}
    assert "learning_resource_created" in actions
    assert "learning_resource_verified" in actions
    assert "learning_resource_updated" in actions
    assert all(entry["action"].startswith("learning_") for entry in audit.json())

    deactivated_category = await client.patch(
        f"/api/v1/admin/learning/categories/{category['id']}",
        headers=headers(admin_id, "ADMIN"),
        json={"active": False},
    )
    assert deactivated_category.status_code == 200
    student_categories = await client.get(
        "/api/v1/learning/categories",
        headers=headers(student_id, "STUDENT"),
    )
    assert category["slug"] not in {item["slug"] for item in student_categories.json()}
    student_paths = await client.get(
        "/api/v1/learning/paths",
        headers=headers(student_id, "STUDENT"),
        params={"role": "python-developer"},
    )
    assert all(item["slug"] != "python-developer" for item in student_paths.json())
    assert all("answer_text" not in str(entry) for entry in audit.json())


@pytest.mark.anyio
async def test_learning_library_rejects_unauthenticated_access(learning_env):
    for path in ("/api/v1/learning/categories", "/api/v1/learning/resources"):
        response = await learning_env["client"].get(path)
        assert response.status_code == 401
