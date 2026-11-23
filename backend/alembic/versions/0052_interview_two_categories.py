"""Simplify Interview Studio to HR and Technical categories.

Revision ID: 0052_interview_two_categories
Revises: 0051_skill_topic_repair
"""

from alembic import op
import sqlalchemy as sa


revision = "0052_interview_two_categories"
down_revision = "0051_skill_topic_repair"
branch_labels = None
depends_on = None


def _map_category(value: str | None) -> str:
    if value is None:
        return "HR"
    normalized = str(value).strip().upper()
    if normalized in {"BEHAVIORAL"}:
        return "HR"
    if normalized in {"DATA_SCIENCE", "DATA_ANALYST"}:
        return "TECHNICAL"
    if normalized in {"HR", "TECHNICAL"}:
        return normalized
    return "HR"


def upgrade() -> None:
    bind = op.get_bind()

    for table in (
        "interview_sessions",
        "interview_question_bank",
        "mock_tests",
        "mock_test_categories",
        "interview_studio_difficulties",
        "interview_studio_settings",
    ):
        with op.batch_alter_table(table) as batch:
            batch.add_column(sa.Column("legacy_category", sa.String(length=50), nullable=True))
        with op.batch_alter_table(table) as batch:
            batch.add_column(sa.Column("legacy_difficulty", sa.String(length=50), nullable=True))

    with op.batch_alter_table("interview_sessions") as batch:
        batch.drop_constraint("ck_interview_sessions_category", type_="check")
        batch.drop_constraint("ck_interview_sessions_difficulty", type_="check")
    bind.execute(sa.text(
        "UPDATE interview_sessions SET legacy_category = category, legacy_difficulty = difficulty"
    ))
    bind.execute(sa.text(
        "UPDATE interview_sessions SET "
        "category = CASE WHEN upper(category) IN ('BEHAVIORAL') THEN 'HR' "
        "WHEN upper(category) IN ('DATA_SCIENCE', 'DATA_ANALYST') THEN 'TECHNICAL' "
        "WHEN upper(category) IN ('HR', 'TECHNICAL') THEN upper(category) ELSE 'HR' END, "
        "difficulty = 'INTERMEDIATE'"
    ))
    with op.batch_alter_table("interview_sessions") as batch:
        batch.create_check_constraint(
            "ck_interview_sessions_category",
            "category IN ('HR', 'TECHNICAL')",
        )
        batch.create_check_constraint(
            "ck_interview_sessions_difficulty",
            "difficulty IN ('INTERMEDIATE')",
        )

    with op.batch_alter_table("interview_question_bank") as batch:
        batch.drop_constraint("ck_interview_question_bank_category", type_="check")
        batch.drop_constraint("ck_interview_question_bank_difficulty", type_="check")
    bind.execute(sa.text(
        "UPDATE interview_question_bank SET legacy_category = category, legacy_difficulty = difficulty"
    ))
    bind.execute(sa.text(
        "UPDATE interview_question_bank SET "
        "category = CASE WHEN upper(category) IN ('BEHAVIORAL') THEN 'HR' "
        "WHEN upper(category) IN ('DATA_SCIENCE', 'DATA_ANALYST') THEN 'TECHNICAL' "
        "WHEN upper(category) IN ('HR', 'TECHNICAL') THEN upper(category) ELSE 'HR' END, "
        "difficulty = 'INTERMEDIATE'"
    ))
    with op.batch_alter_table("interview_question_bank") as batch:
        batch.create_check_constraint(
            "ck_interview_question_bank_category",
            "category IN ('HR', 'TECHNICAL')",
        )
        batch.create_check_constraint(
            "ck_interview_question_bank_difficulty",
            "difficulty IN ('INTERMEDIATE')",
        )

    with op.batch_alter_table("mock_tests") as batch:
        batch.drop_constraint("ck_mock_tests_difficulty", type_="check")
    bind.execute(sa.text(
        "UPDATE mock_tests SET legacy_difficulty = difficulty"
    ))
    bind.execute(sa.text("UPDATE mock_tests SET difficulty = 'INTERMEDIATE'"))
    with op.batch_alter_table("mock_tests") as batch:
        batch.create_check_constraint(
            "ck_mock_tests_difficulty",
            "difficulty IN ('INTERMEDIATE')",
        )

    bind.execute(sa.text(
        "UPDATE mock_tests SET legacy_category = "
        "(SELECT slug FROM mock_test_categories c WHERE c.id = mock_tests.category_id)"
    ))
    bind.execute(sa.text(
        "UPDATE mock_test_categories SET legacy_category = slug "
        "WHERE legacy_category IS NULL"
    ))
    categories = sa.table(
        "mock_test_categories",
        sa.column("id", sa.Integer()),
        sa.column("slug", sa.String()),
        sa.column("title", sa.String()),
        sa.column("active", sa.Boolean()),
        sa.column("legacy_category", sa.String()),
    )
    targets: dict[str, int] = {}
    for mapped in ("HR", "TECHNICAL"):
        target_id = bind.execute(
            sa.select(categories.c.id).where(categories.c.slug == mapped)
        ).scalar()
        if target_id is None:
            target_id = bind.execute(
                categories.insert().values(
                    slug=mapped,
                    title="HR" if mapped == "HR" else "Technical",
                    active=True,
                    legacy_category=mapped,
                ).returning(categories.c.id)
            ).scalar()
        targets[mapped] = int(target_id)

    for row in bind.execute(sa.select(categories)).mappings():
        old_slug = str(row["slug"])
        mapped = _map_category(old_slug)
        target_id = targets[mapped]
        bind.execute(
            sa.text("UPDATE mock_tests SET category_id = :target WHERE category_id = :old")
            .bindparams(target=target_id, old=row["id"])
        )
        if int(row["id"]) != target_id:
            bind.execute(categories.delete().where(categories.c.id == row["id"]))

    bind.execute(sa.text(
        "UPDATE interview_studio_difficulties SET legacy_difficulty = code"
    ))
    bind.execute(sa.text("DELETE FROM interview_studio_difficulties"))
    bind.execute(sa.text(
        "INSERT INTO interview_studio_difficulties "
        "(code, label, active, legacy_difficulty) "
        "VALUES ('INTERMEDIATE', 'Intermediate', true, 'INTERMEDIATE')"
    ))

    bind.execute(sa.text(
        "UPDATE interview_studio_settings SET "
        "legacy_category = NULL, legacy_difficulty = NULL"
    ))


def downgrade() -> None:
    for table in (
        "interview_sessions",
        "interview_question_bank",
        "mock_tests",
        "mock_test_categories",
        "interview_studio_difficulties",
        "interview_studio_settings",
    ):
        with op.batch_alter_table(table) as batch:
            batch.drop_column("legacy_category")
            batch.drop_column("legacy_difficulty")
