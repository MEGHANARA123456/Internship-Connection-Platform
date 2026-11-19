"""persist student developer profile handles

Revision ID: 0041_student_developer_handles
Revises: 0040_chatbot_feedback
"""

from alembic import op
import sqlalchemy as sa


revision = "0041_student_developer_handles"
down_revision = "0040_chatbot_feedback"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "student_profiles",
        sa.Column("github_username", sa.String(length=39), nullable=True),
    )
    op.add_column(
        "student_profiles",
        sa.Column("leetcode_username", sa.String(length=50), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("student_profiles", "leetcode_username")
    op.drop_column("student_profiles", "github_username")
