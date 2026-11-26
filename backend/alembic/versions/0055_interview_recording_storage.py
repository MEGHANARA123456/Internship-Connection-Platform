"""Add configurable private interview recording storage metadata."""

from alembic import op
import sqlalchemy as sa


revision = "0055_interview_recording_storage"
down_revision = "0054_interview_question_approval"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("interview_sessions") as batch:
        batch.add_column(
            sa.Column(
                "video_storage_consent",
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("false"),
            )
        )
        batch.add_column(
            sa.Column("video_storage_consent_at", sa.DateTime(timezone=True))
        )

    with op.batch_alter_table("interview_recordings") as batch:
        batch.drop_constraint("ck_interview_recordings_status", type_="check")
        batch.create_check_constraint(
            "ck_interview_recordings_status",
            "status IN ('UPLOADING', 'PENDING_UPLOAD', 'AVAILABLE', "
            "'PENDING_DELETE', 'DELETED', 'EXPIRED', 'FAILED')",
        )
        batch.add_column(
            sa.Column(
                "source_type",
                sa.String(length=10),
                nullable=False,
                server_default="real",
            )
        )
        batch.add_column(
            sa.Column(
                "storage_backend",
                sa.String(length=20),
                nullable=False,
                server_default="local",
            )
        )
        batch.add_column(sa.Column("storage_file_id", sa.String(length=255)))
        batch.add_column(sa.Column("error_code", sa.String(length=80)))
        batch.add_column(
            sa.Column(
                "upload_active",
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("false"),
            )
        )
        batch.create_index(
            "ix_interview_recordings_upload",
            ["status", "created_at"],
            unique=False,
        )

    with op.batch_alter_table("interview_studio_usage_events") as batch:
        batch.drop_constraint(
            "ck_interview_studio_usage_event_type",
            type_="check",
        )
        batch.create_check_constraint(
            "ck_interview_studio_usage_event_type",
            "event_type IN ('LLM', 'STT', 'VIDEO_STORAGE')",
        )
        batch.alter_column(
            "event_type",
            existing_type=sa.String(length=10),
            type_=sa.String(length=20),
            existing_nullable=False,
        )

    op.execute(
        """
        UPDATE interview_recordings
        SET source_type = CASE
            WHEN (
                SELECT interview_sessions.mock_test_id
                FROM interview_sessions
                WHERE interview_sessions.id = interview_recordings.session_id
            ) IS NOT NULL THEN 'mock'
            ELSE 'real'
        END,
        storage_backend = 'local'
        """
    )
    op.create_table(
        "interview_recording_deletions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("storage_key", sa.String(length=36), nullable=False),
        sa.Column("storage_backend", sa.String(length=20), nullable=False),
        sa.Column("storage_file_id", sa.String(length=255), nullable=True),
        sa.Column("source_type", sa.String(length=10), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("session_id", sa.Integer(), nullable=True),
        sa.Column(
            "upload_active",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column(
            "final_status",
            sa.String(length=20),
            nullable=False,
            server_default="DELETED",
        ),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("error_code", sa.String(length=80), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "ix_interview_recording_deletions_created",
        "interview_recording_deletions",
        ["created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_interview_recording_deletions_created",
        table_name="interview_recording_deletions",
    )
    op.drop_table("interview_recording_deletions")
    op.execute(
        "DELETE FROM interview_studio_usage_events WHERE event_type = 'VIDEO_STORAGE'"
    )
    with op.batch_alter_table("interview_studio_usage_events") as batch:
        batch.drop_constraint(
            "ck_interview_studio_usage_event_type",
            type_="check",
        )
        batch.create_check_constraint(
            "ck_interview_studio_usage_event_type",
            "event_type IN ('LLM', 'STT')",
        )
        batch.alter_column(
            "event_type",
            existing_type=sa.String(length=20),
            type_=sa.String(length=10),
            existing_nullable=False,
        )
    with op.batch_alter_table("interview_recordings") as batch:
        batch.drop_index("ix_interview_recordings_upload")
        batch.drop_column("error_code")
        batch.drop_column("storage_file_id")
        batch.drop_column("upload_active")
        batch.drop_column("storage_backend")
        batch.drop_column("source_type")
        batch.drop_constraint("ck_interview_recordings_status", type_="check")
        batch.create_check_constraint(
            "ck_interview_recordings_status",
            "status IN ('UPLOADING', 'AVAILABLE', 'DELETED', 'EXPIRED', 'FAILED')",
        )
    with op.batch_alter_table("interview_sessions") as batch:
        batch.drop_column("video_storage_consent_at")
        batch.drop_column("video_storage_consent")
