import importlib.util
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

MIGRATION_PATH = (
    Path(__file__).parents[1]
    / "backend"
    / "alembic"
    / "versions"
    / "0051_skill_topic_repair.py"
)
SPEC = importlib.util.spec_from_file_location("skill_topic_repair", MIGRATION_PATH)
assert SPEC is not None and SPEC.loader is not None
MIGRATION = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MIGRATION)


def test_skill_topic_repair_inserts_only_missing_normalized_rows_idempotently() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    questions = sa.Table(
        "skill_questions",
        metadata,
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("topic", sa.String(100), nullable=False),
    )
    topics = sa.Table(
        "skill_topics",
        metadata,
        sa.Column("slug", sa.String(100), primary_key=True),
        sa.Column("name", sa.String(150), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("icon", sa.String(80), nullable=False),
        sa.Column("badge_title", sa.String(255), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False),
    )
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(questions.insert(), [
            {"id": 1, "topic": " Mongodb "},
            {"id": 2, "topic": "mongodb"},
            {"id": 3, "topic": "PowerBI"},
            {"id": 4, "topic": "new-topic"},
        ])
        connection.execute(topics.insert(), [{
            "slug": "new-topic",
            "name": "Custom Name",
            "description": "Keep this",
            "icon": "★",
            "badge_title": "Custom Badge",
            "active": False,
        }])
        before_questions = connection.execute(
            sa.select(questions.c.id, questions.c.topic).order_by(questions.c.id)
        ).all()
        with Operations.context(MigrationContext.configure(connection)):
            MIGRATION.upgrade()
            MIGRATION.upgrade()

        rows = {
            row.slug: row
            for row in connection.execute(sa.select(topics)).all()
        }
        assert set(rows) == {"mongodb", "powerbi", "new-topic"}
        assert rows["mongodb"].name == "MongoDB"
        assert rows["powerbi"].name == "Power BI"
        assert rows["mongodb"].description == "Show what you know and build a verified skill."
        assert rows["mongodb"].icon == "✦"
        assert rows["mongodb"].badge_title == "Verified MongoDB Specialist"
        assert rows["new-topic"].name == "Custom Name"
        assert rows["new-topic"].description == "Keep this"
        assert connection.execute(
            sa.select(questions.c.id, questions.c.topic).order_by(questions.c.id)
        ).all() == before_questions

    engine.dispose()
