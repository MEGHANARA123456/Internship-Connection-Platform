"""support resumable skill assessment attempts

Revision ID: 0028_skill_attempt_resumption
Revises: 0027_chatbot_knowledge
"""

from datetime import datetime, timezone

from alembic import op
import sqlalchemy as sa


revision = "0028_skill_attempt_resumption"
down_revision = "0027_chatbot_knowledge"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "skill_attempts",
        sa.Column("status", sa.String(length=20), server_default="IN_PROGRESS", nullable=False),
    )
    bind = op.get_bind()
    attempts = sa.table(
        "skill_attempts",
        sa.column("id", sa.Integer()),
        sa.column("student_id", sa.Integer()),
        sa.column("topic", sa.String(length=100)),
        sa.column("started_at", sa.DateTime(timezone=True)),
        sa.column("expires_at", sa.DateTime(timezone=True)),
        sa.column("submitted_at", sa.DateTime(timezone=True)),
        sa.column("status", sa.String(length=20)),
    )
    now = datetime.now(timezone.utc)
    active_by_topic: dict[tuple[int, str], int] = {}
    rows = bind.execute(
        sa.select(
            attempts.c.id,
            attempts.c.student_id,
            attempts.c.topic,
            attempts.c.started_at,
            attempts.c.expires_at,
            attempts.c.submitted_at,
        ).order_by(
            attempts.c.student_id,
            attempts.c.topic,
            attempts.c.started_at,
            attempts.c.id,
        )
    )
    states: dict[int, str] = {}
    for row in rows:
        if row.submitted_at is not None:
            states[row.id] = "COMPLETED"
            continue
        expires_at = row.expires_at
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if expires_at <= now:
            states[row.id] = "EXPIRED"
            continue
        active_by_topic[(row.student_id, row.topic)] = row.id
        states[row.id] = "EXPIRED"
    for attempt_id in active_by_topic.values():
        states[attempt_id] = "IN_PROGRESS"
    for attempt_id, status in states.items():
        bind.execute(
            attempts.update().where(attempts.c.id == attempt_id).values(status=status)
        )

    op.create_index(
        "uq_skill_attempts_active_student_topic",
        "skill_attempts",
        ["student_id", "topic"],
        unique=True,
        postgresql_where=sa.text("status = 'IN_PROGRESS'"),
        sqlite_where=sa.text("status = 'IN_PROGRESS'"),
    )


def downgrade() -> None:
    op.drop_index(
        "uq_skill_attempts_active_student_topic",
        table_name="skill_attempts",
    )
    op.drop_column("skill_attempts", "status")
