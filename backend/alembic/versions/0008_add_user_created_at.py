"""add created_at to users

Revision ID: 0008_add_user_created_at
Revises: 0007_add_totp_mfa
"""

from alembic import op
import sqlalchemy as sa


revision = "0008_add_user_created_at"
down_revision = "0007_add_totp_mfa"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("created_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_users_created_at", "users", ["created_at"])
    op.execute(sa.text(
        "UPDATE users SET created_at = COALESCE(email_verified_at, CURRENT_TIMESTAMP)"
    ))
    with op.batch_alter_table("users") as batch_op:
        batch_op.alter_column(
            "created_at",
            existing_type=sa.DateTime(timezone=True),
            nullable=False,
        )


def downgrade() -> None:
    op.drop_index("ix_users_created_at", table_name="users")
    op.drop_column("users", "created_at")