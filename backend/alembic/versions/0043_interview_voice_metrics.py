"""add voice answer metadata and current question position

Revision ID: 0043_interview_voice_metrics
Revises: 0042_ai_interview_studio
"""

from alembic import op
import sqlalchemy as sa


revision = "0043_interview_voice_metrics"
down_revision = "0042_ai_interview_studio"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "interview_sessions",
        sa.Column("current_question_position", sa.Integer(), nullable=True),
    )
    op.add_column(
        "interview_answers",
        sa.Column("duration_seconds", sa.Float(), nullable=True),
    )
    op.add_column(
        "interview_answers",
        sa.Column("word_count", sa.Integer(), nullable=True),
    )
    op.add_column(
        "interview_answers",
        sa.Column("speaking_pace_wpm", sa.Float(), nullable=True),
    )
    op.add_column(
        "interview_answers",
        sa.Column("filler_word_count", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("interview_answers", "filler_word_count")
    op.drop_column("interview_answers", "speaking_pace_wpm")
    op.drop_column("interview_answers", "word_count")
    op.drop_column("interview_answers", "duration_seconds")
    op.drop_column("interview_sessions", "current_question_position")
