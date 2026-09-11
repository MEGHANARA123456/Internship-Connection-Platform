"""add user-scoped email message records

Revision ID: 0003_email_messages
Revises: 0002_email_verification_states
"""
from alembic import op
import sqlalchemy as sa


revision = "0003_email_messages"
down_revision = "0002_email_verification_states"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "email_messages",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("recipient_email", sa.String(255), nullable=False),
        sa.Column("sender_email", sa.String(255), nullable=False),
        sa.Column("subject", sa.String(255), nullable=False),
        sa.Column("message_type", sa.String(50), nullable=False, server_default="GENERAL"),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("html", sa.Text()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_email_messages_user_id", "email_messages", ["user_id"])
    op.create_index("ix_email_messages_recipient_email", "email_messages", ["recipient_email"])
    op.create_index("ix_email_messages_created_at", "email_messages", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_email_messages_created_at", table_name="email_messages")
    op.drop_index("ix_email_messages_recipient_email", table_name="email_messages")
    op.drop_index("ix_email_messages_user_id", table_name="email_messages")
    op.drop_table("email_messages")