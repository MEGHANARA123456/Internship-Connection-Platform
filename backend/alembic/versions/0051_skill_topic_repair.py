"""create metadata rows for question-only skill topics

Revision ID: 0051_skill_topic_repair
Revises: 0050_interview_ai_question_snapshots
"""

import sqlalchemy as sa

from alembic import op

revision = "0051_skill_topic_repair"
down_revision = "0050_interview_ai_question_snapshots"
branch_labels = None
depends_on = None


TOPIC_NAMES = {
    "mongodb": "MongoDB",
    "powerbi": "Power BI",
}


def upgrade() -> None:
    bind = op.get_bind()
    questions = sa.table(
        "skill_questions",
        sa.column("topic", sa.String(100)),
    )
    topics = sa.table(
        "skill_topics",
        sa.column("slug", sa.String(100)),
        sa.column("name", sa.String(150)),
        sa.column("description", sa.Text()),
        sa.column("icon", sa.String(80)),
        sa.column("badge_title", sa.String(255)),
        sa.column("active", sa.Boolean()),
    )
    slugs = {
        slug
        for slug in bind.execute(
            sa.select(sa.func.lower(sa.func.trim(questions.c.topic))).distinct()
        ).scalars()
        if slug
    }
    existing = set(bind.execute(sa.select(topics.c.slug)).scalars())
    for slug in sorted(slugs - existing):
        name = TOPIC_NAMES.get(slug, slug.replace("-", " ").replace("_", " ").title())
        bind.execute(
            topics.insert().values(
                slug=slug,
                name=name,
                description="Show what you know and build a verified skill.",
                icon="✦",
                badge_title=f"Verified {name} Specialist",
                active=True,
            )
        )


def downgrade() -> None:
    pass
