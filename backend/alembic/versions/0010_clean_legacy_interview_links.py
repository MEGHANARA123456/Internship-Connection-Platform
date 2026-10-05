"""clear legacy non-url interview links

Revision ID: 0010_clean_interview_links
Revises: 0009_offer_acceptance
"""

from alembic import op


revision = "0010_clean_interview_links"
down_revision = "0009_offer_acceptance"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "UPDATE interviews SET meeting_link = NULL "
        "WHERE meeting_link IS NOT NULL AND meeting_link NOT LIKE 'http%'"
    )


def downgrade() -> None:
    pass