import pytest
from httpx import ASGITransport, AsyncClient
from jose import jwt
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.v1.dependencies import get_db
from app.main import app
from app.models.base import Base


@pytest.fixture
async def test_client():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async def override_db():
        async with sessions() as session:
            yield session

    app.dependency_overrides[get_db] = override_db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client

    app.dependency_overrides.clear()
    await engine.dispose()


@pytest.mark.anyio
async def test_google_auth_new_student(test_client: AsyncClient):
    payload = {
        "email": "alex.chen.google@gmail.com",
        "name": "Alex Chen",
        "role": "STUDENT",
    }
    res = await test_client.post("/api/v1/auth/google", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert "access_token" in data
    assert "refresh_token" in data
    assert data["role"] == "STUDENT"
    assert data["user_id"] > 0


@pytest.mark.anyio
async def test_google_auth_new_company(test_client: AsyncClient):
    payload = {
        "email": "hr.google.test@enterprise.org",
        "name": "Enterprise Labs",
        "role": "COMPANY",
    }
    res = await test_client.post("/api/v1/auth/google", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert "access_token" in data
    assert data["role"] == "COMPANY"


@pytest.mark.anyio
async def test_google_auth_existing_user_login(test_client: AsyncClient):
    payload = {
        "email": "recurring.google@gmail.com",
        "name": "Recurring User",
        "role": "STUDENT",
    }
    res1 = await test_client.post("/api/v1/auth/google", json=payload)
    assert res1.status_code == 200
    uid1 = res1.json()["user_id"]

    # Second sign in via Google with same email
    res2 = await test_client.post("/api/v1/auth/google", json={"email": "recurring.google@gmail.com"})
    assert res2.status_code == 200
    assert res2.json()["user_id"] == uid1


@pytest.mark.anyio
async def test_google_auth_jwt_token(test_client: AsyncClient):
    fake_jwt = jwt.encode({"email": "jwt.google.user@gmail.com", "name": "JWT User"}, "secret", algorithm="HS256")
    res = await test_client.post("/api/v1/auth/google", json={"credential": fake_jwt, "role": "STUDENT"})
    assert res.status_code == 200
    data = res.json()
    assert "access_token" in data
    assert data["role"] == "STUDENT"
