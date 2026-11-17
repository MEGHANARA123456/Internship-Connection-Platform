"""rename the chatbot chunk word count to match its stored value

Revision ID: 0039_rename_chatbot_word_count
Revises: 0038_chatbot_low_confidence_logs
"""

from alembic import op
import sqlalchemy as sa


revision = "0039_rename_chatbot_word_count"
down_revision = "0038_chatbot_low_confidence_logs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        "kb_chunks",
        "token_count",
        new_column_name="word_count",
        existing_type=sa.Integer(),
        existing_nullable=False,
    )
    op.execute(
        "ALTER TABLE kb_chunks RENAME CONSTRAINT "
        "kb_chunks_token_count_check TO kb_chunks_word_count_check"
    )


def downgrade() -> None:
    op.execute(
        "ALTER TABLE kb_chunks RENAME CONSTRAINT "
        "kb_chunks_word_count_check TO kb_chunks_token_count_check"
    )
    op.alter_column(
        "kb_chunks",
        "word_count",
        new_column_name="token_count",
        existing_type=sa.Integer(),
        existing_nullable=False,
    )
