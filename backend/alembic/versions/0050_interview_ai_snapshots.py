"""support AI-generated interview question snapshots

Revision ID: 0050_interview_ai_snapshots
Revises: 0049_interview_proctoring
"""

from alembic import op
import sqlalchemy as sa


revision = "0050_interview_ai_snapshots"
down_revision = "0049_interview_proctoring"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "interview_questions",
        sa.Column(
            "source_metadata",
            sa.JSON(),
            nullable=False,
            server_default="{}",
        ),
    )
    op.drop_constraint(
        "ck_interview_sessions_ten_questions_mixed_only",
        "interview_sessions",
        type_="check",
    )
    op.create_check_constraint(
        "ck_interview_sessions_ten_questions_mixed_only",
        "interview_sessions",
        "question_count IN (5, 10) OR mock_test_id IS NOT NULL",
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
        "question_count = 5 OR category = 'MIXED' OR mock_test_id IS NOT NULL",
    )
    op.drop_column("interview_questions", "source_metadata")
