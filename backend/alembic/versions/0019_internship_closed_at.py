"""Record when an internship is closed.

Revision ID: 0019_internship_closed_at
Revises: 0018_unique_applications
"""

from alembic import op
import sqlalchemy as sa


revision = "0019_internship_closed_at"
down_revision = "0018_unique_applications"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "internships",
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.execute(
        sa.text(
            "UPDATE internships SET closed_at = created_at "
            "WHERE status = 'CLOSED' AND closed_at IS NULL AND created_at IS NOT NULL"
        )
    )


def downgrade() -> None:
    op.drop_column("internships", "closed_at")
