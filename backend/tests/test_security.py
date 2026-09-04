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
    assert response.headers["x-frame-options"] == "DENY"
    assert "default-src" in response.headers["content-security-policy"]


@pytest.mark.anyio
async def test_rate_limit_returns_429(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("RATE_LIMIT_REQUESTS", "1")
    from app.core.config import get_settings
    get_settings.cache_clear()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://rate-test") as client:
        await client.get("/api/v1/health")
        response = await client.get("/api/v1/health")
    assert response.status_code == 429
    get_settings.cache_clear()


@pytest.mark.anyio
async def test_unhandled_errors_are_sanitized() -> None:
    request = Request({"type": "http", "method": "GET", "path": "/test", "headers": [], "query_string": b""})
    response = await unhandled_exception_handler(request, RuntimeError("private database details"))
    assert response.status_code == 500
    assert b"private database details" not in response.body
    assert b"traceback" not in response.body.lower()


def test_structured_log_formatter_returns_json() -> None:
    import json
    import logging
    payload = json.loads(JsonFormatter().format(logging.LogRecord("test", logging.INFO, "", 0, "hello", (), None)))
    assert payload["level"] == "INFO"
    assert payload["message"] == "hello"