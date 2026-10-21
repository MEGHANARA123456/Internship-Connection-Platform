import os
from pathlib import Path
import subprocess
import sys

import pytest
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy.engine import make_url

from app.core.config import get_settings


BACKEND_DIR = Path(__file__).resolve().parents[1] / "backend"


def test_alembic_revisions_fit_version_column_and_have_one_head() -> None:
    config = Config(str(BACKEND_DIR / "alembic.ini"))
    script = ScriptDirectory.from_config(config)
    revisions = list(script.walk_revisions())

    assert revisions
    assert all(len(revision.revision) <= 32 for revision in revisions)
    assert len(script.get_heads()) == 1


def test_postgresql_schema_matches_models() -> None:
    database_url = get_settings().database_url
    if make_url(database_url).get_backend_name() != "postgresql":
        pytest.skip("PostgreSQL schema comparison runs against the CI PostgreSQL service.")

    environment = os.environ.copy()
    environment["DATABASE_URL"] = database_url
    environment["PYTHONPATH"] = "."
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "check"],
        cwd=BACKEND_DIR,
        env=environment,
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, f"alembic check failed:\n{result.stdout}\n{result.stderr}"
