import pytest
from httpx import ASGITransport, AsyncClient
from starlette.requests import Request

from app.core.logging import JsonFormatter
from app.middleware.errors import unhandled_exception_handler
from app.main import app


@pytest.mark.anyio
async def test_security_headers_are_present() -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/api/v1/health")
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["x-frame-options"] == "SAMEORIGIN"
    assert "default-src" in response.headers["content-security-policy"]


@pytest.mark.anyio
async def test_strict_content_security_policy_skips_api_documentation() -> None:
    policy = "default-src 'none'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'"
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        api_response = await client.get("/api/v1/health")
        docs_response = await client.get("/docs")

    assert api_response.headers["content-security-policy"] == policy
    assert docs_response.headers.get("content-security-policy") != policy


@pytest.mark.anyio
async def test_rate_limit_returns_429(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("RATE_LIMIT_REQUESTS", "1")
    from app.core.config import get_settings
    get_settings.cache_clear()
    transport = ASGITransport(app=app, client=("198.51.100.250", 1234))
    async with AsyncClient(transport=transport, base_url="http://rate-test") as client:
        await client.get("/docs")
        response = await client.get("/docs")
    assert response.status_code == 429
    assert response.headers["retry-after"]
    get_settings.cache_clear()


@pytest.mark.anyio
async def test_unhandled_errors_are_sanitized() -> None:
    request = Request({"type": "http", "method": "GET", "path": "/test", "headers": [], "query_string": b""})
    response = await unhandled_exception_handler(request, RuntimeError("private database details"))
    assert response.status_code == 500
    assert b"private database details" not in response.body
    assert b"traceback" not in response.body.lower()


@pytest.mark.anyio
async def test_unhandled_errors_keep_cors_for_allowed_frontend_origin() -> None:
    request = Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/api/v1/auth/login",
            "headers": [(b"origin", b"http://localhost:5174")],
            "query_string": b"",
        }
    )
    response = await unhandled_exception_handler(request, RuntimeError("private SQL details"))

    assert response.status_code == 500
    assert response.headers["access-control-allow-origin"] == "http://localhost:5174"
    assert response.headers["access-control-allow-credentials"] == "true"
    assert b"private SQL details" not in response.body


def test_structured_log_formatter_returns_json() -> None:
    import json
    import logging
    payload = json.loads(JsonFormatter().format(logging.LogRecord("test", logging.INFO, "", 0, "hello", (), None)))
    assert payload["level"] == "INFO"
    assert payload["message"] == "hello"