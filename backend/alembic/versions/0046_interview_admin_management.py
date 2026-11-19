"""add interview studio admin management

Revision ID: 0046_interview_admin_management
Revises: 0045_mock_test_library
"""

from alembic import op
import sqlalchemy as sa


revision = "0046_interview_admin_management"
down_revision = "0045_mock_test_library"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "interview_studio_difficulties",
        sa.Column("code", sa.String(length=20), primary_key=True),
        sa.Column("label", sa.String(length=40), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.create_table(
        "interview_studio_settings",
        sa.Column("key", sa.String(length=60), primary_key=True),
        sa.Column("value", sa.JSON(), nullable=False),
        sa.Column(
            "updated_by",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_table(
        "interview_studio_admin_audit",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "actor_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("action", sa.String(length=60), nullable=False),
        sa.Column("entity_type", sa.String(length=40), nullable=False),
        sa.Column("entity_id", sa.String(length=100), nullable=True),
        sa.Column("summary", sa.JSON(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "ix_interview_studio_admin_audit_actor_id",
        "interview_studio_admin_audit",
        ["actor_id"],
    )
    op.create_index(
        "ix_interview_studio_admin_audit_created",
        "interview_studio_admin_audit",
        ["created_at"],
    )
    op.create_table(
        "interview_studio_usage_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("event_type", sa.String(length=10), nullable=False),
        sa.Column("status", sa.String(length=10), nullable=False),
        sa.Column("duration_ms", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("retry_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("prompt_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("completion_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("audio_seconds", sa.Float(), nullable=False, server_default="0"),
        sa.Column("error_code", sa.String(length=60), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.CheckConstraint(
            "event_type IN ('LLM', 'STT')",
            name="ck_interview_studio_usage_event_type",
        ),
        sa.CheckConstraint(
            "status IN ('SUCCEEDED', 'FAILED')",
            name="ck_interview_studio_usage_status",
        ),
    )
    op.create_index(
        "ix_interview_studio_usage_event_created",
        "interview_studio_usage_events",
        ["created_at"],
    )

    difficulties = sa.table(
        "interview_studio_difficulties",
        sa.column("code", sa.String),
        sa.column("label", sa.String),
        sa.column("active", sa.Boolean),
    )
    op.bulk_insert(
        difficulties,
        [
            {"code": "BEGINNER", "label": "Beginner", "active": True},
            {"code": "INTERMEDIATE", "label": "Intermediate", "active": True},
            {"code": "ADVANCED", "label": "Advanced", "active": True},
        ],
    )
    settings = sa.table(
        "interview_studio_settings",
        sa.column("key", sa.String),
        sa.column("value", sa.JSON),
    )
    op.bulk_insert(
        settings,
        [
            {"key": "voice_enabled", "value": True},
            {"key": "video_enabled", "value": True},
            {"key": "recording_enabled", "value": True},
            {"key": "retention_days", "value": 30},
            {"key": "sessions_per_day", "value": 5},
        ],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_interview_studio_usage_event_created",
        table_name="interview_studio_usage_events",
    )
    op.drop_table("interview_studio_usage_events")
    op.drop_index(
        "ix_interview_studio_admin_audit_created",
        table_name="interview_studio_admin_audit",
    )
    op.drop_index(
        "ix_interview_studio_admin_audit_actor_id",
        table_name="interview_studio_admin_audit",
    )
    op.drop_table("interview_studio_admin_audit")
    op.drop_table("interview_studio_settings")
    op.drop_table("interview_studio_difficulties")
