"""add consent-based interview proctoring events

Revision ID: 0049_interview_proctoring
Revises: 0048_skill_gap_analysis
"""

from alembic import op
import sqlalchemy as sa


revision = "0049_interview_proctoring"
down_revision = "0048_skill_gap_analysis"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "interview_sessions",
        sa.Column(
            "proctoring_consent_acknowledged",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.add_column(
        "interview_sessions",
        sa.Column("proctoring_consent_acknowledged_at", sa.DateTime(timezone=True)),
    )
    op.add_column(
        "interview_sessions",
        sa.Column(
            "proctoring_max_violations",
            sa.Integer(),
            nullable=False,
            server_default="3",
        ),
    )
    op.drop_constraint(
        "ck_interview_sessions_status", "interview_sessions", type_="check"
    )
    op.create_check_constraint(
        "ck_interview_sessions_status",
        "interview_sessions",
        "status IN ('CREATED', 'IN_PROGRESS', 'EVALUATION_PENDING', "
        "'EVALUATION_FAILED', 'COMPLETED', 'EXPIRED', 'TERMINATED')",
    )
    op.drop_constraint(
        "ck_interview_consents_type", "interview_consents", type_="check"
    )
    op.create_check_constraint(
        "ck_interview_consents_type",
        "interview_consents",
        "consent_type IN ('VIDEO_RECORDING', 'PROCTORING')",
    )
    op.create_table(
        "interview_proctoring_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "session_id",
            sa.Integer(),
            sa.ForeignKey("interview_sessions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("event_type", sa.String(length=30), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("metadata", sa.JSON(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.CheckConstraint(
            "event_type IN ('TAB_HIDDEN', 'WINDOW_BLUR', 'FULLSCREEN_EXIT', "
            "'COPY_ATTEMPT', 'CUT_ATTEMPT', 'PASTE_ATTEMPT', 'CONTEXT_MENU', "
            "'DRAG_ATTEMPT', 'DROP_ATTEMPT', 'SHORTCUT_ATTEMPT', 'FOCUS_RETURN')",
            name="ck_interview_proctoring_events_type",
        ),
    )
    op.create_index(
        "ix_interview_proctoring_events_session_id",
        "interview_proctoring_events",
        ["session_id"],
    )
    op.create_index(
        "ix_interview_proctoring_events_user_id",
        "interview_proctoring_events",
        ["user_id"],
    )
    op.create_index(
        "ix_interview_proctoring_events_session_occurred",
        "interview_proctoring_events",
        ["session_id", "occurred_at"],
    )
    op.create_index(
        "ix_interview_proctoring_events_created",
        "interview_proctoring_events",
        ["created_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_interview_proctoring_events_created",
        table_name="interview_proctoring_events",
    )
    op.drop_index(
        "ix_interview_proctoring_events_session_occurred",
        table_name="interview_proctoring_events",
    )
    op.drop_index(
        "ix_interview_proctoring_events_user_id",
        table_name="interview_proctoring_events",
    )
    op.drop_index(
        "ix_interview_proctoring_events_session_id",
        table_name="interview_proctoring_events",
    )
    op.drop_table("interview_proctoring_events")
    op.drop_constraint(
        "ck_interview_consents_type", "interview_consents", type_="check"
    )
    op.create_check_constraint(
        "ck_interview_consents_type",
        "interview_consents",
        "consent_type IN ('VIDEO_RECORDING')",
    )
    op.drop_constraint(
        "ck_interview_sessions_status", "interview_sessions", type_="check"
    )
    op.create_check_constraint(
        "ck_interview_sessions_status",
        "interview_sessions",
        "status IN ('CREATED', 'IN_PROGRESS', 'EVALUATION_PENDING', "
        "'EVALUATION_FAILED', 'COMPLETED', 'EXPIRED')",
    )
    op.drop_column("interview_sessions", "proctoring_max_violations")
    op.drop_column("interview_sessions", "proctoring_consent_acknowledged_at")
    op.drop_column("interview_sessions", "proctoring_consent_acknowledged")
