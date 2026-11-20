from datetime import timedelta

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.v1.dependencies import get_db
from app.core.security import create_token
from app.main import app
from app.models import StudentProfile, User, UserRole
from app.models.base import Base


@pytest.mark.anyio
async def test_student_handles_persist_and_survive_profile_updates() -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    async with sessions() as session:
        student = User(
            email="handles-student@example.com",
            password_hash="unused",
            role=UserRole.STUDENT,
            is_active=True,
        )
        session.add(student)
        await session.flush()
        profile = StudentProfile(
            user_id=student.id,
            full_name="Handles Student",
            university="Example University",
            major="Computer Science",
            graduation_year=2027,
            bio="Keep this bio",
        )
        session.add(profile)
        await session.commit()
        await session.refresh(student)
        token = create_token(str(student.id), UserRole.STUDENT.value, "access", timedelta(minutes=30))

    async def override_db():
        async with sessions() as session:
            yield session

    app.dependency_overrides[get_db] = override_db
    headers = {"Authorization": f"Bearer {token}"}
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            unauthenticated = await client.put(
                "/api/v1/profiles/student/handles",
                json={"github_username": "student-dev", "leetcode_username": "student_dev"},
            )
            assert unauthenticated.status_code == 401

            initial = await client.get("/api/v1/profiles/student", headers=headers)
            assert initial.status_code == 200
            assert initial.json()["github_username"] is None
            assert initial.json()["leetcode_username"] is None

            saved = await client.put(
                "/api/v1/profiles/student/handles",
                headers=headers,
                json={"github_username": " @student-dev ", "leetcode_username": "@student_dev"},
            )
            assert saved.status_code == 200
            assert saved.json()["github_username"] == "student-dev"
            assert saved.json()["leetcode_username"] == "student_dev"

            updated_profile = await client.put(
                "/api/v1/profiles/student",
                headers=headers,
                json={
                    "full_name": "Updated Student",
                    "university": "Updated University",
                    "major": "Software Engineering",
                    "graduation_year": 2028,
                },
            )
            assert updated_profile.status_code == 200
            assert updated_profile.json()["bio"] == "Keep this bio"
            assert updated_profile.json()["github_username"] == "student-dev"
            assert updated_profile.json()["leetcode_username"] == "student_dev"

            refreshed = await client.get("/api/v1/profiles/student", headers=headers)
            assert refreshed.status_code == 200
            assert refreshed.json()["github_username"] == "student-dev"
            assert refreshed.json()["leetcode_username"] == "student_dev"

            invalid = await client.put(
                "/api/v1/profiles/student/handles",
                headers=headers,
                json={"github_username": "bad--username", "leetcode_username": "valid_name"},
            )
            assert invalid.status_code == 422

            async with sessions() as session:
                persisted = await session.scalar(
                    select(StudentProfile).where(StudentProfile.user_id == student.id)
                )
                assert persisted is not None
                assert persisted.github_username == "student-dev"
                assert persisted.leetcode_username == "student_dev"
    finally:
        app.dependency_overrides.pop(get_db, None)
        await engine.dispose()
