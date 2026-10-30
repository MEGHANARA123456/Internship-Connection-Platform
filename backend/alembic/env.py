"""Compatibility entrypoint required by Alembic's script directory."""

from pathlib import Path
import runpy


runpy.run_path(str(Path(__file__).with_name("migration_config.py")))
