"""archive topics that were previously inactive

Revision ID: 0033_archive_inactive_topics
Revises: 0032_search_trigram_indexes
"""

from datetime import datetime, timezone

import sqlalchemy as sa
from alembic import op


revision = "0033_archive_inactive_topics"
down_revision = "0032_search_trigram_indexes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    topics = sa.table(
        "skill_topics",
        sa.column("slug", sa.String(100)),
        sa.column("active", sa.Boolean()),
        sa.column("archived_at", sa.DateTime(timezone=True)),
    )
    migration_archives = sa.table(
        "_skill_topics_archived_by_0033",
        sa.column("slug", sa.String(100)),
        sa.column("archived_at", sa.DateTime(timezone=True)),
    )
    op.create_table(
        "_skill_topics_archived_by_0033",
        sa.Column("slug", sa.String(100), primary_key=True),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=False),
    )
    inactive_topics = list(bind.execute(
        sa.select(topics.c.slug).where(
            topics.c.active.is_(False),
            topics.c.archived_at.is_(None),
        )
    ).scalars())
    archived_at = datetime.now(timezone.utc)
    if inactive_topics:
        bind.execute(
            migration_archives.insert(),
            [{"slug": slug, "archived_at": archived_at} for slug in inactive_topics],
        )
        bind.execute(
            sa.text(
                "UPDATE skill_topics SET archived_at = :archived_at "
                "WHERE slug IN :slugs"
            ).bindparams(
                sa.bindparam("slugs", expanding=True),
            ),
            {"archived_at": archived_at, "slugs": inactive_topics},
        )
    print(
        "Archived inactive skill assessment topics: "
        + (", ".join(sorted(inactive_topics)) if inactive_topics else "none")
    )


def downgrade() -> None:
    bind = op.get_bind()
    migration_archives = sa.table(
        "_skill_topics_archived_by_0033",
        sa.column("slug", sa.String(100)),
        sa.column("archived_at", sa.DateTime(timezone=True)),
    )
    archived_rows = bind.execute(
        sa.select(migration_archives.c.slug, migration_archives.c.archived_at)
    ).all()
    for slug, archived_at in archived_rows:
        bind.execute(
            sa.text(
                "UPDATE skill_topics SET archived_at = NULL "
                "WHERE slug = :slug AND archived_at = :archived_at"
            ),
            {"slug": slug, "archived_at": archived_at},
        )
    op.drop_table("_skill_topics_archived_by_0033")
