import asyncio
from collections.abc import Coroutine
from pathlib import Path

import pytest

from alembic import command
from alembic.config import Config
from app.main import _run_migrations, app, lifespan, run_database_migrations


@pytest.mark.anyio
async def test_startup_migration_failure_prevents_startup(monkeypatch: pytest.MonkeyPatch, caplog) -> None:
    def fail_upgrade(config: Config, revision: str) -> None:
        assert revision == "head"
        raise RuntimeError("missing migration revision")

    monkeypatch.setattr(command, "upgrade", fail_upgrade)

    with pytest.raises(RuntimeError, match="missing migration revision"):
        await run_database_migrations()

    assert "Database is not migrated: run alembic upgrade head" in caplog.text
    assert "missing migration revision" in caplog.text


def test_migration_config_uses_backend_relative_paths(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    captured: dict[str, object] = {}

    def capture_upgrade(config: Config, revision: str) -> None:
        captured["config_file"] = config.config_file_name
        captured["script_location"] = config.get_main_option("script_location")
        captured["revision"] = revision

    monkeypatch.setattr(command, "upgrade", capture_upgrade)
    monkeypatch.chdir(tmp_path)

    _run_migrations()

    backend_dir = Path(__file__).resolve().parents[1] / "backend"
    assert captured == {
        "config_file": str(backend_dir / "alembic.ini"),
        "script_location": str(backend_dir / "alembic"),
        "revision": "head",
    }


@pytest.mark.anyio
async def test_lifespan_cancels_background_workers_on_exit(monkeypatch: pytest.MonkeyPatch) -> None:
    created_tasks: list[asyncio.Task[object]] = []
    original_create_task = asyncio.create_task

    async def fake_migrations() -> None:
        return None

    async def fake_knowledge_ingestion(_config) -> dict[str, int]:
        return {"indexed": 0, "unchanged": 0, "files": 0}

    async def fake_worker() -> None:
        try:
            await asyncio.sleep(3600)
        except asyncio.CancelledError:
            raise

    def capture_task(
        coro: asyncio.Future[object] | Coroutine[object, object, object],
    ) -> asyncio.Task[object]:
        task = original_create_task(coro)
        created_tasks.append(task)
        return task

    monkeypatch.setattr("app.main.run_database_migrations", fake_migrations)
    monkeypatch.setattr("app.chatbot.rag.ingest.ingest_knowledge", fake_knowledge_ingestion)
    monkeypatch.setattr("app.main.is_port_in_use", lambda port: True)
    monkeypatch.setattr("app.main._interview_reminder_worker", fake_worker)
    monkeypatch.setattr("app.main._interview_expiry_worker", fake_worker)
    monkeypatch.setattr("app.main.asyncio.create_task", capture_task)

    async with lifespan(app):
        pass

    assert len(created_tasks) == 2
    assert all(task.cancelled() for task in created_tasks)
