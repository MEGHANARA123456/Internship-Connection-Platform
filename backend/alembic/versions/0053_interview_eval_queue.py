"""Persist interview evaluation worker state and provider failure metadata."""

from alembic import op
import sqlalchemy as sa


revision = "0053_interview_eval_queue"
down_revision = "0052_interview_two_categories"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("interview_evaluations") as batch:
        batch.drop_constraint("ck_interview_evaluations_status", type_="check")
        batch.create_check_constraint(
            "ck_interview_evaluations_status",
            "status IN ('PENDING', 'EVALUATING', 'COMPLETED', 'FAILED')",
        )
        batch.add_column(sa.Column("provider_name", sa.String(length=40), nullable=True))
        batch.add_column(sa.Column("answer_hash", sa.String(length=64), nullable=True))
        batch.add_column(sa.Column("evaluating_at", sa.DateTime(timezone=True), nullable=True))
        batch.create_index(
            "ix_interview_evaluations_status_created",
            ["status", "created_at"],
            unique=False,
        )

    with op.batch_alter_table("interview_studio_usage_events") as batch:
        batch.add_column(sa.Column("provider_name", sa.String(length=40), nullable=True))
        batch.add_column(sa.Column("session_id", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("answer_id", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("http_status", sa.Integer(), nullable=True))
        batch.create_index(
            "ix_interview_studio_usage_event_attempt",
            ["session_id", "answer_id"],
            unique=False,
        )


def downgrade() -> None:
    with op.batch_alter_table("interview_studio_usage_events") as batch:
        batch.drop_index("ix_interview_studio_usage_event_attempt")
        batch.drop_column("http_status")
        batch.drop_column("answer_id")
        batch.drop_column("session_id")
        batch.drop_column("provider_name")

    with op.batch_alter_table("interview_evaluations") as batch:
        batch.drop_index("ix_interview_evaluations_status_created")
        batch.drop_column("evaluating_at")
        batch.drop_column("answer_hash")
        batch.drop_column("provider_name")
        batch.drop_constraint("ck_interview_evaluations_status", type_="check")
        batch.create_check_constraint(
            "ck_interview_evaluations_status",
            "status IN ('PENDING', 'COMPLETED', 'FAILED')",
        )
