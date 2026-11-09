"""store privacy-reduced chatbot questions that have no confident answer

Revision ID: 0038_chatbot_low_confidence_logs
Revises: 0037_retire_interview_invites
"""

from alembic import op
import sqlalchemy as sa


revision = "0038_chatbot_low_confidence_logs"
down_revision = "0037_retire_interview_invites"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "chatbot_low_confidence_logs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("role", sa.String(length=20), nullable=False),
        sa.Column("question", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_chatbot_low_confidence_logs_role",
        "chatbot_low_confidence_logs",
        ["role"],
    )
    op.create_index(
        "ix_chatbot_low_confidence_logs_created_at",
        "chatbot_low_confidence_logs",
        ["created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_chatbot_low_confidence_logs_created_at", table_name="chatbot_low_confidence_logs")
    op.drop_index("ix_chatbot_low_confidence_logs_role", table_name="chatbot_low_confidence_logs")
    op.drop_table("chatbot_low_confidence_logs")
