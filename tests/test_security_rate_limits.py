from datetime import timedelta

import pytest
from fastapi import FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient

from app.core.config import get_settings
from app.core.security import create_token
from app.main import ApplicationCORSMiddleware
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

    @application.get("/api/v1/auth/me")
    async def current_user() -> dict[str, str]:
        return {"status": "ok"}

    @application.get("/api/v1/navigation/counts")
    async def navigation_counts() -> dict[str, str]:
        return {"status": "ok"}

    @application.post("/api/v1/interviews/sessions/1/audio")
    async def interview_audio() -> dict[str, str]:
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
async def test_authenticated_identity_and_navigation_reads_have_headroom(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("RATE_LIMIT_REQUESTS", "1")
    get_settings.cache_clear()
    app = _limited_app()
    token = create_token("102", "ADMIN", "access", timedelta(minutes=5))
    headers = {"Authorization": f"Bearer {token}"}

    async with AsyncClient(
        transport=ASGITransport(app=app, client=("203.0.113.15", 4567)),
        base_url="http://rate-limit-test",
    ) as client:
        responses = [
            await client.get(path, headers=headers)
            for path in ("/api/v1/auth/me", "/api/v1/navigation/counts") * 3
        ]

    assert [response.status_code for response in responses] == [200] * 6
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


@pytest.mark.anyio
async def test_interview_audio_rate_limit_uses_per_student_buckets(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("INTERVIEW_STT_REQUESTS_PER_MINUTE", "1")
    get_settings.cache_clear()
    app = _limited_app()
    token_a = create_token("301", "STUDENT", "access", timedelta(minutes=5))
    token_b = create_token("302", "STUDENT", "access", timedelta(minutes=5))
    endpoint = "/api/v1/interviews/sessions/1/audio"

    async with AsyncClient(
        transport=ASGITransport(app=app, client=("203.0.113.12", 4567)),
        base_url="http://rate-limit-test",
    ) as client:
        first_a = await client.post(endpoint, headers={"Authorization": f"Bearer {token_a}"})
        first_b = await client.post(endpoint, headers={"Authorization": f"Bearer {token_b}"})
        second_a = await client.post(endpoint, headers={"Authorization": f"Bearer {token_a}"})

    assert first_a.status_code == 200
    assert first_b.status_code == 200
    assert second_a.status_code == 429
    assert int(second_a.headers["retry-after"]) >= 1
    get_settings.cache_clear()


@pytest.mark.anyio
async def test_authenticated_admin_interview_studio_reads_are_exempt(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("RATE_LIMIT_REQUESTS", "1")
    get_settings.cache_clear()
    app = _limited_app()

    @app.get("/api/v1/admin/interview-studio/analytics")
    async def admin_analytics() -> dict[str, str]:
        return {"status": "ok"}

    admin_token = create_token("401", "ADMIN", "access", timedelta(minutes=5))
    headers = {"Authorization": f"Bearer {admin_token}"}
    async with AsyncClient(
        transport=ASGITransport(app=app, client=("203.0.113.13", 4567)),
        base_url="http://rate-limit-test",
    ) as client:
        responses = [
            await client.get("/api/v1/admin/interview-studio/analytics", headers=headers)
            for _ in range(3)
        ]

    assert [response.status_code for response in responses] == [200, 200, 200]
    get_settings.cache_clear()


@pytest.mark.anyio
async def test_outer_cors_wraps_rate_limit_and_server_error_responses(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("RATE_LIMIT_REQUESTS", "1")
    get_settings.cache_clear()
    api = _limited_app()

    @api.get("/api/v1/failure")
    async def failure() -> dict[str, str]:
        raise RuntimeError("expected test failure")

    @api.get("/api/v1/unauthorized")
    async def unauthorized() -> dict[str, str]:
        raise HTTPException(status_code=401, detail="unauthorized")

    app = ApplicationCORSMiddleware(
        app=api,
        allow_origins=["http://localhost:5173"],
        allow_methods=["*"],
        allow_headers=["*"],
    )
    async with AsyncClient(
        transport=ASGITransport(app=app, client=("203.0.113.14", 4567), raise_app_exceptions=False),
        base_url="http://rate-limit-test",
    ) as client:
        await client.get("/api/v1/items", headers={"Origin": "http://localhost:5173"})
        rate_limited = await client.get("/api/v1/items", headers={"Origin": "http://localhost:5173"})
        server_error = await client.get(
            "/api/v1/failure",
            headers={
                "Origin": "http://localhost:5173",
                "Authorization": f"Bearer {create_token('501', 'STUDENT', 'access', timedelta(minutes=5))}",
            },
        )
        unauthorized = await client.get(
            "/api/v1/unauthorized",
            headers={
                "Origin": "http://localhost:5173",
                "Authorization": f"Bearer {create_token('502', 'STUDENT', 'access', timedelta(minutes=5))}",
            },
        )

    assert rate_limited.status_code == 429
    assert rate_limited.headers["access-control-allow-origin"] == "http://localhost:5173"
    assert unauthorized.status_code == 401
    assert unauthorized.headers["access-control-allow-origin"] == "http://localhost:5173"
    assert server_error.status_code == 500
    assert server_error.headers["access-control-allow-origin"] == "http://localhost:5173"
    get_settings.cache_clear()
