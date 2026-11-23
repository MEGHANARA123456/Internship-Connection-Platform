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
    / "0052_interview_two_categories.py"
)
SPEC = importlib.util.spec_from_file_location("interview_two_categories", MIGRATION_PATH)
assert SPEC is not None and SPEC.loader is not None
MIGRATION = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MIGRATION)


def _table(metadata: sa.MetaData, name: str) -> sa.Table:
    if name == "interview_sessions":
        return sa.Table(
            name,
            metadata,
            sa.Column("id", sa.Integer, primary_key=True),
            sa.Column("category", sa.String(30), nullable=False),
            sa.Column("difficulty", sa.String(20), nullable=False),
            sa.CheckConstraint(
                "category IN ('HR','TECHNICAL','DATA_SCIENCE','BEHAVIORAL','MIXED')",
                name="ck_interview_sessions_category",
            ),
            sa.CheckConstraint(
                "difficulty IN ('BEGINNER','INTERMEDIATE','ADVANCED')",
                name="ck_interview_sessions_difficulty",
            ),
        )
    if name == "interview_question_bank":
        return sa.Table(
            name,
            metadata,
            sa.Column("id", sa.Integer, primary_key=True),
            sa.Column("category", sa.String(30), nullable=False),
            sa.Column("difficulty", sa.String(20), nullable=False),
            sa.CheckConstraint(
                "category IN ('HR','TECHNICAL','DATA_SCIENCE','BEHAVIORAL')",
                name="ck_interview_question_bank_category",
            ),
            sa.CheckConstraint(
                "difficulty IN ('BEGINNER','INTERMEDIATE','ADVANCED')",
                name="ck_interview_question_bank_difficulty",
            ),
        )
    if name == "mock_tests":
        return sa.Table(
            name,
            metadata,
            sa.Column("id", sa.Integer, primary_key=True),
            sa.Column("category_id", sa.Integer, nullable=False),
            sa.Column("difficulty", sa.String(20), nullable=False),
            sa.CheckConstraint(
                "difficulty IN ('BEGINNER','INTERMEDIATE','ADVANCED')",
                name="ck_mock_tests_difficulty",
            ),
        )
    if name == "mock_test_categories":
        return sa.Table(
            name,
            metadata,
            sa.Column("id", sa.Integer, primary_key=True),
            sa.Column("slug", sa.String(50), nullable=False),
            sa.Column("title", sa.String(100), nullable=False),
            sa.Column("active", sa.Boolean, nullable=False),
        )
    if name == "interview_studio_difficulties":
        return sa.Table(
            name,
            metadata,
            sa.Column("code", sa.String(20), primary_key=True),
            sa.Column("label", sa.String(40), nullable=False),
            sa.Column("active", sa.Boolean, nullable=False),
        )
    return sa.Table(
        name,
        metadata,
        sa.Column("key", sa.String(60), primary_key=True),
    )


def test_migration_maps_categories_and_difficulties_without_deleting_attempts() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    tables = {
        name: _table(metadata, name)
        for name in (
            "interview_sessions",
            "interview_question_bank",
            "mock_tests",
            "mock_test_categories",
            "interview_studio_difficulties",
            "interview_studio_settings",
        )
    }
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(sa.text("PRAGMA ignore_check_constraints = ON"))
        connection.execute(tables["interview_sessions"].insert(), [
            {"id": 1, "category": "BEHAVIORAL", "difficulty": "ADVANCED"},
            {"id": 2, "category": "DATA_SCIENCE", "difficulty": "BEGINNER"},
            {"id": 3, "category": "MIXED", "difficulty": "INTERMEDIATE"},
        ])
        connection.execute(tables["interview_question_bank"].insert(), [
            {"id": 1, "category": "BEHAVIORAL", "difficulty": "ADVANCED"},
            {"id": 2, "category": "DATA_ANALYST", "difficulty": "BEGINNER"},
        ])
        connection.execute(tables["mock_test_categories"].insert(), [
            {"id": 1, "slug": "BEHAVIORAL", "title": "Behavioral", "active": True},
            {"id": 2, "slug": "DATA_ANALYST", "title": "Data Analyst", "active": True},
            {"id": 3, "slug": "HR", "title": "HR", "active": True},
            {"id": 4, "slug": "TECHNICAL", "title": "Technical", "active": True},
        ])
        connection.execute(tables["mock_tests"].insert(), [
            {"id": 1, "category_id": 1, "difficulty": "ADVANCED"},
            {"id": 2, "category_id": 2, "difficulty": "BEGINNER"},
        ])
        connection.execute(tables["interview_studio_difficulties"].insert(), [
            {"code": "BEGINNER", "label": "Beginner", "active": True},
            {"code": "ADVANCED", "label": "Advanced", "active": True},
        ])

        with Operations.context(MigrationContext.configure(connection)):
            MIGRATION.upgrade()

        sessions = connection.execute(sa.text(
            "SELECT id, category, difficulty, legacy_category, legacy_difficulty "
            "FROM interview_sessions ORDER BY id"
        )).mappings().all()
        assert len(sessions) == 3
        assert [row["category"] for row in sessions] == ["HR", "TECHNICAL", "HR"]
        assert [row["legacy_category"] for row in sessions] == ["BEHAVIORAL", "DATA_SCIENCE", "MIXED"]
        assert all(row["difficulty"] == "INTERMEDIATE" for row in sessions)
        assert all(row["legacy_difficulty"] in {"ADVANCED", "BEGINNER", "INTERMEDIATE"} for row in sessions)

        questions = connection.execute(sa.text(
            "SELECT id, category, difficulty FROM interview_question_bank ORDER BY id"
        )).mappings().all()
        assert [row["category"] for row in questions] == ["HR", "TECHNICAL"]
        assert all(row["difficulty"] == "INTERMEDIATE" for row in questions)

        categories = connection.execute(sa.text(
            "SELECT slug FROM mock_test_categories"
        )).scalars().all()
        assert set(categories) == {"HR", "TECHNICAL"}

        tests = connection.execute(sa.text(
            "SELECT id, difficulty, legacy_category FROM mock_tests ORDER BY id"
        )).mappings().all()
        assert all(row["difficulty"] == "INTERMEDIATE" for row in tests)
        assert [row["legacy_category"] for row in tests] == ["BEHAVIORAL", "DATA_ANALYST"]

        difficulties = connection.execute(sa.text(
            "SELECT code FROM interview_studio_difficulties"
        )).scalars().all()
        assert difficulties == ["INTERMEDIATE"]

    engine.dispose()
