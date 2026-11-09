"""Track explicit verification of legacy admin-entered answer keys."""

from alembic import op
import sqlalchemy as sa


revision = "0034_skill_key_review"
down_revision = "0033_archive_inactive_topics"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "skill_questions",
        sa.Column("key_reviewed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "skill_questions",
        sa.Column(
            "key_reviewed_by",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.execute(
        sa.text(
            "UPDATE skill_questions SET key_reviewed_at = CURRENT_TIMESTAMP "
            "WHERE source IS NULL OR source <> 'Admin curated question'"
        )
    )


def downgrade() -> None:
    op.drop_column("skill_questions", "key_reviewed_by")
    op.drop_column("skill_questions", "key_reviewed_at")
