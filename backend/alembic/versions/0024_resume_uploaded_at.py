"""add resume upload timestamps

Revision ID: 0024_resume_uploaded_at
Revises: 0023_app_unique_repair
"""

from alembic import op
import sqlalchemy as sa


revision = "0024_resume_uploaded_at"
down_revision = "0023_app_unique_repair"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "resumes",
        sa.Column("uploaded_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("resumes", "uploaded_at")
