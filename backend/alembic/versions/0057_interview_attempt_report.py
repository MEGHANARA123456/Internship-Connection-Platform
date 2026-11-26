"""Persist per-answer score and AI-generated attempt summaries."""

from alembic import op
import sqlalchemy as sa


revision = "0057_interview_attempt_report"
down_revision = "0056_profile_asset_storage"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("interview_evaluations") as batch:
        batch.add_column(sa.Column("score", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("suggested_answer", sa.Text(), nullable=True))
        batch.create_check_constraint(
            "ck_interview_evaluations_score",
            "score IS NULL OR score BETWEEN 0 AND 10",
        )

    with op.batch_alter_table("interview_reports") as batch:
        batch.add_column(sa.Column("top_strengths", sa.JSON(), nullable=True))
        batch.add_column(sa.Column("top_improvements", sa.JSON(), nullable=True))
        batch.add_column(sa.Column("next_steps", sa.JSON(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("interview_reports") as batch:
        batch.drop_column("next_steps")
        batch.drop_column("top_improvements")
        batch.drop_column("top_strengths")

    with op.batch_alter_table("interview_evaluations") as batch:
        batch.drop_constraint("ck_interview_evaluations_score", type_="check")
        batch.drop_column("suggested_answer")
        batch.drop_column("score")
