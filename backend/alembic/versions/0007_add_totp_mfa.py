"""add TOTP MFA support

Revision ID: 0007_add_totp_mfa
Revises: 0006_add_audit_log
Create Date: 2026-09-25 00:00:00.000000

"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0007_add_totp_mfa"
down_revision = "0006_add_audit_log"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("mfa_type", sa.String(length=20), nullable=False, server_default="EMAIL"))
    op.alter_column("users", "mfa_type", server_default=None)


def downgrade() -> None:
    op.drop_column("users", "mfa_type")
