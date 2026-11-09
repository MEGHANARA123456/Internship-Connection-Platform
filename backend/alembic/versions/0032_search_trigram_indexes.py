"""add trigram indexes for typo-tolerant search

Revision ID: 0032_search_trigram_indexes
Revises: 0031_skill_topic_archiving
"""

from alembic import op


revision = "0032_search_trigram_indexes"
down_revision = "0031_skill_topic_archiving"
branch_labels = None
depends_on = None


_INDEXES = (
    ("ix_internships_title_trgm", "internships", "title"),
    ("ix_internships_skills_trgm", "internships", "skills"),
    ("ix_internships_location_trgm", "internships", "location"),
    ("ix_internships_industry_trgm", "internships", "industry"),
    ("ix_company_profiles_name_trgm", "company_profiles", "company_name"),
)


def upgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    for index_name, table_name, column_name in _INDEXES:
        op.execute(
            f"CREATE INDEX IF NOT EXISTS {index_name} ON {table_name} "
            f"USING gin (lower({column_name}) gin_trgm_ops)"
        )


def downgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    for index_name, _, _ in reversed(_INDEXES):
        op.execute(f"DROP INDEX IF EXISTS {index_name}")
