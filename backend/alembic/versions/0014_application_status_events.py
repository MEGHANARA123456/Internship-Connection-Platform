"""add application timeline and SMTP email metadata

Revision ID: 0014_application_status_events
Revises: 0013_application_tracking
"""

from alembic import op
import sqlalchemy as sa


revision = "0014_application_status_events"
down_revision = "0013_application_tracking"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "application_status_events",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("application_id", sa.Integer(), nullable=False),
        sa.Column("from_status", sa.String(length=30), nullable=True),
        sa.Column("to_status", sa.String(length=30), nullable=True),
        sa.Column("changed_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("changed_by_user_id", sa.Integer(), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["application_id"], ["applications.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["changed_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_application_status_events_application_id", "application_status_events", ["application_id"])
    op.create_index("ix_application_status_events_changed_at", "application_status_events", ["changed_at"])
    op.create_index(
        "ix_application_status_events_changed_by_user_id",
        "application_status_events",
        ["changed_by_user_id"],
    )

    op.execute(
        """
        INSERT INTO application_status_events
            (application_id, from_status, to_status, changed_by_user_id, changed_at, note)
        SELECT application_id, NULL, event_type, actor_id, created_at, 'Backfilled from application event history'
        FROM application_events
        WHERE event_type IN (
            'APPLIED', 'UNDER_REVIEW', 'SHORTLISTED', 'INTERVIEW_SCHEDULED',
            'SELECTED', 'ACCEPTED', 'REJECTED', 'WITHDRAWN'
        )
        """
    )
    op.execute(
        """
        INSERT INTO application_status_events
            (application_id, from_status, to_status, changed_by_user_id, changed_at, note)
        SELECT a.id, NULL, 'APPLIED', a.student_id, a.created_at, 'Initial application'
        FROM applications a
        WHERE NOT EXISTS (
            SELECT 1 FROM application_status_events e
            WHERE e.application_id = a.id AND e.to_status = 'APPLIED'
        )
        """
    )
    op.execute(
        """
        INSERT INTO application_status_events
            (application_id, from_status, to_status, changed_by_user_id, changed_at, note)
        SELECT a.id, NULL, a.status, a.student_id, a.updated_at, 'Backfilled current application status'
        FROM applications a
        WHERE a.status != 'APPLIED'
          AND NOT EXISTS (
              SELECT 1 FROM application_status_events e
              WHERE e.application_id = a.id AND e.to_status = a.status
          )
        """
    )
    op.execute(
        """
        INSERT INTO application_status_events
            (application_id, from_status, to_status, changed_by_user_id, changed_at, note)
        SELECT i.application_id, a.status, a.status, i.scheduled_by, i.scheduled_at, 'INTERVIEW_CREATED'
        FROM interviews i
        JOIN applications a ON a.id = i.application_id
        """
    )

    with op.batch_alter_table("email_messages") as batch:
        batch.add_column(sa.Column("application_id", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("message_id", sa.String(length=998), nullable=True))
        batch.add_column(
            sa.Column("delivered_via_smtp", sa.Boolean(), nullable=False, server_default=sa.false()),
        )
        batch.create_foreign_key(
            "fk_email_messages_application_id_applications",
            "applications",
            ["application_id"],
            ["id"],
            ondelete="SET NULL",
        )
    op.create_index("ix_email_messages_application_id", "email_messages", ["application_id"])
    op.create_index("ix_email_messages_message_id", "email_messages", ["message_id"])

    with op.batch_alter_table("notifications") as batch:
        batch.add_column(sa.Column("application_id", sa.Integer(), nullable=True))
        batch.create_foreign_key(
            "fk_notifications_application_id_applications",
            "applications",
            ["application_id"],
            ["id"],
            ondelete="SET NULL",
        )
    op.create_index("ix_notifications_application_id", "notifications", ["application_id"])


def downgrade() -> None:
    op.drop_index("ix_notifications_application_id", table_name="notifications")
    with op.batch_alter_table("notifications") as batch:
        batch.drop_constraint("fk_notifications_application_id_applications", type_="foreignkey")
        batch.drop_column("application_id")

    op.drop_index("ix_email_messages_message_id", table_name="email_messages")
    op.drop_index("ix_email_messages_application_id", table_name="email_messages")
    with op.batch_alter_table("email_messages") as batch:
        batch.drop_constraint("fk_email_messages_application_id_applications", type_="foreignkey")
        batch.drop_column("delivered_via_smtp")
        batch.drop_column("message_id")
        batch.drop_column("application_id")

    op.drop_index("ix_application_status_events_changed_by_user_id", table_name="application_status_events")
    op.drop_index("ix_application_status_events_changed_at", table_name="application_status_events")
    op.drop_index("ix_application_status_events_application_id", table_name="application_status_events")
    op.drop_table("application_status_events")
