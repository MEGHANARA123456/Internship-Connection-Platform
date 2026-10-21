from datetime import timedelta

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.core.config import get_settings
from app.core.security import create_token
from app.middleware.security import SecurityMiddleware


def _limited_app() -> FastAPI:
    application = FastAPI()
    application.add_middleware(SecurityMiddleware)

    @application.get("/api/v1/items")
    async def items() -> dict[str, str]:
        return {"status": "ok"}

    @application.post("/api/v1/auth/login")
    async def login() -> dict[str, str]:
        return {"status": "ok"}

    return application


@pytest.mark.anyio
async def test_authenticated_users_from_same_ip_have_separate_buckets(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("RATE_LIMIT_REQUESTS", "1")
    monkeypatch.setenv("RATE_LIMIT_WINDOW_SECONDS", "60")
    get_settings.cache_clear()
    app = _limited_app()
    token_a = create_token("101", "STUDENT", "access", timedelta(minutes=5))
    token_b = create_token("202", "COMPANY", "access", timedelta(minutes=5))

    async with AsyncClient(
        transport=ASGITransport(app=app, client=("203.0.113.10", 4567)),
        base_url="http://rate-limit-test",
    ) as client:
        response_a = await client.get("/api/v1/items", headers={"Authorization": f"Bearer {token_a}"})
        response_b = await client.get("/api/v1/items", headers={"Authorization": f"Bearer {token_b}"})
        blocked_a = await client.get("/api/v1/items", headers={"Authorization": f"Bearer {token_a}"})

    assert response_a.status_code == 200
    assert response_b.status_code == 200
    assert blocked_a.status_code == 429
    assert int(blocked_a.headers["retry-after"]) >= 1
    get_settings.cache_clear()


@pytest.mark.anyio
async def test_login_is_limited_by_ip_and_retry_after_is_returned(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AUTH_RATE_LIMIT_REQUESTS", "1")
    monkeypatch.setenv("AUTH_RATE_LIMIT_WINDOW_SECONDS", "60")
    get_settings.cache_clear()
    app = _limited_app()

    async with AsyncClient(
        transport=ASGITransport(app=app, client=("203.0.113.11", 4567)),
        base_url="http://rate-limit-test",
    ) as client:
        first = await client.post("/api/v1/auth/login", json={"email": "student@example.com"})
        second = await client.post("/api/v1/auth/login", json={"email": "other@example.com"})

    assert first.status_code == 200
    assert second.status_code == 429
    assert int(second.headers["retry-after"]) >= 1
    assert "retry in" in second.json()["detail"].lower()
    get_settings.cache_clear()


@pytest.mark.anyio
async def test_forwarded_ip_is_used_only_for_configured_proxies(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("RATE_LIMIT_REQUESTS", "1")
    monkeypatch.setenv("TRUSTED_PROXIES", "10.0.0.0/8")
    get_settings.cache_clear()
    app = _limited_app()

    async with AsyncClient(
        transport=ASGITransport(app=app, client=("10.0.0.2", 4567)),
        base_url="http://rate-limit-test",
    ) as client:
        first = await client.get("/api/v1/items", headers={"X-Forwarded-For": "198.51.100.1"})
        second = await client.get("/api/v1/items", headers={"X-Forwarded-For": "198.51.100.2"})

    assert first.status_code == 200
    assert second.status_code == 200
    get_settings.cache_clear()
