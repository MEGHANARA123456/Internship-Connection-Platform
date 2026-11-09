"""retire interview invitations that are no longer upcoming

Revision ID: 0037_retire_interview_invites
Revises: 0036_string_audit_target_ids
"""

from alembic import op
import sqlalchemy as sa


revision = "0037_retire_interview_invites"
down_revision = "0036_string_audit_target_ids"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        sa.text(
            """
            UPDATE notifications
            SET read_at = CURRENT_TIMESTAMP
            WHERE notification_type = 'INTERVIEW_INVITE'
              AND read_at IS NULL
              AND NOT EXISTS (
                  SELECT 1
                  FROM interviews AS interview
                  JOIN applications AS application
                    ON application.id = interview.application_id
                  WHERE application.id = notifications.application_id
                    AND application.student_id = notifications.user_id
                    AND interview.status IN ('SCHEDULED', 'RESCHEDULED')
                    AND interview.scheduled_at > CURRENT_TIMESTAMP
              )
            """
        )
    )


def downgrade() -> None:
    pass
