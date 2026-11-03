"""support archiving skill assessment topics

Revision ID: 0031_skill_topic_archiving
Revises: 0030_skill_topic_metadata
"""

import sqlalchemy as sa
from alembic import op


revision = "0031_skill_topic_archiving"
down_revision = "0030_skill_topic_metadata"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("skill_topics") as batch:
        batch.add_column(sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True))
        batch.add_column(sa.Column("archived_by", sa.Integer(), nullable=True))
        batch.create_foreign_key(
            "fk_skill_topics_archived_by_users",
            "users",
            ["archived_by"],
            ["id"],
            ondelete="SET NULL",
        )
    op.execute(
        """
        UPDATE skill_topics
        SET active = FALSE
        WHERE
          (SELECT COUNT(*) FROM skill_questions q
           WHERE q.topic = skill_topics.slug AND q.active = TRUE AND UPPER(q.difficulty) = 'EASY') < 4
          OR (SELECT COUNT(*) FROM skill_questions q
              WHERE q.topic = skill_topics.slug AND q.active = TRUE AND UPPER(q.difficulty) = 'MEDIUM') < 4
          OR (SELECT COUNT(*) FROM skill_questions q
              WHERE q.topic = skill_topics.slug AND q.active = TRUE AND UPPER(q.difficulty) = 'HARD') < 2
        """
    )


def downgrade() -> None:
    with op.batch_alter_table("skill_topics") as batch:
        batch.drop_constraint("fk_skill_topics_archived_by_users", type_="foreignkey")
        batch.drop_column("archived_by")
        batch.drop_column("archived_at")
