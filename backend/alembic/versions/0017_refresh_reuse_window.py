"""persist short-lived refresh rotation responses

Revision ID: 0017_refresh_reuse
Revises: 0016_reconcile_schema
"""

from alembic import op
import sqlalchemy as sa


revision = "0017_refresh_reuse"
down_revision = "0016_reconcile_schema"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("refresh_tokens", sa.Column("rotated_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("refresh_tokens", sa.Column("reuse_until", sa.DateTime(timezone=True), nullable=True))
    op.add_column("refresh_tokens", sa.Column("replacement_tokens", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("refresh_tokens", "replacement_tokens")
    op.drop_column("refresh_tokens", "reuse_until")
    op.drop_column("refresh_tokens", "rotated_at")
