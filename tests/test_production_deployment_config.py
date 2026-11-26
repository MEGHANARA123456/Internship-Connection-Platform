import asyncio
import logging

import pytest
from app.core.config import Settings, validate_production_settings
from app.main import _run_startup_step, health_check
from fastapi import HTTPException
from sqlalchemy.exc import OperationalError


def test_postgres_sslmode_url_is_normalized_for_asyncpg() -> None:
    settings = Settings(
        database_url="postgresql://db.example:5432/internsphere?sslmode=require"
    )

    assert settings.sqlalchemy_database_url == (
        "postgresql+asyncpg://db.example:5432/internsphere?ssl=require"
    )


def test_production_requires_secret_and_explicit_https_cors() -> None:
    with pytest.raises(RuntimeError, match="SECRET_KEY"):
        validate_production_settings(
            Settings(
                environment="production",
                secret_key="",
                frontend_url="https://internsphere.example",
                cors_allowed_origins="https://internsphere.example",
            )
        )

    with pytest.raises(RuntimeError, match="wildcard"):
        validate_production_settings(
            Settings(
                environment="production",
                secret_key="x" * 40,
                frontend_url="https://internsphere.example",
                cors_allowed_origins="https://*.internsphere.example",
            )
        )


def test_production_s3_backend_requires_credentials() -> None:
    with pytest.raises(RuntimeError, match="S3_BUCKET"):
        validate_production_settings(
            Settings(
                environment="production",
                secret_key="x" * 40,
                frontend_url="https://internsphere.example",
                cors_allowed_origins="https://internsphere.example",
                storage_backend="s3",
                s3_bucket="REPLACE_WITH_BUCKET",
                s3_access_key_id="REPLACE_WITH_ACCESS_KEY",
                s3_secret_access_key="REPLACE_WITH_SECRET",
            )
        )


@pytest.mark.anyio
async def test_health_endpoint_checks_database(monkeypatch: pytest.MonkeyPatch) -> None:
    class Connection:
        async def execute(self, _statement):
            return 1

    class Engine:
        def connect(self):
            class Context:
                async def __aenter__(self):
                    return Connection()

                async def __aexit__(self, *_args):
                    return None

            return Context()

    monkeypatch.setattr("app.core.database.engine", Engine())

    assert await health_check() == {"status": "ok"}


@pytest.mark.anyio
async def test_health_endpoint_returns_503_when_database_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class Engine:
        def connect(self):
            class Context:
                async def __aenter__(self):
                    raise OperationalError("SELECT 1", {}, RuntimeError("unavailable"))

                async def __aexit__(self, *_args):
                    return None

            return Context()

    monkeypatch.setattr("app.core.database.engine", Engine())

    with pytest.raises(HTTPException) as error:
        await health_check()
    assert error.value.status_code == 503


@pytest.mark.anyio
async def test_optional_startup_step_times_out_and_continues(
    caplog: pytest.LogCaptureFixture,
) -> None:
    async def slow_operation() -> None:
        await asyncio.sleep(0.05)

    with caplog.at_level(logging.WARNING):
        result = await _run_startup_step(
            "optional storage",
            slow_operation,
            timeout_seconds=0.001,
        )

    assert result is None
    assert "Startup step timed out; continuing." in caplog.text
