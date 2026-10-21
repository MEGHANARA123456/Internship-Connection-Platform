from pathlib import Path

import pytest

from alembic import command
from alembic.config import Config
from app.main import _run_migrations, run_database_migrations


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
