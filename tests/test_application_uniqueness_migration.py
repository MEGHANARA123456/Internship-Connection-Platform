import importlib.util
from datetime import datetime
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


MIGRATION_PATH = (
    Path(__file__).parents[1]
    / "backend"
    / "alembic"
    / "versions"
    / "0023_repair_application_uniqueness.py"
)
SPEC = importlib.util.spec_from_file_location("application_uniqueness_repair", MIGRATION_PATH)
assert SPEC is not None and SPEC.loader is not None
MIGRATION = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MIGRATION)


@pytest.mark.parametrize("dialect", ["sqlite"])
def test_repair_migration_keeps_earliest_and_moves_events(
    tmp_path: Path,
    caplog: pytest.LogCaptureFixture,
    dialect: str,
) -> None:
    database = tmp_path / "application-uniqueness-repair.db"
    engine = sa.create_engine(f"{dialect}:///{database}")
    metadata = sa.MetaData()
    applications = sa.Table(
        "applications",
        metadata,
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("student_id", sa.Integer, nullable=False),
        sa.Column("internship_id", sa.Integer, nullable=False),
        sa.Column("created_at", sa.DateTime, nullable=False),
    )
    application_events = sa.Table(
        "application_events",
        metadata,
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("application_id", sa.Integer, sa.ForeignKey("applications.id"), nullable=False),
        sa.Column("event_type", sa.String(30), nullable=False),
    )
    metadata.create_all(engine)
    with engine.begin() as connection:
        connection.execute(applications.insert(), [
            {"id": 7, "student_id": 12, "internship_id": 5, "created_at": datetime(2024, 1, 1)},
            {"id": 8, "student_id": 12, "internship_id": 5, "created_at": datetime(2024, 2, 1)},
        ])
        connection.execute(application_events.insert(), [
            {"id": 20, "application_id": 8, "event_type": "UNDER_REVIEW"},
        ])
        with Operations.context(MigrationContext.configure(connection)):
            MIGRATION.upgrade()

        remaining = connection.execute(sa.select(applications.c.id)).scalars().all()
        moved_event_application_id = connection.execute(
            sa.select(application_events.c.application_id)
        ).scalar_one()
        constraints = sa.inspect(connection).get_unique_constraints("applications")
        assert remaining == [7]
        assert moved_event_application_id == 7
        assert any(
            set(constraint["column_names"] or []) == {"student_id", "internship_id"}
            for constraint in constraints
        )
        assert "Removed 1 duplicate application rows" in caplog.text

        with Operations.context(MigrationContext.configure(connection)):
            MIGRATION.downgrade()
        repaired_constraint = any(
            constraint.get("name") == MIGRATION.CONSTRAINT_NAME
            for constraint in sa.inspect(connection).get_unique_constraints("applications")
        )
        assert not repaired_constraint
    engine.dispose()
