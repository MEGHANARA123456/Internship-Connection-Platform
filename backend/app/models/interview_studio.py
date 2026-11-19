from datetime import datetime, timezone
from typing import Any

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
    true,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class InterviewSession(Base):
    __tablename__ = "interview_sessions"
    __table_args__ = (
        CheckConstraint(
            "status IN ('CREATED', 'IN_PROGRESS', 'EVALUATION_PENDING', "
            "'EVALUATION_FAILED', 'COMPLETED', 'EXPIRED', 'TERMINATED')",
            name="ck_interview_sessions_status",
        ),
        CheckConstraint(
            "session_type IN ('PRACTICE', 'ASSESSMENT')",
            name="ck_interview_sessions_type",
        ),
        CheckConstraint(
            "category IN ('HR', 'TECHNICAL', 'DATA_SCIENCE', 'BEHAVIORAL', 'MIXED')",
            name="ck_interview_sessions_category",
        ),
        CheckConstraint(
            "difficulty IN ('BEGINNER', 'INTERMEDIATE', 'ADVANCED')",
            name="ck_interview_sessions_difficulty",
        ),
        CheckConstraint(
            "question_count IN (5, 10, 15, 20)",
            name="ck_interview_sessions_question_count",
        ),
        CheckConstraint(
            "question_count = 5 OR category = 'MIXED' OR mock_test_id IS NOT NULL",
            name="ck_interview_sessions_ten_questions_mixed_only",
        ),
        CheckConstraint("time_limit_seconds > 0", name="ck_interview_sessions_time_limit"),
        Index("ix_interview_sessions_student_created", "student_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    student_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    mock_test_id: Mapped[int | None] = mapped_column(
        ForeignKey("mock_tests.id", ondelete="SET NULL"), nullable=True, index=True
    )
    mock_test_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    session_type: Mapped[str] = mapped_column(String(20), nullable=False)
    interview_mode: Mapped[str] = mapped_column(
        String(20), nullable=False, default="TEXT", server_default="TEXT"
    )
    current_question_position: Mapped[int | None] = mapped_column(
        Integer, nullable=True
    )
    category: Mapped[str] = mapped_column(String(30), nullable=False)
    difficulty: Mapped[str] = mapped_column(String(20), nullable=False)
    question_count: Mapped[int] = mapped_column(Integer, nullable=False, default=5)
    time_limit_seconds: Mapped[int] = mapped_column(
        Integer, nullable=False, default=1200, server_default="1200"
    )
    status: Mapped[str] = mapped_column(
        String(30), nullable=False, default="CREATED", server_default="CREATED", index=True
    )
    consent_acknowledged: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )
    consent_acknowledged_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    proctoring_consent_acknowledged: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )
    proctoring_consent_acknowledged_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    proctoring_max_violations: Mapped[int] = mapped_column(
        Integer, nullable=False, default=3, server_default="3"
    )
    retake_of_session_id: Mapped[int | None] = mapped_column(
        ForeignKey("interview_sessions.id", ondelete="SET NULL"), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        server_default=func.now(),
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class InterviewQuestionBank(Base):
    __tablename__ = "interview_question_bank"
    __table_args__ = (
        UniqueConstraint("seed_key", name="uq_interview_question_bank_seed_key"),
        CheckConstraint(
            "category IN ('HR', 'TECHNICAL', 'DATA_SCIENCE', 'BEHAVIORAL')",
            name="ck_interview_question_bank_category",
        ),
        CheckConstraint(
            "difficulty IN ('BEGINNER', 'INTERMEDIATE', 'ADVANCED')",
            name="ck_interview_question_bank_difficulty",
        ),
        Index(
            "ix_interview_question_bank_lookup",
            "category",
            "difficulty",
            "active",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    seed_key: Mapped[str] = mapped_column(String(100), nullable=False)
    category: Mapped[str] = mapped_column(String(30), nullable=False)
    difficulty: Mapped[str] = mapped_column(String(20), nullable=False)
    prompt: Mapped[str] = mapped_column(Text, nullable=False)
    hint: Mapped[str] = mapped_column(Text, nullable=False)
    rubric: Mapped[str] = mapped_column(Text, nullable=False)
    active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=true()
    )
    source_metadata: Mapped[dict[str, Any]] = mapped_column(
        JSON, nullable=False, default=dict
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        server_default=func.now(),
    )


class MockTestCategory(Base):
    __tablename__ = "mock_test_categories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    slug: Mapped[str] = mapped_column(String(50), nullable=False, unique=True)
    title: Mapped[str] = mapped_column(String(100), nullable=False)
    active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=true()
    )


class MockTest(Base):
    __tablename__ = "mock_tests"
    __table_args__ = (
        UniqueConstraint("slug", name="uq_mock_tests_slug"),
        CheckConstraint(
            "difficulty IN ('BEGINNER', 'INTERMEDIATE', 'ADVANCED')",
            name="ck_mock_tests_difficulty",
        ),
        CheckConstraint(
            "format IN ('QUICK_PRACTICE', 'STANDARD', 'FULL', 'TOPIC_WISE')",
            name="ck_mock_tests_format",
        ),
        CheckConstraint("default_mode IN ('PRACTICE', 'ASSESSMENT')", name="ck_mock_tests_default_mode"),
        CheckConstraint("question_count IN (5, 10, 15, 20)", name="ck_mock_tests_question_count"),
        CheckConstraint("version > 0", name="ck_mock_tests_version"),
        Index("ix_mock_tests_active_category", "active", "category_id", "difficulty"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    slug: Mapped[str] = mapped_column(String(100), nullable=False)
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    category_id: Mapped[int] = mapped_column(
        ForeignKey("mock_test_categories.id", ondelete="RESTRICT"), nullable=False
    )
    difficulty: Mapped[str] = mapped_column(String(20), nullable=False)
    format: Mapped[str] = mapped_column(String(30), nullable=False)
    default_mode: Mapped[str] = mapped_column(String(20), nullable=False, default="PRACTICE")
    question_count: Mapped[int] = mapped_column(Integer, nullable=False)
    time_limit_seconds: Mapped[int] = mapped_column(Integer, nullable=False)
    question_filter: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    skill_tags: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    company_style: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )
    active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=true()
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    source_metadata: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        server_default=func.now(),
    )


class MockTestQuestion(Base):
    __tablename__ = "mock_test_questions"
    __table_args__ = (
        UniqueConstraint(
            "mock_test_id", "version", "position",
            name="uq_mock_test_questions_version_position",
        ),
        UniqueConstraint(
            "mock_test_id", "version", "question_bank_id",
            name="uq_mock_test_questions_version_bank_question",
        ),
        CheckConstraint("position > 0", name="ck_mock_test_questions_position"),
        CheckConstraint("version > 0", name="ck_mock_test_questions_version"),
        Index("ix_mock_test_questions_test_version", "mock_test_id", "version"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    mock_test_id: Mapped[int] = mapped_column(
        ForeignKey("mock_tests.id", ondelete="CASCADE"), nullable=False
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    question_bank_id: Mapped[int] = mapped_column(
        ForeignKey("interview_question_bank.id", ondelete="RESTRICT"), nullable=False
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    skill_tags: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)


class InterviewStudioDifficulty(Base):
    __tablename__ = "interview_studio_difficulties"

    code: Mapped[str] = mapped_column(String(20), primary_key=True)
    label: Mapped[str] = mapped_column(String(40), nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default=true())


class InterviewStudioSetting(Base):
    __tablename__ = "interview_studio_settings"

    key: Mapped[str] = mapped_column(String(60), primary_key=True)
    value: Mapped[Any] = mapped_column(JSON, nullable=False)
    updated_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc),
        server_default=func.now(),
    )


class InterviewStudioAdminAudit(Base):
    __tablename__ = "interview_studio_admin_audit"
    __table_args__ = (
        Index("ix_interview_studio_admin_audit_created", "created_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    actor_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    action: Mapped[str] = mapped_column(String(60), nullable=False)
    entity_type: Mapped[str] = mapped_column(String(40), nullable=False)
    entity_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    summary: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc),
        server_default=func.now(),
    )


class InterviewStudioUsageEvent(Base):
    __tablename__ = "interview_studio_usage_events"
    __table_args__ = (
        CheckConstraint(
            "event_type IN ('LLM', 'STT')", name="ck_interview_studio_usage_event_type"
        ),
        CheckConstraint(
            "status IN ('SUCCEEDED', 'FAILED')",
            name="ck_interview_studio_usage_status",
        ),
        Index("ix_interview_studio_usage_event_created", "created_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    event_type: Mapped[str] = mapped_column(String(10), nullable=False)
    status: Mapped[str] = mapped_column(String(10), nullable=False)
    duration_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    retry_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    prompt_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    completion_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    audio_seconds: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    error_code: Mapped[str | None] = mapped_column(String(60), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc),
        server_default=func.now(),
    )


class InterviewQuestion(Base):
    __tablename__ = "interview_questions"
    __table_args__ = (
        UniqueConstraint("session_id", "position", name="uq_interview_questions_position"),
        UniqueConstraint(
            "follow_up_to_answer_id",
            name="uq_interview_questions_follow_up_answer",
        ),
        CheckConstraint("position > 0", name="ck_interview_questions_position"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    session_id: Mapped[int] = mapped_column(
        ForeignKey("interview_sessions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    question_bank_id: Mapped[int | None] = mapped_column(
        ForeignKey("interview_question_bank.id", ondelete="SET NULL"), nullable=True
    )
    follow_up_to_question_id: Mapped[int | None] = mapped_column(
        ForeignKey("interview_questions.id", ondelete="CASCADE"), nullable=True
    )
    follow_up_to_answer_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    prompt: Mapped[str] = mapped_column(Text, nullable=False)
    hint: Mapped[str | None] = mapped_column(Text, nullable=True)
    rubric: Mapped[str] = mapped_column(Text, nullable=False)
    skill_tags: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    is_follow_up: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        server_default=func.now(),
    )


class InterviewAnswer(Base):
    __tablename__ = "interview_answers"
    __table_args__ = (
        UniqueConstraint(
            "question_id",
            "assessment_slot",
            name="uq_interview_answers_assessment_submission",
        ),
        CheckConstraint(
            "assessment_slot IS NULL OR assessment_slot = 1",
            name="ck_interview_answers_assessment_slot",
        ),
        Index("ix_interview_answers_question_submitted", "question_id", "submitted_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    question_id: Mapped[int] = mapped_column(
        ForeignKey("interview_questions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    answer_text: Mapped[str] = mapped_column(Text, nullable=False)
    assessment_slot: Mapped[int | None] = mapped_column(Integer, nullable=True)
    duration_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
    word_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    speaking_pace_wpm: Mapped[float | None] = mapped_column(Float, nullable=True)
    filler_word_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    submitted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        server_default=func.now(),
    )


class InterviewEvaluation(Base):
    __tablename__ = "interview_evaluations"
    __table_args__ = (
        UniqueConstraint("answer_id", name="uq_interview_evaluations_answer"),
        CheckConstraint(
            "status IN ('PENDING', 'COMPLETED', 'FAILED')",
            name="ck_interview_evaluations_status",
        ),
        CheckConstraint(
            "relevance IS NULL OR relevance BETWEEN 0 AND 10",
            name="ck_interview_evaluations_relevance",
        ),
        CheckConstraint(
            "technical_correctness IS NULL OR technical_correctness BETWEEN 0 AND 10",
            name="ck_interview_evaluations_technical_correctness",
        ),
        CheckConstraint(
            "completeness IS NULL OR completeness BETWEEN 0 AND 10",
            name="ck_interview_evaluations_completeness",
        ),
        CheckConstraint(
            "communication IS NULL OR communication BETWEEN 0 AND 10",
            name="ck_interview_evaluations_communication",
        ),
        CheckConstraint(
            "structure IS NULL OR structure BETWEEN 0 AND 10",
            name="ck_interview_evaluations_structure",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    answer_id: Mapped[int] = mapped_column(
        ForeignKey("interview_answers.id", ondelete="CASCADE"), nullable=False
    )
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="PENDING", server_default="PENDING"
    )
    relevance: Mapped[int | None] = mapped_column(Integer, nullable=True)
    technical_correctness: Mapped[int | None] = mapped_column(Integer, nullable=True)
    completeness: Mapped[int | None] = mapped_column(Integer, nullable=True)
    communication: Mapped[int | None] = mapped_column(Integer, nullable=True)
    structure: Mapped[int | None] = mapped_column(Integer, nullable=True)
    feedback: Mapped[str | None] = mapped_column(Text, nullable=True)
    strengths: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    improvements: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    failure_code: Mapped[str | None] = mapped_column(String(50), nullable=True)
    model_name: Mapped[str | None] = mapped_column(String(150), nullable=True)
    evaluated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        server_default=func.now(),
    )


class InterviewReport(Base):
    __tablename__ = "interview_reports"
    __table_args__ = (
        UniqueConstraint("session_id", name="uq_interview_reports_session"),
        CheckConstraint(
            "status IN ('PENDING', 'COMPLETED', 'FAILED')",
            name="ck_interview_reports_status",
        ),
        CheckConstraint(
            "overall_score IS NULL OR overall_score BETWEEN 0 AND 100",
            name="ck_interview_reports_overall_score",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    session_id: Mapped[int] = mapped_column(
        ForeignKey("interview_sessions.id", ondelete="CASCADE"), nullable=False
    )
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="PENDING", server_default="PENDING"
    )
    overall_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    rubric_scores: Mapped[dict[str, float] | None] = mapped_column(JSON, nullable=True)
    skill_breakdown: Mapped[dict[str, float] | None] = mapped_column(JSON, nullable=True)
    answer_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    failure_code: Mapped[str | None] = mapped_column(String(50), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        server_default=func.now(),
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class InterviewConsent(Base):
    __tablename__ = "interview_consents"
    __table_args__ = (
        UniqueConstraint(
            "session_id",
            "consent_type",
            "version",
            name="uq_interview_consents_session_type_version",
        ),
        CheckConstraint(
            "consent_type IN ('VIDEO_RECORDING', 'PROCTORING')",
            name="ck_interview_consents_type",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    session_id: Mapped[int] = mapped_column(
        ForeignKey("interview_sessions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    student_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    consent_type: Mapped[str] = mapped_column(
        String(30), nullable=False, default="VIDEO_RECORDING"
    )
    version: Mapped[str] = mapped_column(String(50), nullable=False)
    acknowledged_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        server_default=func.now(),
    )


class InterviewProctoringEvent(Base):
    __tablename__ = "interview_proctoring_events"
    __table_args__ = (
        CheckConstraint(
            "event_type IN ('TAB_HIDDEN', 'WINDOW_BLUR', 'FULLSCREEN_EXIT', "
            "'COPY_ATTEMPT', 'CUT_ATTEMPT', 'PASTE_ATTEMPT', 'CONTEXT_MENU', "
            "'DRAG_ATTEMPT', 'DROP_ATTEMPT', 'SHORTCUT_ATTEMPT', "
            "'FOCUS_RETURN')",
            name="ck_interview_proctoring_events_type",
        ),
        Index(
            "ix_interview_proctoring_events_session_occurred",
            "session_id",
            "occurred_at",
        ),
        Index("ix_interview_proctoring_events_created", "created_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    session_id: Mapped[int] = mapped_column(
        ForeignKey("interview_sessions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    event_type: Mapped[str] = mapped_column(String(30), nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    event_metadata: Mapped[dict[str, int | None]] = mapped_column(
        "metadata", JSON, nullable=False, default=dict
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        server_default=func.now(),
    )


class InterviewRecording(Base):
    __tablename__ = "interview_recordings"
    __table_args__ = (
        CheckConstraint(
            "status IN ('UPLOADING', 'AVAILABLE', 'DELETED', 'EXPIRED', 'FAILED')",
            name="ck_interview_recordings_status",
        ),
        CheckConstraint("chunk_count >= 0", name="ck_interview_recordings_chunk_count"),
        CheckConstraint("total_bytes >= 0", name="ck_interview_recordings_total_bytes"),
        Index(
            "ix_interview_recordings_student_session",
            "student_id",
            "session_id",
            "created_at",
        ),
        Index("ix_interview_recordings_expiry", "status", "retention_expires_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    session_id: Mapped[int] = mapped_column(
        ForeignKey("interview_sessions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    student_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    storage_key: Mapped[str] = mapped_column(
        String(36), nullable=False, unique=True
    )
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="UPLOADING", server_default="UPLOADING"
    )
    mime_type: Mapped[str] = mapped_column(String(100), nullable=False)
    chunk_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_bytes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    duration_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
    retention_expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        server_default=func.now(),
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
