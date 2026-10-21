"""Track automatic and manual interview cancellation details."""

from alembic import op
import sqlalchemy as sa


revision = "0022_interview_auto_cancel"
down_revision = "0021_company_contacts_interviews"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("interviews", sa.Column("cancel_reason", sa.String(length=100), nullable=True))
    op.add_column("interviews", sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("interviews", "cancelled_at")
    op.drop_column("interviews", "cancel_reason")
