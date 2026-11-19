"""add private video interview recording metadata

Revision ID: 0044_interview_video_recordings
Revises: 0043_interview_voice_metrics
"""

from alembic import op
import sqlalchemy as sa


revision = "0044_interview_video_recordings"
down_revision = "0043_interview_voice_metrics"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "interview_consents",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "session_id",
            sa.Integer(),
            sa.ForeignKey("interview_sessions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "student_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("consent_type", sa.String(length=30), nullable=False),
        sa.Column("version", sa.String(length=50), nullable=False),
        sa.Column(
            "acknowledged_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint(
            "session_id",
            "consent_type",
            "version",
            name="uq_interview_consents_session_type_version",
        ),
        sa.CheckConstraint(
            "consent_type IN ('VIDEO_RECORDING')",
            name="ck_interview_consents_type",
        ),
    )
    op.create_index("ix_interview_consents_session_id", "interview_consents", ["session_id"])
    op.create_index("ix_interview_consents_student_id", "interview_consents", ["student_id"])

    op.create_table(
        "interview_recordings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "session_id",
            sa.Integer(),
            sa.ForeignKey("interview_sessions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "student_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("storage_key", sa.String(length=36), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="UPLOADING"),
        sa.Column("mime_type", sa.String(length=100), nullable=False),
        sa.Column("chunk_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total_bytes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("duration_seconds", sa.Float(), nullable=True),
        sa.Column("retention_expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("storage_key", name="uq_interview_recordings_storage_key"),
        sa.CheckConstraint(
            "status IN ('UPLOADING', 'AVAILABLE', 'DELETED', 'EXPIRED', 'FAILED')",
            name="ck_interview_recordings_status",
        ),
        sa.CheckConstraint("chunk_count >= 0", name="ck_interview_recordings_chunk_count"),
        sa.CheckConstraint("total_bytes >= 0", name="ck_interview_recordings_total_bytes"),
    )
    op.create_index("ix_interview_recordings_session_id", "interview_recordings", ["session_id"])
    op.create_index("ix_interview_recordings_student_id", "interview_recordings", ["student_id"])
    op.create_index(
        "ix_interview_recordings_student_session",
        "interview_recordings",
        ["student_id", "session_id", "created_at"],
    )
    op.create_index(
        "ix_interview_recordings_retention_expires_at",
        "interview_recordings",
        ["retention_expires_at"],
    )
    op.create_index(
        "ix_interview_recordings_expiry",
        "interview_recordings",
        ["status", "retention_expires_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_interview_recordings_expiry", table_name="interview_recordings")
    op.drop_index("ix_interview_recordings_retention_expires_at", table_name="interview_recordings")
    op.drop_index("ix_interview_recordings_student_session", table_name="interview_recordings")
    op.drop_index("ix_interview_recordings_student_id", table_name="interview_recordings")
    op.drop_index("ix_interview_recordings_session_id", table_name="interview_recordings")
    op.drop_table("interview_recordings")
    op.drop_index("ix_interview_consents_student_id", table_name="interview_consents")
    op.drop_index("ix_interview_consents_session_id", table_name="interview_consents")
    op.drop_table("interview_consents")
