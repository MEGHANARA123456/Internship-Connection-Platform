from datetime import datetime
import re
from typing import Annotated, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StrictInt,
    field_validator,
    model_validator,
)


InterviewCategory = Literal["HR", "TECHNICAL"]
InterviewDifficulty = Literal["INTERMEDIATE"]
InterviewSessionType = Literal["PRACTICE", "ASSESSMENT"]
InterviewStatus = Literal[
    "CREATED",
    "IN_PROGRESS",
    "EVALUATION_PENDING",
    "EVALUATION_FAILED",
    "COMPLETED",
    "EXPIRED",
    "TERMINATED",
]
MockTestFormat = Literal["QUICK_PRACTICE", "STANDARD", "FULL", "TOPIC_WISE"]
MockTestAttemptMode = Literal["TEXT", "VOICE", "VIDEO"]


class InterviewSessionCreate(BaseModel):
    session_type: InterviewSessionType
    category: Literal["HR", "TECHNICAL"]
    difficulty: str | None = None
    question_count: Literal[5, 10] = 5
    interview_mode: Literal["VIDEO"] = "VIDEO"
    consent_acknowledged: Literal[True]
    video_storage_consent: bool = False
    retake_of_session_id: int | None = Field(default=None, gt=0)



class InterviewAnswerSubmit(BaseModel):
    question_id: int = Field(gt=0)
    answer_text: str = Field(min_length=1, max_length=5000)
    audio_duration_token: str | None = Field(default=None, max_length=1000)

    @field_validator("answer_text")
    @classmethod
    def trim_answer(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Answer cannot be empty")
        return value


class InterviewSessionView(BaseModel):
    id: int
    mock_test_id: int | None = None
    mock_test_version: int | None = None
    session_type: InterviewSessionType
    interview_mode: str
    category: InterviewCategory
    difficulty: InterviewDifficulty
    question_count: int
    time_limit_seconds: int
    status: InterviewStatus
    consent_acknowledged: bool
    video_storage_consent: bool = False
    proctoring_consent_acknowledged: bool
    proctoring_max_violations: int
    retake_of_session_id: int | None
    created_at: datetime
    started_at: datetime | None
    expires_at: datetime | None
    completed_at: datetime | None


class InterviewQuestionView(BaseModel):
    id: int
    position: int
    prompt: str
    hint: str | None
    is_follow_up: bool
    answer_submitted: bool


class InterviewNextQuestionView(BaseModel):
    session_status: InterviewStatus
    question: InterviewQuestionView | None
    question_limit_reached: bool


class InterviewEvaluationView(BaseModel):
    relevance: int | None = None
    technical_correctness: int | None = None
    completeness: int | None = None
    communication: int | None = None
    structure: int | None = None
    feedback: str
    strengths: list[str]
    improvements: list[str]
    score: int | None = None
    suggested_answer: str | None = None


FeedbackItem = Annotated[str, Field(min_length=1, max_length=300)]


class InterviewAttemptAnswerEvaluation(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    question_id: StrictInt = Field(gt=0)
    score: StrictInt = Field(ge=0, le=10)
    strengths: list[FeedbackItem] = Field(max_length=5)
    improvements: list[FeedbackItem] = Field(max_length=5)
    suggested_answer: str = Field(min_length=1, max_length=1200)

    @field_validator("strengths", "improvements", mode="before")
    @classmethod
    def trim_attempt_feedback_lists(cls, value: object) -> object:
        if not isinstance(value, list):
            return value
        return [item.strip() if isinstance(item, str) else item for item in value]

    @field_validator("suggested_answer", mode="before")
    @classmethod
    def trim_suggested_answer(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value

    @model_validator(mode="after")
    def reject_hiring_decisions(self) -> "InterviewAttemptAnswerEvaluation":
        content = " ".join(
            [*self.strengths, *self.improvements, self.suggested_answer]
        ).casefold()
        if re.search(
            r"\b(?:hire|hiring|reject|rejection|offer|employ|employment)\b",
            content,
        ):
            raise ValueError("Evaluation must not make hiring decisions")
        return self


class InterviewAttemptReport(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    overall_score: float = Field(ge=0, le=100)
    summary: str = Field(min_length=1, max_length=1200)
    top_strengths: list[str] = Field(max_length=8)
    top_improvements: list[str] = Field(max_length=8)
    next_steps: list[str] = Field(max_length=8)

    @field_validator("summary", mode="before")
    @classmethod
    def trim_attempt_summary(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value

    @field_validator("top_strengths", "top_improvements", "next_steps", mode="before")
    @classmethod
    def trim_attempt_report_lists(cls, value: object) -> object:
        if not isinstance(value, list):
            return value
        return [item.strip() if isinstance(item, str) else item for item in value]

    @model_validator(mode="after")
    def reject_hiring_decisions(self) -> "InterviewAttemptReport":
        content = " ".join(
            [
                self.summary,
                *self.top_strengths,
                *self.top_improvements,
                *self.next_steps,
            ]
        ).casefold()
        if re.search(
            r"\b(?:hire|hiring|reject|rejection|offer|employ|employment)\b",
            content,
        ):
            raise ValueError("Report must not make hiring decisions")
        return self


class InterviewAttemptLLMResponse(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    answers: list[InterviewAttemptAnswerEvaluation] = Field(max_length=10)
    report: InterviewAttemptReport | None = None


class InterviewAnswerView(BaseModel):
    answer_id: int
    evaluation_status: Literal["PENDING", "EVALUATING", "COMPLETED", "FAILED"]
    failure_code: str | None = None
    retry_after_seconds: int | None = Field(default=None, ge=0)
    evaluation: InterviewEvaluationView | None = None


class InterviewAnswerReview(BaseModel):
    question_id: int
    position: int
    prompt: str
    answer_text: str
    skill_tags: list[str] = Field(default_factory=list)
    evaluation_status: Literal["PENDING", "EVALUATING", "COMPLETED", "FAILED"]
    failure_code: str | None = None
    evaluation: InterviewEvaluationView | None = None
    duration_seconds: float | None = None
    word_count: int | None = None
    speaking_pace_wpm: float | None = None
    filler_word_count: int | None = None


class InterviewAnswerRecord(BaseModel):
    answer_id: int
    question_id: int
    position: int
    answer_text: str
    submitted_at: datetime
    evaluation_status: Literal["PENDING", "EVALUATING", "COMPLETED", "FAILED"]
    failure_code: str | None = None
    evaluation: InterviewEvaluationView | None = None


class InterviewEvaluationRetryView(BaseModel):
    queued: int
    evaluated: int
    failed: int


class InterviewProctoringEventCreate(BaseModel):
    event_type: Literal[
        "TAB_HIDDEN",
        "WINDOW_BLUR",
        "FULLSCREEN_EXIT",
        "COPY_ATTEMPT",
        "CUT_ATTEMPT",
        "PASTE_ATTEMPT",
        "CONTEXT_MENU",
        "DRAG_ATTEMPT",
        "DROP_ATTEMPT",
        "SHORTCUT_ATTEMPT",
        "FOCUS_RETURN",
    ]
    occurred_at: datetime
    question_index: int | None = Field(default=None, ge=1)
    duration_away_ms: int | None = Field(default=None, ge=0, le=86_400_000)


class InterviewProctoringEventResult(BaseModel):
    violation_count: int
    max_violations: int
    terminated: bool


class InterviewProctoringSummary(BaseModel):
    violation_count: int
    types: dict[str, int]
    total_time_away_ms: int


class InterviewVoiceMetrics(BaseModel):
    total_duration_seconds: float
    total_word_count: int
    average_speaking_pace_wpm: float | None
    total_filler_word_count: int


class InterviewAudioTranscriptView(BaseModel):
    transcript: str
    duration_seconds: float
    duration_token: str


class InterviewRecordingConsentRequest(BaseModel):
    acknowledged: Literal[True]
    consent_version: str = Field(min_length=1, max_length=50)


class InterviewRecordingConsentView(BaseModel):
    acknowledged: bool
    consent_version: str
    acknowledged_at: datetime | None = None


class InterviewRecordingView(BaseModel):
    id: int
    status: Literal[
        "UPLOADING",
        "PENDING_UPLOAD",
        "AVAILABLE",
        "PENDING_DELETE",
        "DELETED",
        "EXPIRED",
        "FAILED",
    ]
    finalized: bool
    source_type: Literal["mock", "real"]
    retryable: bool
    mime_type: str
    chunk_count: int
    next_chunk_index: int
    total_bytes: int
    duration_seconds: float | None
    retention_expires_at: datetime
    created_at: datetime
    error_code: str | None = None


class InterviewVideoRecordingState(BaseModel):
    required_consent_version: str
    video_storage_consent: bool
    retention_days: int
    storage_backend: Literal["local", "gdrive"]
    consent: InterviewRecordingConsentView | None = None
    recording: InterviewRecordingView | None = None
    recordings: list[InterviewRecordingView] = Field(default_factory=list)


class InterviewVideoChunkResult(BaseModel):
    recording_id: int
    next_chunk_index: int


class InterviewVideoStorageConsentRequest(BaseModel):
    acknowledged: bool


class InterviewVideoMetrics(BaseModel):
    session_duration_seconds: float


class InterviewReportView(BaseModel):
    session_id: int
    status: Literal["PENDING", "COMPLETED", "FAILED"]
    overall_score: float | None = None
    rubric_scores: dict[str, float] | None = None
    answer_count: int
    summary: str | None = None
    top_strengths: list[str] = Field(default_factory=list)
    top_improvements: list[str] = Field(default_factory=list)
    next_steps: list[str] = Field(default_factory=list)
    failure_code: str | None = None
    retry_after_seconds: int | None = Field(default=None, ge=0)
    evaluations: list[InterviewAnswerReview] = Field(default_factory=list)
    skill_breakdown: dict[str, float] | None = None
    voice_metrics: InterviewVoiceMetrics | None = None
    video_metrics: InterviewVideoMetrics | None = None
    proctoring_summary: InterviewProctoringSummary


class MockTestAttemptCreate(BaseModel):
    session_type: InterviewSessionType | None = None
    interview_mode: MockTestAttemptMode
    consent_acknowledged: Literal[True]
    video_storage_consent: bool = False
    retake_of_session_id: int | None = Field(default=None, gt=0)


class MockTestAttemptSummary(BaseModel):
    session_id: int
    test_version: int
    session_type: InterviewSessionType
    interview_mode: MockTestAttemptMode
    status: InterviewStatus
    created_at: datetime
    completed_at: datetime | None
    overall_score: float | None
    skill_breakdown: dict[str, float] | None = None


class MockTestView(BaseModel):
    id: int
    slug: str
    title: str
    description: str
    category: str
    difficulty: InterviewDifficulty
    format: MockTestFormat
    default_mode: InterviewSessionType
    question_count: int
    time_limit_seconds: int
    estimated_duration_minutes: int
    skill_tags: list[str]
    company_style: bool
    version: int
    attempt_count: int
    completed_attempt_count: int
    latest_score: float | None = None
    latest_status: InterviewStatus | None = None
    attempts: list[MockTestAttemptSummary] = Field(default_factory=list)


class MockTestDetailView(BaseModel):
    id: int
    title: str
    description: str
    category: str
    difficulty: InterviewDifficulty
    default_mode: InterviewSessionType
    question_count: int
    time_limit_seconds: int
    estimated_duration_minutes: int
    version: int


class MockTestComparisonRequest(BaseModel):
    attempt_ids: list[int] = Field(min_length=2, max_length=10)

    @field_validator("attempt_ids")
    @classmethod
    def require_unique_attempts(cls, value: list[int]) -> list[int]:
        if any(attempt_id < 1 for attempt_id in value) or len(set(value)) != len(value):
            raise ValueError("Choose distinct valid attempts")
        return value


class MockTestComparisonView(BaseModel):
    mock_test_id: int
    test_version: int
    attempts: list[MockTestAttemptSummary]


class MockTestRecommendationView(BaseModel):
    weakest_skill: str | None
    recommended_test: MockTestDetailView | None


RubricScore = Annotated[StrictInt, Field(ge=0, le=10)]

class InterviewGeneratedQuestion(BaseModel):
    prompt: str = Field(min_length=1, max_length=500)
    hint: str = Field(min_length=1, max_length=300)
    rubric: str = Field(min_length=1, max_length=800)
    skill_tag: str = Field(min_length=1, max_length=100)

    @field_validator("prompt", "hint", "rubric", "skill_tag")
    @classmethod
    def trim_generated_question_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Generated question text cannot be empty")
        return value


class InterviewGeneratedQuestionList(BaseModel):
    questions: list[InterviewGeneratedQuestion] = Field(min_length=1, max_length=10)


class InterviewLLMEvaluation(BaseModel):
    relevance: RubricScore
    technical_correctness: RubricScore
    completeness: RubricScore
    communication: RubricScore
    structure: RubricScore
    feedback: str = Field(min_length=1, max_length=1200)
    strengths: list[FeedbackItem] = Field(max_length=5)
    improvements: list[FeedbackItem] = Field(max_length=5)
    follow_up_question: str | None = Field(default=None, max_length=400)

    @field_validator("feedback", mode="before")
    @classmethod
    def trim_feedback(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value

    @field_validator("strengths", "improvements", mode="before")
    @classmethod
    def trim_feedback_lists(cls, value: object) -> object:
        if not isinstance(value, list):
            return value
        return [item.strip() if isinstance(item, str) else item for item in value]

    @field_validator("follow_up_question", mode="before")
    @classmethod
    def trim_follow_up(cls, value: object) -> object:
        if isinstance(value, str):
            value = value.strip()
            return value or None
        return value

    @model_validator(mode="after")
    def reject_hiring_decisions(self) -> "InterviewLLMEvaluation":
        content = " ".join(
            [
                self.feedback,
                *self.strengths,
                *self.improvements,
                self.follow_up_question or "",
            ]
        ).casefold()
        if re.search(
            r"\b(?:hire|hiring|reject|rejection|offer|employ|employment)\b",
            content,
        ):
            raise ValueError("Evaluation must not make hiring decisions")
        return self
