"""repair application uniqueness and merge duplicate application references

Revision ID: 0023_repair_application_uniqueness
Revises: 0022_interview_auto_cancel
"""

import logging

from alembic import op
import sqlalchemy as sa


revision = "0023_app_unique_repair"
down_revision = "0022_interview_auto_cancel"
branch_labels = None
depends_on = None

logger = logging.getLogger("alembic.runtime.migration")
CONSTRAINT_NAME = "uq_application_student_internship_repaired_0023"
APPLICATION_COLUMNS = {"student_id", "internship_id"}


def _has_application_uniqueness(bind: sa.Connection) -> bool:
    inspector = sa.inspect(bind)
    if any(
        set(constraint.get("column_names") or []) == APPLICATION_COLUMNS
        for constraint in inspector.get_unique_constraints("applications")
    ):
        return True
    return any(
        index.get("unique")
        and set(index.get("column_names") or []) == APPLICATION_COLUMNS
        for index in inspector.get_indexes("applications")
    )


def _merge_duplicate_applications(bind: sa.Connection) -> int:
    inspector = sa.inspect(bind)
    application_references = [
        (table_name, column_name)
        for table_name in inspector.get_table_names()
        for foreign_key in inspector.get_foreign_keys(table_name)
        if foreign_key.get("referred_table") == "applications"
        for column_name in foreign_key.get("constrained_columns") or []
        if column_name == "application_id"
    ]
    rows = bind.execute(sa.text(
        "SELECT id, student_id, internship_id FROM applications "
        "ORDER BY student_id, internship_id, created_at, id"
    )).mappings().all()
    kept_by_pair: dict[tuple[int, int], int] = {}
    removed = 0
    for row in rows:
        pair = (row["student_id"], row["internship_id"])
        kept_id = kept_by_pair.get(pair)
        if kept_id is None:
            kept_by_pair[pair] = row["id"]
            continue
        for table_name, column_name in application_references:
            bind.execute(
                sa.text(
                    f'UPDATE "{table_name}" SET "{column_name}" = :kept_id '
                    f'WHERE "{column_name}" = :duplicate_id'
                ),
                {"kept_id": kept_id, "duplicate_id": row["id"]},
            )
        bind.execute(
            sa.text("DELETE FROM applications WHERE id = :duplicate_id"),
            {"duplicate_id": row["id"]},
        )
        removed += 1
    logger.info("Removed %s duplicate application rows and moved their references", removed)
    return removed


def upgrade() -> None:
    bind = op.get_bind()
    _merge_duplicate_applications(bind)
    if not _has_application_uniqueness(bind):
        with op.batch_alter_table("applications") as batch_op:
            batch_op.create_unique_constraint(
                CONSTRAINT_NAME,
                ["student_id", "internship_id"],
            )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    constraint_exists = any(
        constraint.get("name") == CONSTRAINT_NAME
        and set(constraint.get("column_names") or []) == APPLICATION_COLUMNS
        for constraint in inspector.get_unique_constraints("applications")
    )
    index_exists = any(
        index.get("name") == CONSTRAINT_NAME
        and index.get("unique")
        and set(index.get("column_names") or []) == APPLICATION_COLUMNS
        for index in inspector.get_indexes("applications")
    )
    if constraint_exists:
        with op.batch_alter_table("applications") as batch_op:
            batch_op.drop_constraint(CONSTRAINT_NAME, type_="unique")
    elif index_exists:
        op.drop_index(CONSTRAINT_NAME, table_name="applications")
