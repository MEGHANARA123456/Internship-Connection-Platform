"""reconcile the deployed tracking and notification schema

Revision ID: 0016_reconcile_schema
Revises: 0015_endorsements
"""

from alembic import op
import sqlalchemy as sa


revision = "0016_reconcile_schema"
down_revision = "0015_endorsements"
branch_labels = None
depends_on = None

_ARCHIVE_TABLE = "application_status_events_legacy_archive"


def _inspector():
    return sa.inspect(op.get_bind())


def _columns(table_name: str) -> set[str]:
    if not _inspector().has_table(table_name):
        return set()
    return {column["name"] for column in _inspector().get_columns(table_name)}


def _indexes(table_name: str) -> set[str]:
    if not _inspector().has_table(table_name):
        return set()
    return {index["name"] for index in _inspector().get_indexes(table_name)}


def _create_status_events_table() -> None:
    op.create_table(
        "application_status_events",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("application_id", sa.Integer(), nullable=False),
        sa.Column("from_status", sa.String(length=30), nullable=True),
        sa.Column("to_status", sa.String(length=30), nullable=True),
        sa.Column(
            "changed_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("changed_by_user_id", sa.Integer(), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(
            ["application_id"], ["applications.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["changed_by_user_id"], ["users.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_application_status_events_application_id",
        "application_status_events",
        ["application_id"],
    )
    op.create_index(
        "ix_application_status_events_changed_at",
        "application_status_events",
        ["changed_at"],
    )
    op.create_index(
        "ix_application_status_events_changed_by_user_id",
        "application_status_events",
        ["changed_by_user_id"],
    )


def _copy_status_event_history() -> None:
    bind = op.get_bind()
    source = sa.Table(_ARCHIVE_TABLE, sa.MetaData(), autoload_with=bind)
    columns = set(source.c.keys())

    def source_column(name: str, default):
        return source.c[name] if name in columns else sa.literal(default)

    changed_at = sa.func.coalesce(
        source_column("changed_at", None),
        source_column("created_at", None),
        sa.func.now(),
    )
    changed_by = sa.func.coalesce(
        source_column("changed_by_user_id", None),
        source_column("actor_id", None),
    )
    to_status = sa.func.coalesce(
        source_column("to_status", None),
        source_column("event_type", None),
    )
    note = sa.func.coalesce(
        source_column("note", None),
        source_column("event_type", None),
    )
    rows = sa.select(
        source.c.id,
        source.c.application_id,
        source_column("from_status", None),
        to_status,
        changed_at,
        changed_by,
        note,
    )
    bind.execute(
        sa.insert(sa.Table(
            "application_status_events",
            sa.MetaData(),
            autoload_with=bind,
        )).from_select(
            [
                "id",
                "application_id",
                "from_status",
                "to_status",
                "changed_at",
                "changed_by_user_id",
                "note",
            ],
            rows,
        )
    )
    if bind.dialect.name == "postgresql":
        bind.execute(sa.text(
            """
            SELECT setval(
                pg_get_serial_sequence('application_status_events', 'id'),
                COALESCE((SELECT MAX(id) FROM application_status_events), 1),
                EXISTS (SELECT 1 FROM application_status_events)
            )
            """
        ))


def upgrade() -> None:
    if _inspector().has_table("application_status_events"):
        if _inspector().has_table(_ARCHIVE_TABLE):
            raise RuntimeError(f"Cannot preserve status history: {_ARCHIVE_TABLE} already exists")
        for index in _inspector().get_indexes("application_status_events"):
            op.drop_index(index["name"], table_name="application_status_events")
        op.rename_table("application_status_events", _ARCHIVE_TABLE)
    _create_status_events_table()
    if _inspector().has_table(_ARCHIVE_TABLE):
        _copy_status_event_history()

    email_columns = _columns("email_messages")
    if "gmail_url" in email_columns:
        op.drop_column("email_messages", "gmail_url")
    if "message_id" in email_columns and "ix_email_messages_message_id" not in _indexes("email_messages"):
        op.create_index("ix_email_messages_message_id", "email_messages", ["message_id"])

    notification_columns = _columns("notifications")
    if "application_id" not in notification_columns:
        op.add_column(
            "notifications",
            sa.Column("application_id", sa.Integer(), nullable=True),
        )
        op.create_foreign_key(
            "fk_notifications_application_id_applications",
            "notifications",
            "applications",
            ["application_id"],
            ["id"],
            ondelete="SET NULL",
        )
    if "ix_notifications_application_id" not in _indexes("notifications"):
        op.create_index(
            "ix_notifications_application_id",
            "notifications",
            ["application_id"],
        )

    for table_name in ("company_profiles", "student_profiles"):
        if "avatar_url" not in _columns(table_name):
            op.add_column(
                table_name,
                sa.Column("avatar_url", sa.String(length=500), nullable=True),
            )

    if "ix_endorsements_token_digest" in _indexes("endorsements"):
        op.drop_index("ix_endorsements_token_digest", table_name="endorsements")


def downgrade() -> None:
    if "ix_endorsements_token_digest" not in _indexes("endorsements"):
        op.create_index(
            "ix_endorsements_token_digest",
            "endorsements",
            ["token_digest"],
        )

    if "ix_notifications_application_id" in _indexes("notifications"):
        op.drop_index("ix_notifications_application_id", table_name="notifications")
    if "application_id" in _columns("notifications"):
        foreign_keys = _inspector().get_foreign_keys("notifications")
        for foreign_key in foreign_keys:
            if foreign_key.get("constrained_columns") == ["application_id"] and foreign_key.get("name"):
                with op.batch_alter_table("notifications") as batch:
                    batch.drop_constraint(foreign_key["name"], type_="foreignkey")
                break
        op.drop_column("notifications", "application_id")

    if "ix_email_messages_message_id" in _indexes("email_messages"):
        op.drop_index("ix_email_messages_message_id", table_name="email_messages")
    if "gmail_url" not in _columns("email_messages"):
        op.add_column(
            "email_messages",
            sa.Column("gmail_url", sa.Text(), nullable=True),
        )

    if _inspector().has_table("application_status_events"):
        op.drop_index(
            "ix_application_status_events_changed_by_user_id",
            table_name="application_status_events",
        )
        op.drop_index(
            "ix_application_status_events_changed_at",
            table_name="application_status_events",
        )
        op.drop_index(
            "ix_application_status_events_application_id",
            table_name="application_status_events",
        )
        op.drop_table("application_status_events")
    if _inspector().has_table(_ARCHIVE_TABLE):
        op.rename_table(_ARCHIVE_TABLE, "application_status_events")
        restored_columns = _columns("application_status_events")
        restored_indexes = _indexes("application_status_events")
        expected_indexes = {
            "application_id": "ix_application_status_events_application_id",
            "changed_at": "ix_application_status_events_changed_at",
            "changed_by_user_id": "ix_application_status_events_changed_by_user_id",
            "created_at": "ix_application_status_events_created_at",
            "event_type": "ix_application_status_events_event_type",
            "actor_id": "ix_application_status_events_actor_id",
            "interview_id": "ix_application_status_events_interview_id",
        }
        for column, index_name in expected_indexes.items():
            if column in restored_columns and index_name not in restored_indexes:
                op.create_index(
                    index_name,
                    "application_status_events",
                    [column],
                )
