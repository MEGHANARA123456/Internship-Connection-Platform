"""store chatbot feedback without message content

Revision ID: 0040_chatbot_feedback
Revises: 0039_rename_chatbot_word_count
"""

from alembic import op
import sqlalchemy as sa


revision = "0040_chatbot_feedback"
down_revision = "0039_rename_chatbot_word_count"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "chatbot_feedback",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("role", sa.String(length=20), nullable=False),
        sa.Column("rating", sa.String(length=10), nullable=False),
        sa.Column("source_type", sa.String(length=30), nullable=False),
        sa.Column("turn_id", sa.String(length=80), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_chatbot_feedback_user_id", "chatbot_feedback", ["user_id"])
    op.create_index("ix_chatbot_feedback_created_at", "chatbot_feedback", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_chatbot_feedback_created_at", table_name="chatbot_feedback")
    op.drop_index("ix_chatbot_feedback_user_id", table_name="chatbot_feedback")
    op.drop_table("chatbot_feedback")
