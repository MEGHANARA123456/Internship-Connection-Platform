"""add offer acceptance signature fields

Revision ID: 0009_offer_acceptance
Revises: 0008_add_user_created_at
"""

from alembic import op
import sqlalchemy as sa


revision = "0009_offer_acceptance"
down_revision = "0008_add_user_created_at"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("applications", sa.Column("offer_signed_name", sa.String(length=200), nullable=True))
    op.add_column("applications", sa.Column("offer_signature_mode", sa.String(length=10), nullable=True))
    op.add_column("applications", sa.Column("offer_accepted_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("applications") as batch_op:
        batch_op.drop_column("offer_accepted_at")
        batch_op.drop_column("offer_signature_mode")
        batch_op.drop_column("offer_signed_name")