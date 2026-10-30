from datetime import date, timedelta

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.v1.dependencies import get_db
from app.main import app
from app.models import CompanyProfile, User
from app.models.base import Base


@pytest.mark.anyio
async def test_create_internship_validation_variants() -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    async def override_db():
        async with sessions() as session:
            yield session

    previous_override = app.dependency_overrides.get(get_db)
    app.dependency_overrides[get_db] = override_db
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            registration = await client.post(
                "/api/v1/auth/register/company",
                json={
                    "email": "internship-validation@example.com",
                    "password": "password123",
                    "company_name": "Validation Company",
                    "industry": "Information Technology",
                },
            )
            assert registration.status_code == 201

            async with sessions() as session:
                user = await session.scalar(select(User))
                profile = await session.scalar(select(CompanyProfile))
                assert user is not None and profile is not None
                user.is_verified = True
                profile.verification_status = "VERIFIED"
                await session.commit()

            login = await client.post(
                "/api/v1/auth/login",
                json={"email": "internship-validation@example.com", "password": "password123"},
            )
            assert login.status_code == 200
            headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

            screenshot_payload = {
                "title": "Python Developer",
                "description": "Build and maintain Python applications.",
                "location": "Bangalore, Karnataka, India",
                "industry": "Information Technology / Software Development / Artificial ...",
                "duration_months": 3,
                "stipend": 1500,
                "work_mode": "REMOTE",
                "skills": [],
                "deadline": str(date.today() + timedelta(days=30)),
            }
            screenshot_response = await client.post(
                "/api/v1/internships",
                headers=headers,
                json=screenshot_payload,
            )
            assert screenshot_response.status_code == 201, screenshot_response.text

            variants = {
                "industry over 255 characters": {"industry": "I" * 256},
                "31 skills": {"skills": [f"skill-{index}" for index in range(31)]},
                "blank deadline": {"deadline": ""},
                "empty stipend": {"stipend": ""},
            }
            expected_messages = {
                "industry": "String should have at most 255 characters",
                "skills": "List should have at most 30 items after validation, not 31",
                "deadline": "Input should be a valid date or datetime, input is too short",
                "stipend": "Input should be a valid integer, unable to parse string as an integer",
            }

            for name, changes in variants.items():
                response = await client.post(
                    "/api/v1/internships",
                    headers=headers,
                    json={**screenshot_payload, **changes},
                )
                assert response.status_code == 422, (name, response.text)
                detail = response.json()["detail"]
                expected_field = next(iter(changes))
                failure = next(
                    issue for issue in detail
                    if issue["loc"][-1] == expected_field
                )
                print(f"{name}: loc={failure['loc']}, msg={failure['msg']}")
                assert failure["loc"] == ["body", expected_field]
                assert failure["msg"] == expected_messages[expected_field]
    finally:
        if previous_override is None:
            app.dependency_overrides.pop(get_db, None)
        else:
            app.dependency_overrides[get_db] = previous_override
        await engine.dispose()
