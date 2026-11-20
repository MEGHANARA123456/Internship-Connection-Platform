"""add versioned reusable mock test library

Revision ID: 0045_mock_test_library
Revises: 0044_interview_video_recordings
"""

from alembic import op
import sqlalchemy as sa


revision = "0045_mock_test_library"
down_revision = "0044_interview_video_recordings"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "mock_test_categories",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("slug", sa.String(length=50), nullable=False, unique=True),
        sa.Column("title", sa.String(length=100), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.create_table(
        "mock_tests",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("slug", sa.String(length=100), nullable=False),
        sa.Column("title", sa.String(length=160), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column(
            "category_id",
            sa.Integer(),
            sa.ForeignKey("mock_test_categories.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("difficulty", sa.String(length=20), nullable=False),
        sa.Column("format", sa.String(length=30), nullable=False),
        sa.Column("default_mode", sa.String(length=20), nullable=False),
        sa.Column("question_count", sa.Integer(), nullable=False),
        sa.Column("time_limit_seconds", sa.Integer(), nullable=False),
        sa.Column("question_filter", sa.JSON(), nullable=True),
        sa.Column("skill_tags", sa.JSON(), nullable=False),
        sa.Column("company_style", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("source_metadata", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("slug", name="uq_mock_tests_slug"),
        sa.CheckConstraint(
            "difficulty IN ('BEGINNER', 'INTERMEDIATE', 'ADVANCED')",
            name="ck_mock_tests_difficulty",
        ),
        sa.CheckConstraint(
            "format IN ('QUICK_PRACTICE', 'STANDARD', 'FULL', 'TOPIC_WISE')",
            name="ck_mock_tests_format",
        ),
        sa.CheckConstraint("default_mode IN ('PRACTICE', 'ASSESSMENT')", name="ck_mock_tests_default_mode"),
        sa.CheckConstraint("question_count IN (5, 10, 15, 20)", name="ck_mock_tests_question_count"),
        sa.CheckConstraint("version > 0", name="ck_mock_tests_version"),
    )
    op.create_index(
        "ix_mock_tests_active_category",
        "mock_tests",
        ["active", "category_id", "difficulty"],
    )
    op.create_table(
        "mock_test_questions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "mock_test_id",
            sa.Integer(),
            sa.ForeignKey("mock_tests.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column(
            "question_bank_id",
            sa.Integer(),
            sa.ForeignKey("interview_question_bank.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("skill_tags", sa.JSON(), nullable=False),
        sa.UniqueConstraint(
            "mock_test_id", "version", "position",
            name="uq_mock_test_questions_version_position",
        ),
        sa.UniqueConstraint(
            "mock_test_id", "version", "question_bank_id",
            name="uq_mock_test_questions_version_bank_question",
        ),
        sa.CheckConstraint("position > 0", name="ck_mock_test_questions_position"),
        sa.CheckConstraint("version > 0", name="ck_mock_test_questions_version"),
    )
    op.create_index(
        "ix_mock_test_questions_test_version",
        "mock_test_questions",
        ["mock_test_id", "version"],
    )
    op.add_column(
        "interview_sessions",
        sa.Column("mock_test_id", sa.Integer(), nullable=True),
    )
    op.add_column(
        "interview_sessions",
        sa.Column("mock_test_version", sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        "fk_interview_sessions_mock_test_id_mock_tests",
        "interview_sessions",
        "mock_tests",
        ["mock_test_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_interview_sessions_mock_test_id",
        "interview_sessions",
        ["mock_test_id"],
    )
    op.add_column(
        "interview_questions",
        sa.Column("skill_tags", sa.JSON(), nullable=False, server_default="[]"),
    )
    op.add_column(
        "interview_reports",
        sa.Column("skill_breakdown", sa.JSON(), nullable=True),
    )

    op.drop_constraint(
        "ck_interview_sessions_question_count", "interview_sessions", type_="check"
    )
    op.create_check_constraint(
        "ck_interview_sessions_question_count",
        "interview_sessions",
        "question_count IN (5, 10, 15, 20)",
    )
    op.execute(
        "ALTER TABLE interview_sessions "
        "DROP CONSTRAINT IF EXISTS ck_interview_sessions_ten_questions_mixed_only"
    )
    op.create_check_constraint(
        "ck_interview_sessions_ten_questions_mixed_only",
        "interview_sessions",
        "question_count = 5 OR category = 'MIXED' OR mock_test_id IS NOT NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_interview_sessions_ten_questions_mixed_only",
        "interview_sessions",
        type_="check",
    )
    op.create_check_constraint(
        "ck_interview_sessions_ten_questions_mixed_only",
        "interview_sessions",
        "question_count = 5 OR category = 'MIXED'",
    )
    op.drop_constraint(
        "ck_interview_sessions_question_count", "interview_sessions", type_="check"
    )
    op.create_check_constraint(
        "ck_interview_sessions_question_count",
        "interview_sessions",
        "question_count IN (5, 10)",
    )
    op.drop_column("interview_reports", "skill_breakdown")
    op.drop_column("interview_questions", "skill_tags")
    op.drop_index("ix_interview_sessions_mock_test_id", table_name="interview_sessions")
    op.drop_constraint(
        "fk_interview_sessions_mock_test_id_mock_tests",
        "interview_sessions",
        type_="foreignkey",
    )
    op.drop_column("interview_sessions", "mock_test_version")
    op.drop_column("interview_sessions", "mock_test_id")
    op.drop_index("ix_mock_test_questions_test_version", table_name="mock_test_questions")
    op.drop_table("mock_test_questions")
    op.drop_index("ix_mock_tests_active_category", table_name="mock_tests")
    op.drop_table("mock_tests")
    op.drop_table("mock_test_categories")
