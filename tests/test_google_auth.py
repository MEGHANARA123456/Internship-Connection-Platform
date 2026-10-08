from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.v1 import auth
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


@pytest.fixture
def google_identity(monkeypatch):
    async def verify_google_credential(_credential, fallback_email, fallback_name):
        return str(fallback_email).strip().lower(), fallback_name or "Google User"

    monkeypatch.setattr("app.api.v1.auth.verify_google_credential", verify_google_credential)


@pytest.mark.anyio
async def test_google_auth_new_student(test_client: AsyncClient, google_identity):
    payload = {
        "credential": "test-google-credential",
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
async def test_google_auth_new_company(test_client: AsyncClient, google_identity):
    payload = {
        "credential": "test-google-credential",
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
async def test_google_auth_existing_user_login(test_client: AsyncClient, google_identity):
    payload = {
        "email": "recurring.google@gmail.com",
        "name": "Recurring User",
        "role": "STUDENT",
    }
    res1 = await test_client.post("/api/v1/auth/google", json=payload)
    assert res1.status_code == 200
    uid1 = res1.json()["user_id"]

    # Second sign in via Google with same email
    res2 = await test_client.post("/api/v1/auth/google", json={"credential": "test-google-credential", "email": "recurring.google@gmail.com"})
    assert res2.status_code == 200
    assert res2.json()["user_id"] == uid1


@pytest.mark.anyio
async def test_google_auth_requires_google_credential(test_client: AsyncClient):
    res = await test_client.post("/api/v1/auth/google", json={"email": "typed@example.com", "role": "STUDENT"})
    assert res.status_code == 400
    assert "valid Google credential" in res.json()["detail"]


@pytest.mark.anyio
async def test_google_auth_cannot_create_admin_but_promotes_existing_listed_account(
    test_client: AsyncClient,
    google_identity,
    monkeypatch: pytest.MonkeyPatch,
):
    settings = auth.get_settings().model_copy(update={"admin_emails": "privileged@example.com"})
    monkeypatch.setattr(auth, "get_settings", lambda: settings)
    payload = {
        "credential": "test-google-credential",
        "email": "privileged@example.com",
        "name": "Privileged User",
        "role": "ADMIN",
    }

    created = await test_client.post("/api/v1/auth/google", json=payload)
    assert created.status_code == 200
    assert created.json()["role"] == "STUDENT"

    existing = await test_client.post("/api/v1/auth/google", json={**payload, "role": "COMPANY"})
    assert existing.status_code == 200
    assert existing.json()["role"] == "ADMIN"

    unlisted = await test_client.post(
        "/api/v1/auth/google",
        json={**payload, "email": "unlisted@example.com"},
    )
    assert unlisted.status_code == 200
    assert unlisted.json()["role"] == "STUDENT"

    registration = await test_client.post(
        "/api/v1/auth/register/student",
        json={
            "email": "pending@example.com",
            "password": "StrongPassword123!",
            "full_name": "Pending Account",
            "university": "Example University",
            "major": "Computer Science",
            "graduation_year": 2027,
        },
    )
    assert registration.status_code == 201
    pending = await test_client.post(
        "/api/v1/auth/google",
        json={**payload, "email": "pending@example.com"},
    )
    assert pending.status_code == 200
    assert pending.json()["role"] == "STUDENT"


@pytest.mark.anyio
async def test_google_id_token_audience_must_match_configured_client(monkeypatch: pytest.MonkeyPatch):
    class TokenInfoResponse:
        status_code = 200

        def __init__(self, audience: str):
            self.audience = audience

        def json(self):
            return {"aud": self.audience, "email": "person@example.com", "name": "Example Person"}

    class FakeAsyncClient:
        def __init__(self, response: TokenInfoResponse, **kwargs):
            self.response = response

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, traceback):
            return None

        async def get(self, url):
            return self.response

    monkeypatch.setattr(
        auth,
        "get_settings",
        lambda: SimpleNamespace(google_client_id="client-id.apps.googleusercontent.com"),
    )
    monkeypatch.setattr(
        auth.httpx,
        "AsyncClient",
        lambda **kwargs: FakeAsyncClient(TokenInfoResponse("wrong-audience")),
    )
    with pytest.raises(HTTPException) as exc_info:
        await auth.verify_google_credential("id-token", None, None)
    assert exc_info.value.status_code == 400

    monkeypatch.setattr(
        auth.httpx,
        "AsyncClient",
        lambda **kwargs: FakeAsyncClient(
            TokenInfoResponse("client-id.apps.googleusercontent.com")
        ),
    )
    assert await auth.verify_google_credential("id-token", None, None) == (
        "person@example.com",
        "Example Person",
    )
