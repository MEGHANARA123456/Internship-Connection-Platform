"""add role-specific verification states and expiring email tokens

Revision ID: 0002_email_verification_states
Revises: 0001_auth_tables
"""
from alembic import op
import sqlalchemy as sa


revision = "0002_email_verification_states"
down_revision = "0001_auth_tables"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("email_verified_at", sa.DateTime(timezone=True)))
    op.add_column("users", sa.Column("student_verified", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("users", sa.Column("institution_verified", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("users", sa.Column("organization_verified", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("users", sa.Column("admin_approved", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("users", sa.Column("verification_token_expires_at", sa.DateTime(timezone=True)))
    op.add_column("student_profiles", sa.Column("institution_email", sa.String(255)))
    op.create_table(
        "email_verification_tokens",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("token_digest", sa.String(64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("token_digest"),
    )
    op.create_index("ix_email_verification_tokens_user_id", "email_verification_tokens", ["user_id"])
    op.create_index("ix_email_verification_tokens_token_digest", "email_verification_tokens", ["token_digest"])


def downgrade() -> None:
    op.drop_index("ix_email_verification_tokens_token_digest", table_name="email_verification_tokens")
    op.drop_index("ix_email_verification_tokens_user_id", table_name="email_verification_tokens")
    op.drop_table("email_verification_tokens")
    op.drop_column("student_profiles", "institution_email")
    op.drop_column("users", "verification_token_expires_at")
    op.drop_column("users", "admin_approved")
    op.drop_column("users", "organization_verified")
    op.drop_column("users", "institution_verified")
    op.drop_column("users", "student_verified")
    op.drop_column("users", "email_verified_at")