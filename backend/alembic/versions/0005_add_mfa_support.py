"""add mfa support to users table

Revision ID: 0005_add_mfa_support
Revises: 0004_saved_and_reviews
"""
from alembic import op
import sqlalchemy as sa


revision = "0005_add_mfa_support"
down_revision = "0004_saved_and_reviews"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("mfa_enabled", sa.Boolean(), nullable=False, server_default=sa.text("false")))
    op.add_column("users", sa.Column("mfa_secret", sa.String(length=255), nullable=True))
    op.add_column("users", sa.Column("mfa_otp", sa.String(length=64), nullable=True))
    op.add_column("users", sa.Column("mfa_otp_expires_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "mfa_otp_expires_at")
    op.drop_column("users", "mfa_otp")
    op.drop_column("users", "mfa_secret")
    op.drop_column("users", "mfa_enabled")
