"""add application event tracking and backfill

Revision ID: 0013_application_tracking
Revises: 0012_align_model_indexes
"""

from alembic import op
import sqlalchemy as sa


revision = "0013_application_tracking"
down_revision = "0012_align_model_indexes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "application_events",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("application_id", sa.Integer(), nullable=False),
        sa.Column("event_type", sa.String(length=30), nullable=False),
        sa.Column("actor_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["application_id"], ["applications.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["actor_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_application_events_application_id", "application_events", ["application_id"])
    op.create_index("ix_application_events_event_type", "application_events", ["event_type"])
    op.create_index("ix_application_events_actor_id", "application_events", ["actor_id"])
    op.create_index("ix_application_events_created_at", "application_events", ["created_at"])

    op.execute(
        """
        INSERT INTO application_events (application_id, event_type, actor_id, created_at)
        SELECT a.id, 'APPLIED', a.student_id, a.created_at
        FROM applications a
        WHERE NOT EXISTS (
            SELECT 1 FROM application_events ae WHERE ae.application_id = a.id AND ae.event_type = 'APPLIED'
        )
        """
    )

    op.execute(
        """
        INSERT INTO application_events (application_id, event_type, actor_id, created_at)
        SELECT a.id, a.status, a.student_id, a.updated_at
        FROM applications a
        WHERE a.status != 'APPLIED'
          AND NOT EXISTS (
              SELECT 1 FROM application_events ae WHERE ae.application_id = a.id AND ae.event_type = a.status
          )
        """
    )


def downgrade() -> None:
    op.drop_index("ix_application_events_created_at", table_name="application_events")
    op.drop_index("ix_application_events_actor_id", table_name="application_events")
    op.drop_index("ix_application_events_event_type", table_name="application_events")
    op.drop_index("ix_application_events_application_id", table_name="application_events")
    op.drop_table("application_events")
