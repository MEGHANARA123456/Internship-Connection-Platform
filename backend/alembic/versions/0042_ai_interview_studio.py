"""create text-based AI interview studio tables

Revision ID: 0042_ai_interview_studio
Revises: 0041_student_developer_handles
"""

from alembic import op
import sqlalchemy as sa


revision = "0042_ai_interview_studio"
down_revision = "0041_student_developer_handles"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "interview_sessions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "student_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("session_type", sa.String(length=20), nullable=False),
        sa.Column("interview_mode", sa.String(length=20), server_default="TEXT", nullable=False),
        sa.Column("category", sa.String(length=30), nullable=False),
        sa.Column("difficulty", sa.String(length=20), nullable=False),
        sa.Column("question_count", sa.Integer(), nullable=False, server_default="5"),
        sa.Column("time_limit_seconds", sa.Integer(), nullable=False, server_default="1200"),
        sa.Column("status", sa.String(length=30), nullable=False, server_default="CREATED"),
        sa.Column("consent_acknowledged", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("consent_acknowledged_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "retake_of_session_id",
            sa.Integer(),
            sa.ForeignKey("interview_sessions.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('CREATED', 'IN_PROGRESS', 'EVALUATION_PENDING', "
            "'EVALUATION_FAILED', 'COMPLETED', 'EXPIRED')",
            name="ck_interview_sessions_status",
        ),
        sa.CheckConstraint(
            "session_type IN ('PRACTICE', 'ASSESSMENT')",
            name="ck_interview_sessions_type",
        ),
        sa.CheckConstraint(
            "category IN ('HR', 'TECHNICAL', 'DATA_SCIENCE', 'BEHAVIORAL', 'MIXED')",
            name="ck_interview_sessions_category",
        ),
        sa.CheckConstraint(
            "difficulty IN ('BEGINNER', 'INTERMEDIATE', 'ADVANCED')",
            name="ck_interview_sessions_difficulty",
        ),
        sa.CheckConstraint("question_count IN (5, 10)", name="ck_interview_sessions_question_count"),
        sa.CheckConstraint(
            "question_count = 5 OR category = 'MIXED'",
            name="ck_interview_sessions_ten_questions_mixed_only",
        ),
        sa.CheckConstraint("time_limit_seconds > 0", name="ck_interview_sessions_time_limit"),
    )
    op.create_index("ix_interview_sessions_student_id", "interview_sessions", ["student_id"])
    op.create_index("ix_interview_sessions_status", "interview_sessions", ["status"])
    op.create_index("ix_interview_sessions_retake_of_session_id", "interview_sessions", ["retake_of_session_id"])
    op.create_index("ix_interview_sessions_expires_at", "interview_sessions", ["expires_at"])
    op.create_index(
        "ix_interview_sessions_student_created",
        "interview_sessions",
        ["student_id", "created_at"],
    )

    op.create_table(
        "interview_question_bank",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("seed_key", sa.String(length=100), nullable=False),
        sa.Column("category", sa.String(length=30), nullable=False),
        sa.Column("difficulty", sa.String(length=20), nullable=False),
        sa.Column("prompt", sa.Text(), nullable=False),
        sa.Column("hint", sa.Text(), nullable=False),
        sa.Column("rubric", sa.Text(), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("source_metadata", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("seed_key", name="uq_interview_question_bank_seed_key"),
        sa.CheckConstraint(
            "category IN ('HR', 'TECHNICAL', 'DATA_SCIENCE', 'BEHAVIORAL')",
            name="ck_interview_question_bank_category",
        ),
        sa.CheckConstraint(
            "difficulty IN ('BEGINNER', 'INTERMEDIATE', 'ADVANCED')",
            name="ck_interview_question_bank_difficulty",
        ),
    )
    op.create_index(
        "ix_interview_question_bank_lookup",
        "interview_question_bank",
        ["category", "difficulty", "active"],
    )

    op.create_table(
        "interview_questions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "session_id",
            sa.Integer(),
            sa.ForeignKey("interview_sessions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "question_bank_id",
            sa.Integer(),
            sa.ForeignKey("interview_question_bank.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "follow_up_to_question_id",
            sa.Integer(),
            sa.ForeignKey("interview_questions.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("follow_up_to_answer_id", sa.Integer(), nullable=True),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("prompt", sa.Text(), nullable=False),
        sa.Column("hint", sa.Text(), nullable=True),
        sa.Column("rubric", sa.Text(), nullable=False),
        sa.Column("is_follow_up", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("session_id", "position", name="uq_interview_questions_position"),
        sa.UniqueConstraint(
            "follow_up_to_answer_id",
            name="uq_interview_questions_follow_up_answer",
        ),
        sa.CheckConstraint("position > 0", name="ck_interview_questions_position"),
    )
    op.create_index("ix_interview_questions_session_id", "interview_questions", ["session_id"])

    op.create_table(
        "interview_answers",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "question_id",
            sa.Integer(),
            sa.ForeignKey("interview_questions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("answer_text", sa.Text(), nullable=False),
        sa.Column("assessment_slot", sa.Integer(), nullable=True),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint(
            "question_id",
            "assessment_slot",
            name="uq_interview_answers_assessment_submission",
        ),
        sa.CheckConstraint(
            "assessment_slot IS NULL OR assessment_slot = 1",
            name="ck_interview_answers_assessment_slot",
        ),
    )
    op.create_index("ix_interview_answers_question_id", "interview_answers", ["question_id"])
    op.create_index(
        "ix_interview_answers_question_submitted",
        "interview_answers",
        ["question_id", "submitted_at"],
    )

    op.create_table(
        "interview_evaluations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "answer_id",
            sa.Integer(),
            sa.ForeignKey("interview_answers.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="PENDING"),
        sa.Column("relevance", sa.Integer(), nullable=True),
        sa.Column("technical_correctness", sa.Integer(), nullable=True),
        sa.Column("completeness", sa.Integer(), nullable=True),
        sa.Column("communication", sa.Integer(), nullable=True),
        sa.Column("structure", sa.Integer(), nullable=True),
        sa.Column("feedback", sa.Text(), nullable=True),
        sa.Column("strengths", sa.JSON(), nullable=True),
        sa.Column("improvements", sa.JSON(), nullable=True),
        sa.Column("failure_code", sa.String(length=50), nullable=True),
        sa.Column("model_name", sa.String(length=150), nullable=True),
        sa.Column("evaluated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("answer_id", name="uq_interview_evaluations_answer"),
        sa.CheckConstraint(
            "status IN ('PENDING', 'COMPLETED', 'FAILED')",
            name="ck_interview_evaluations_status",
        ),
        sa.CheckConstraint("relevance IS NULL OR relevance BETWEEN 0 AND 10", name="ck_interview_evaluations_relevance"),
        sa.CheckConstraint(
            "technical_correctness IS NULL OR technical_correctness BETWEEN 0 AND 10",
            name="ck_interview_evaluations_technical_correctness",
        ),
        sa.CheckConstraint(
            "completeness IS NULL OR completeness BETWEEN 0 AND 10",
            name="ck_interview_evaluations_completeness",
        ),
        sa.CheckConstraint(
            "communication IS NULL OR communication BETWEEN 0 AND 10",
            name="ck_interview_evaluations_communication",
        ),
        sa.CheckConstraint("structure IS NULL OR structure BETWEEN 0 AND 10", name="ck_interview_evaluations_structure"),
    )

    op.create_table(
        "interview_reports",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "session_id",
            sa.Integer(),
            sa.ForeignKey("interview_sessions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="PENDING"),
        sa.Column("overall_score", sa.Float(), nullable=True),
        sa.Column("rubric_scores", sa.JSON(), nullable=True),
        sa.Column("answer_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("failure_code", sa.String(length=50), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("session_id", name="uq_interview_reports_session"),
        sa.CheckConstraint(
            "status IN ('PENDING', 'COMPLETED', 'FAILED')",
            name="ck_interview_reports_status",
        ),
        sa.CheckConstraint(
            "overall_score IS NULL OR overall_score BETWEEN 0 AND 100",
            name="ck_interview_reports_overall_score",
        ),
    )


def downgrade() -> None:
    op.drop_table("interview_reports")
    op.drop_table("interview_evaluations")
    op.drop_index("ix_interview_answers_question_submitted", table_name="interview_answers")
    op.drop_index("ix_interview_answers_question_id", table_name="interview_answers")
    op.drop_table("interview_answers")
    op.drop_index("ix_interview_questions_session_id", table_name="interview_questions")
    op.drop_table("interview_questions")
    op.drop_index("ix_interview_question_bank_lookup", table_name="interview_question_bank")
    op.drop_table("interview_question_bank")
    op.drop_index("ix_interview_sessions_student_created", table_name="interview_sessions")
    op.drop_index("ix_interview_sessions_expires_at", table_name="interview_sessions")
    op.drop_index("ix_interview_sessions_retake_of_session_id", table_name="interview_sessions")
    op.drop_index("ix_interview_sessions_status", table_name="interview_sessions")
    op.drop_index("ix_interview_sessions_student_id", table_name="interview_sessions")
    op.drop_table("interview_sessions")
