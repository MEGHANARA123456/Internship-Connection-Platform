"""Persistence and state transitions for student text interview sessions."""

import asyncio
import hashlib
import logging
import time
from datetime import datetime, timedelta, timezone
from statistics import mean

from app.core.config import get_settings
from app.models import (
    InterviewAnswer,
    InterviewConsent,
    InterviewEvaluation,
    InterviewProctoringEvent,
    InterviewQuestion,
    InterviewQuestionBank,
    InterviewReport,
    InterviewSession,
    InterviewStudioUsageEvent,
    MockTest,
    MockTestCategory,
    MockTestQuestion,
    User,
)
from app.schemas.interview import (
    InterviewAttemptAnswerEvaluation,
    InterviewAnswerRecord,
    InterviewAnswerReview,
    InterviewAnswerView,
    InterviewEvaluationView,
    InterviewEvaluationRetryView,
    InterviewLLMEvaluation,
    InterviewNextQuestionView,
    InterviewProctoringEventCreate,
    InterviewProctoringEventResult,
    InterviewProctoringSummary,
    InterviewQuestionView,
    InterviewReportView,
    InterviewSessionCreate,
    InterviewSessionView,
    MockTestAttemptCreate,
)
from app.services.interview_llm import (
    InterviewAttemptLLMResult,
    InterviewLLMProvider,
    InterviewProviderError,
    generate_questions,
    get_interview_provider,
)
from app.services.interview_studio_settings import (
    get_interview_studio_setting,
    interview_studio_feature_enabled,
)
from app.services.interview_voice import (
    InterviewVoiceError,
    count_voice_metrics,
    create_audio_duration_token,
    transcribe_audio_clip,
    verify_audio_duration_token,
)
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import ValidationError

SESSIONS_PER_DAY = 5
ANSWER_MAX_LENGTH = 5000
SESSION_TIME_LIMIT_SECONDS = 20 * 60
RECENT_QUESTION_WINDOW = timedelta(days=30)
_EVALUATION_FIELDS = (
    "relevance",
    "technical_correctness",
    "completeness",
    "communication",
    "structure",
)
logger = logging.getLogger(__name__)

def _approved_question_clause():
    return InterviewQuestionBank.source_metadata["status"].as_string() == "APPROVED"


class InterviewStudioError(Exception):
    def __init__(
        self,
        status_code: int,
        code: str,
        retry_after_seconds: int | None = None,
    ):
        super().__init__(code)
        self.status_code = status_code
        self.code = code
        self.retry_after_seconds = retry_after_seconds


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


def _session_view(session: InterviewSession) -> InterviewSessionView:
    return InterviewSessionView(
        id=session.id,
        mock_test_id=session.mock_test_id,
        mock_test_version=session.mock_test_version,
        session_type=session.session_type,
        interview_mode=session.interview_mode,
        category=session.category,
        difficulty=session.difficulty,
        question_count=session.question_count,
        time_limit_seconds=session.time_limit_seconds,
        status=session.status,
        consent_acknowledged=session.consent_acknowledged,
        video_storage_consent=session.video_storage_consent,
        proctoring_consent_acknowledged=session.proctoring_consent_acknowledged,
        proctoring_max_violations=session.proctoring_max_violations,
        retake_of_session_id=session.retake_of_session_id,
        created_at=session.created_at,
        started_at=session.started_at,
        expires_at=session.expires_at,
        completed_at=session.completed_at,
    )


def _evaluation_view(evaluation: InterviewEvaluation) -> InterviewEvaluationView | None:
    if evaluation.status != "COMPLETED":
        return None
    return InterviewEvaluationView(
        relevance=evaluation.relevance,
        technical_correctness=evaluation.technical_correctness,
        completeness=evaluation.completeness,
        communication=evaluation.communication,
        structure=evaluation.structure,
        feedback=evaluation.feedback or "",
        strengths=evaluation.strengths or [],
        improvements=evaluation.improvements or [],
        score=evaluation.score,
        suggested_answer=evaluation.suggested_answer,
    )


async def _owned_session(
    db: AsyncSession,
    student_id: int,
    session_id: int,
    *,
    lock: bool = False,
) -> InterviewSession:
    statement = select(InterviewSession).where(
        InterviewSession.id == session_id,
        InterviewSession.student_id == student_id,
    )
    if lock:
        statement = statement.with_for_update()
    session = await db.scalar(statement)
    if session is None:
        raise InterviewStudioError(404, "session_not_found")
    return session


def _expire_if_due(session: InterviewSession, now: datetime) -> bool:
    if (
        session.status == "IN_PROGRESS"
        and session.expires_at is not None
        and _aware(session.expires_at) <= now
    ):
        session.status = "EXPIRED"
        return True
    return False


async def _require_in_progress(
    db: AsyncSession,
    session: InterviewSession,
    now: datetime,
) -> None:
    if _expire_if_due(session, now):
        await db.commit()
        raise InterviewStudioError(409, "session_expired")
    if session.status == "EXPIRED":
        raise InterviewStudioError(409, "session_expired")
    if session.status != "IN_PROGRESS":
        raise InterviewStudioError(409, "invalid_session_transition")


async def create_session(
    db: AsyncSession,
    student_id: int,
    request: InterviewSessionCreate,
) -> InterviewSessionView:
    now = _now()
    student = await db.scalar(
        select(User)
        .where(User.id == student_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if student is None:
        raise InterviewStudioError(404, "student_not_found")
    if request.category not in {"HR", "TECHNICAL"}:
        raise InterviewStudioError(422, "Category must be HR or TECHNICAL")
    difficulty = "INTERMEDIATE"

    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    day_end = day_start + timedelta(days=1)
    daily_count = int(
        await db.scalar(
            select(func.count(InterviewSession.id)).where(
                InterviewSession.student_id == student_id,
                InterviewSession.created_at >= day_start,
                InterviewSession.created_at < day_end,
            )
        )
        or 0
    )
    sessions_per_day = int(
        await get_interview_studio_setting(db, "sessions_per_day")
    )
    if daily_count >= sessions_per_day:
        await db.rollback()
        raise InterviewStudioError(429, "daily_session_limit_reached")
    if request.interview_mode == "VOICE" and not await interview_studio_feature_enabled(
        db, "voice_enabled"
    ):
        raise InterviewStudioError(403, "voice_mode_disabled")
    if request.interview_mode == "VIDEO":
        if not await interview_studio_feature_enabled(db, "video_enabled"):
            raise InterviewStudioError(403, "video_mode_disabled")
        if not await interview_studio_feature_enabled(db, "voice_enabled"):
            raise InterviewStudioError(403, "voice_mode_disabled")

    if request.retake_of_session_id is not None:
        await _owned_session(db, student_id, request.retake_of_session_id)

    categories = (request.category,)
    available_questions = int(
        await db.scalar(
            select(func.count(InterviewQuestionBank.id)).where(
                InterviewQuestionBank.active.is_(True),
                _approved_question_clause(),
                InterviewQuestionBank.category.in_(categories),
                InterviewQuestionBank.difficulty == difficulty,
            )
        )
        or 0
    )
    if available_questions < request.question_count:
        await db.rollback()
        raise InterviewStudioError(503, "question_bank_not_seeded")

    session = InterviewSession(
        student_id=student_id,
        session_type=request.session_type,
        interview_mode=request.interview_mode,
        category=request.category,
        difficulty=difficulty,
        question_count=request.question_count,
        time_limit_seconds=SESSION_TIME_LIMIT_SECONDS,
        status="CREATED",
        consent_acknowledged=True,
        consent_acknowledged_at=now,
        video_storage_consent=request.video_storage_consent,
        video_storage_consent_at=now if request.video_storage_consent else None,
        proctoring_max_violations=get_settings().interview_proctoring_max_violations,
        retake_of_session_id=request.retake_of_session_id,
        created_at=now,
    )
    db.add(session)
    await db.flush()

    generated_questions = None
    try:
        generated_questions = await generate_questions(
            request.category,
            difficulty,
            request.question_count,
        )
    except (InterviewProviderError, ValidationError, ValueError, TypeError, AttributeError):
        generated_questions = None

    if generated_questions:
        for position, generated in enumerate(generated_questions, start=1):
            db.add(
                InterviewQuestion(
                    session_id=session.id,
                    question_bank_id=None,
                    position=position,
                    prompt=generated.prompt,
                    hint=generated.hint,
                    rubric=generated.rubric,
                    skill_tags=[generated.skill_tag],
                    is_follow_up=False,
                    source_metadata={"source": "AI"},
                )
            )
    await db.commit()
    await db.refresh(session)
    return _session_view(session)


async def create_mock_test_session(
    db: AsyncSession,
    student_id: int,
    test_id: int,
    request: MockTestAttemptCreate,
) -> InterviewSessionView:
    now = _now()
    if request.video_storage_consent and request.interview_mode != "VIDEO":
        raise InterviewStudioError(422, "video_mode_required")
    student = await db.scalar(
        select(User)
        .where(User.id == student_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if student is None:
        raise InterviewStudioError(404, "student_not_found")
    if request.interview_mode == "VOICE" and not await interview_studio_feature_enabled(
        db, "voice_enabled"
    ):
        raise InterviewStudioError(403, "voice_mode_disabled")
    if request.interview_mode == "VIDEO":
        if not await interview_studio_feature_enabled(db, "video_enabled"):
            raise InterviewStudioError(403, "video_mode_disabled")
        if not await interview_studio_feature_enabled(db, "voice_enabled"):
            raise InterviewStudioError(403, "voice_mode_disabled")

    test_row = await db.execute(
        select(MockTest, MockTestCategory)
        .join(MockTestCategory, MockTestCategory.id == MockTest.category_id)
        .where(
            MockTest.id == test_id,
            MockTest.active.is_(True),
            MockTestCategory.active.is_(True),
        )
    )
    test_and_category = test_row.first()
    if test_and_category is None:
        raise InterviewStudioError(404, "mock_test_not_found")
    test, category = test_and_category
    category_slug = category.slug.upper()
    mapped_category = (
        "HR" if category_slug in {"HR", "BEHAVIORAL"}
        else "TECHNICAL" if category_slug in {"TECHNICAL", "DATA_SCIENCE", "DATA_ANALYST"}
        else None
    )
    if mapped_category is None:
        raise InterviewStudioError(422, "Category must be HR or TECHNICAL")

    question_rows = int(
        await db.scalar(
            select(func.count(MockTestQuestion.id))
            .join(
                InterviewQuestionBank,
                InterviewQuestionBank.id == MockTestQuestion.question_bank_id,
            )
            .where(
                MockTestQuestion.mock_test_id == test.id,
                MockTestQuestion.version == test.version,
                InterviewQuestionBank.active.is_(True),
                _approved_question_clause(),
            )
        )
        or 0
    )
    if question_rows != test.question_count:
        await db.rollback()
        raise InterviewStudioError(503, "mock_test_questions_unavailable")

    session_type = request.session_type or test.default_mode
    if request.retake_of_session_id is None:
        unstarted = await db.scalar(
            select(InterviewSession)
            .where(
                InterviewSession.student_id == student_id,
                InterviewSession.mock_test_id == test.id,
                InterviewSession.mock_test_version == test.version,
                InterviewSession.session_type == session_type,
                InterviewSession.interview_mode == request.interview_mode,
                InterviewSession.status == "CREATED",
                InterviewSession.started_at.is_(None),
                InterviewSession.retake_of_session_id.is_(None),
            )
            .order_by(InterviewSession.created_at.desc(), InterviewSession.id.desc())
            .limit(1)
            .with_for_update()
        )
        if unstarted is not None:
            return _session_view(unstarted)

    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    daily_count = int(
        await db.scalar(
            select(func.count(InterviewSession.id)).where(
                InterviewSession.student_id == student_id,
                InterviewSession.created_at >= day_start,
                InterviewSession.created_at < day_start + timedelta(days=1),
            )
        )
        or 0
    )
    sessions_per_day = int(
        await get_interview_studio_setting(db, "sessions_per_day")
    )
    if daily_count >= sessions_per_day:
        await db.rollback()
        raise InterviewStudioError(429, "daily_session_limit_reached")

    retake_of_session_id = request.retake_of_session_id
    if retake_of_session_id is not None:
        previous = await _owned_session(db, student_id, retake_of_session_id)
        if (
            previous.mock_test_id != test.id
            or previous.mock_test_version != test.version
        ):
            raise InterviewStudioError(422, "retake_test_version_mismatch")

    session = InterviewSession(
        student_id=student_id,
        mock_test_id=test.id,
        mock_test_version=test.version,
        session_type=session_type,
        interview_mode=request.interview_mode,
        category=mapped_category,
        difficulty="INTERMEDIATE",
        question_count=test.question_count,
        time_limit_seconds=min(test.time_limit_seconds, SESSION_TIME_LIMIT_SECONDS),
        status="CREATED",
        consent_acknowledged=True,
        consent_acknowledged_at=now,
        video_storage_consent=request.video_storage_consent,
        video_storage_consent_at=now if request.video_storage_consent else None,
        proctoring_max_violations=get_settings().interview_proctoring_max_violations,
        retake_of_session_id=retake_of_session_id,
        created_at=now,
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)
    return _session_view(session)


async def list_sessions(
    db: AsyncSession,
    student_id: int,
) -> list[InterviewSessionView]:
    sessions = list(
        (
            await db.scalars(
                select(InterviewSession)
                .where(InterviewSession.student_id == student_id)
                .order_by(InterviewSession.created_at.desc(), InterviewSession.id.desc())
            )
        ).all()
    )
    now = _now()
    changed = False
    for session in sessions:
        changed = _expire_if_due(session, now) or changed
    if changed:
        await db.commit()
    return [_session_view(session) for session in sessions]


async def get_session_detail(
    db: AsyncSession,
    student_id: int,
    session_id: int,
) -> dict[str, object]:
    session = await _owned_session(db, student_id, session_id, lock=True)
    if _expire_if_due(session, _now()):
        await db.commit()
    answered_question_count = int(
        await db.scalar(
            select(func.count(func.distinct(InterviewAnswer.question_id)))
            .join(InterviewQuestion, InterviewQuestion.id == InterviewAnswer.question_id)
            .where(InterviewQuestion.session_id == session.id)
        )
        or 0
    )
    return {
        "session": _session_view(session),
        "answered_question_count": answered_question_count,
    }


async def get_session_answers(
    db: AsyncSession,
    student_id: int,
    session_id: int,
) -> list[InterviewAnswerRecord]:
    session = await _owned_session(db, student_id, session_id)
    pairs = await _latest_answer_pairs(db, session.id)
    results = []
    for answer, question in pairs:
        evaluation = await db.scalar(
            select(InterviewEvaluation).where(
                InterviewEvaluation.answer_id == answer.id
            )
        )
        results.append(InterviewAnswerRecord(
            answer_id=answer.id,
            question_id=question.id,
            position=question.position,
            answer_text=answer.answer_text,
            submitted_at=answer.submitted_at,
            evaluation_status=evaluation.status if evaluation else "PENDING",
            failure_code=evaluation.failure_code if evaluation else None,
            evaluation=_evaluation_view(evaluation) if evaluation else None,
        ))
    return results


async def acknowledge_proctoring_consent(
    db: AsyncSession,
    student_id: int,
    session_id: int,
) -> InterviewSessionView:
    session = await _owned_session(db, student_id, session_id, lock=True)
    if session.interview_mode not in {"TEXT", "VIDEO"}:
        raise InterviewStudioError(422, "proctoring_not_enabled_for_mode")
    if session.status != "CREATED":
        raise InterviewStudioError(409, "invalid_session_transition")

    now = _now()
    if not session.proctoring_consent_acknowledged:
        consent_exists = await db.scalar(
            select(InterviewConsent.id).where(
                InterviewConsent.session_id == session.id,
                InterviewConsent.consent_type == "PROCTORING",
                InterviewConsent.version == "1",
            )
        )
        if consent_exists is None:
            db.add(
                InterviewConsent(
                    session_id=session.id,
                    student_id=student_id,
                    consent_type="PROCTORING",
                    version="1",
                    acknowledged_at=now,
                )
            )
        session.proctoring_consent_acknowledged = True
        session.proctoring_consent_acknowledged_at = now
        await db.commit()
        await db.refresh(session)
    return _session_view(session)


async def start_session(
    db: AsyncSession,
    student_id: int,
    session_id: int,
) -> InterviewSessionView:
    session = await _owned_session(db, student_id, session_id, lock=True)
    if session.started_at is not None:
        if session.status == "IN_PROGRESS" and _expire_if_due(session, _now()):
            await db.commit()
            await db.refresh(session)
        return _session_view(session)
    if session.status != "CREATED":
        raise InterviewStudioError(409, "invalid_session_transition")
    if (
        session.interview_mode in {"TEXT", "VIDEO"}
        and not session.proctoring_consent_acknowledged
    ):
        raise InterviewStudioError(409, "proctoring_consent_required")
    now = _now()
    session.status = "IN_PROGRESS"
    session.started_at = now
    session.expires_at = now + timedelta(seconds=session.time_limit_seconds)
    await db.commit()
    await db.refresh(session)
    return _session_view(session)


async def _next_bank_question(
    db: AsyncSession,
    session: InterviewSession,
    position: int,
    now: datetime,
) -> InterviewQuestion:
    if session.mock_test_id is not None:
        test_question_result = await db.execute(
            select(MockTestQuestion, InterviewQuestionBank)
            .join(
                InterviewQuestionBank,
                InterviewQuestionBank.id == MockTestQuestion.question_bank_id,
            )
            .where(
                MockTestQuestion.mock_test_id == session.mock_test_id,
                MockTestQuestion.version == session.mock_test_version,
                MockTestQuestion.position == position,
                InterviewQuestionBank.active.is_(True),
                _approved_question_clause(),
            )
        )
        test_question_pair = test_question_result.first()
        if test_question_pair is None:
            raise InterviewStudioError(503, "mock_test_questions_unavailable")
        test_question, bank_question = test_question_pair
        question = InterviewQuestion(
            session_id=session.id,
            question_bank_id=bank_question.id,
            position=position,
            prompt=bank_question.prompt,
            hint=bank_question.hint,
            rubric=bank_question.rubric,
            skill_tags=test_question.skill_tags,
            is_follow_up=False,
        )
        db.add(question)
        await db.flush()
        return question

    recent_question_ids = set(
        (
            await db.scalars(
                select(InterviewQuestion.question_bank_id)
                .join(
                    InterviewSession,
                    InterviewSession.id == InterviewQuestion.session_id,
                )
                .where(
                    InterviewSession.student_id == session.student_id,
                    InterviewSession.created_at >= now - RECENT_QUESTION_WINDOW,
                    InterviewQuestion.question_bank_id.is_not(None),
                )
            )
        ).all()
    )
    category = str(session.category).strip().upper()
    categories = (
        ("HR",)
        if category in {"HR", "BEHAVIORAL"}
        else ("TECHNICAL",)
        if category in {"TECHNICAL", "DATA_SCIENCE", "DATA_ANALYST"}
        else ("HR", "TECHNICAL")
    )
    base_query = select(InterviewQuestionBank).where(
        InterviewQuestionBank.active.is_(True),
        _approved_question_clause(),
        InterviewQuestionBank.category.in_(categories),
        InterviewQuestionBank.difficulty == "INTERMEDIATE",
    )
    bank_question = None
    if recent_question_ids:
        bank_question = await db.scalar(
            base_query.where(InterviewQuestionBank.id.not_in(recent_question_ids))
            .order_by(func.random())
            .limit(1)
        )
    if bank_question is None:
        bank_question = await db.scalar(base_query.order_by(func.random()).limit(1))
    if bank_question is None:
        raise InterviewStudioError(503, "question_bank_empty")

    question = InterviewQuestion(
        session_id=session.id,
        question_bank_id=bank_question.id,
        position=position,
        prompt=bank_question.prompt,
        hint=bank_question.hint,
        rubric=bank_question.rubric,
        skill_tags=[],
        is_follow_up=False,
        source_metadata={"source": "BANK"},
    )
    db.add(question)
    await db.flush()
    return question


def _question_view(
    question: InterviewQuestion,
    session: InterviewSession,
    answered_ids: set[int],
) -> InterviewQuestionView:
    return InterviewQuestionView(
        id=question.id,
        position=question.position,
        prompt=question.prompt,
        hint=question.hint if session.session_type == "PRACTICE" else None,
        is_follow_up=question.is_follow_up,
        answer_submitted=question.id in answered_ids,
    )


async def next_question(
    db: AsyncSession,
    student_id: int,
    session_id: int,
) -> InterviewNextQuestionView:
    session = await _owned_session(db, student_id, session_id, lock=True)
    await _require_in_progress(db, session, _now())
    questions = list(
        (
            await db.scalars(
                select(InterviewQuestion)
                .where(InterviewQuestion.session_id == session.id)
                .order_by(InterviewQuestion.position)
            )
        ).all()
    )
    question_ids = [question.id for question in questions]
    answered_ids = set(
        (
            await db.scalars(
                select(InterviewAnswer.question_id)
                .where(InterviewAnswer.question_id.in_(question_ids))
                .distinct()
            )
        ).all()
    ) if question_ids else set()
    current = next(
        (question for question in questions if question.id not in answered_ids),
        None,
    )
    if current is None and len(questions) < session.question_count:
        current = await _next_bank_question(db, session, len(questions) + 1, _now())
    session.current_question_position = current.position if current else None
    await db.commit()
    if current is not None:
        await db.refresh(current)

    return InterviewNextQuestionView(
        session_status=session.status,
        question=_question_view(current, session, answered_ids) if current else None,
        question_limit_reached=current is None and len(questions) >= session.question_count,
    )


async def _get_question(
    db: AsyncSession,
    session_id: int,
    question_id: int,
) -> InterviewQuestion:
    question = await db.scalar(
        select(InterviewQuestion).where(
            InterviewQuestion.id == question_id,
            InterviewQuestion.session_id == session_id,
        )
    )
    if question is None:
        raise InterviewStudioError(404, "question_not_found")
    return question


def _apply_evaluation(
    evaluation: InterviewEvaluation,
    result: InterviewLLMEvaluation,
    provider_name: str,
    model_name: str,
) -> None:
    for field in _EVALUATION_FIELDS:
        setattr(evaluation, field, getattr(result, field))
    evaluation.feedback = result.feedback
    evaluation.strengths = result.strengths
    evaluation.improvements = result.improvements
    evaluation.status = "COMPLETED"
    evaluation.failure_code = None
    evaluation.provider_name = provider_name
    evaluation.model_name = model_name
    evaluation.evaluating_at = None
    evaluation.evaluated_at = _now()


def _apply_attempt_evaluation(
    evaluation: InterviewEvaluation,
    result: InterviewAttemptAnswerEvaluation,
    provider_name: str,
    model_name: str,
) -> None:
    evaluation.relevance = None
    evaluation.technical_correctness = None
    evaluation.completeness = None
    evaluation.communication = None
    evaluation.structure = None
    evaluation.score = result.score
    evaluation.feedback = ""
    evaluation.strengths = result.strengths
    evaluation.improvements = result.improvements
    evaluation.suggested_answer = result.suggested_answer
    evaluation.status = "COMPLETED"
    evaluation.failure_code = None
    evaluation.provider_name = provider_name
    evaluation.model_name = model_name
    evaluation.evaluating_at = None
    evaluation.evaluated_at = _now()


def _add_llm_usage_event(
    db: AsyncSession,
    *,
    status: str,
    duration_ms: int,
    prompt_tokens: int = 0,
    completion_tokens: int = 0,
    retry_count: int = 0,
    error_code: str | None = None,
    provider_name: str | None = None,
    session_id: int | None = None,
    answer_id: int | None = None,
    http_status: int | None = None,
) -> None:
    db.add(
        InterviewStudioUsageEvent(
            event_type="LLM",
            status=status,
            duration_ms=max(0, duration_ms),
            prompt_tokens=max(0, prompt_tokens),
            completion_tokens=max(0, completion_tokens),
            retry_count=max(0, retry_count),
            error_code=error_code,
            provider_name=provider_name,
            session_id=session_id,
            answer_id=answer_id,
            http_status=http_status,
        )
    )


async def submit_answer(
    db: AsyncSession,
    student_id: int,
    session_id: int,
    question_id: int,
    answer_text: str,
    provider: InterviewLLMProvider | None = None,
    audio_duration_token: str | None = None,
) -> InterviewAnswerView:
    answer_text = answer_text.strip()
    if not answer_text:
        raise InterviewStudioError(422, "answer_empty")
    if len(answer_text) > ANSWER_MAX_LENGTH:
        raise InterviewStudioError(422, "answer_too_long")

    session = await _owned_session(db, student_id, session_id, lock=True)
    await _require_in_progress(db, session, _now())
    question = await _get_question(db, session.id, question_id)
    if (
        session.interview_mode in {"VOICE", "VIDEO"}
        and session.current_question_position != question.position
    ):
        raise InterviewStudioError(409, "question_not_current")
    duration_seconds = None
    if audio_duration_token is not None:
        if session.interview_mode not in {"VOICE", "VIDEO"}:
            raise InterviewStudioError(422, "audio_duration_not_allowed")
        try:
            duration_seconds = verify_audio_duration_token(
                audio_duration_token,
                student_id=student_id,
                session_id=session.id,
                question_id=question.id,
            )
        except InterviewVoiceError as error:
            raise InterviewStudioError(error.status_code, error.code) from error
    metrics = (
        count_voice_metrics(answer_text, duration_seconds)
        if session.interview_mode in {"VOICE", "VIDEO"}
        else {
            "word_count": None,
            "speaking_pace_wpm": None,
            "filler_word_count": None,
        }
    )
    session_type = session.session_type
    assessment_slot = 1 if session_type == "ASSESSMENT" else None
    answer = InterviewAnswer(
        question_id=question.id,
        answer_text=answer_text,
        assessment_slot=assessment_slot,
        duration_seconds=duration_seconds,
        word_count=metrics["word_count"],
        speaking_pace_wpm=metrics["speaking_pace_wpm"],
        filler_word_count=metrics["filler_word_count"],
        submitted_at=_now(),
    )
    pending_previous_evaluations = (
        await db.scalars(
            select(InterviewEvaluation)
            .join(InterviewAnswer, InterviewAnswer.id == InterviewEvaluation.answer_id)
            .where(
                InterviewAnswer.question_id == question.id,
                InterviewEvaluation.status.in_(("PENDING", "EVALUATING", "COMPLETED")),
            )
            .with_for_update()
        )
    ).all()
    for previous_evaluation in pending_previous_evaluations:
        previous_evaluation.status = "FAILED"
        previous_evaluation.failure_code = "answer_superseded"
        previous_evaluation.evaluating_at = None
        previous_evaluation.evaluated_at = _now()
    db.add(answer)
    try:
        await db.flush()
        evaluation = InterviewEvaluation(answer_id=answer.id, status="PENDING")
        db.add(evaluation)
        await db.commit()
    except IntegrityError:
        await db.rollback()
        if session_type == "ASSESSMENT":
            raise InterviewStudioError(409, "assessment_answer_already_submitted") from None
        raise
    await db.refresh(answer)
    return InterviewAnswerView(answer_id=answer.id, evaluation_status="PENDING")


async def transcribe_voice_answer(
    db: AsyncSession,
    student_id: int,
    session_id: int,
    question_id: int,
    audio: bytes,
    content_type: str,
) -> dict[str, object]:
    session = await _owned_session(db, student_id, session_id, lock=True)
    await _require_in_progress(db, session, _now())
    if session.interview_mode not in {"VOICE", "VIDEO"}:
        raise InterviewStudioError(409, "voice_mode_required")
    if not await interview_studio_feature_enabled(db, "voice_enabled"):
        raise InterviewStudioError(403, "voice_mode_disabled")
    if session.interview_mode == "VIDEO" and not await interview_studio_feature_enabled(
        db, "video_enabled"
    ):
        raise InterviewStudioError(403, "video_mode_disabled")
    question = await _get_question(db, session.id, question_id)
    if session.current_question_position != question.position:
        raise InterviewStudioError(409, "question_not_current")
    await db.commit()
    started = time.perf_counter()
    try:
        transcript, duration_seconds = await transcribe_audio_clip(audio, content_type)
    except InterviewVoiceError as error:
        db.add(
            InterviewStudioUsageEvent(
                event_type="STT",
                status="FAILED",
                duration_ms=max(0, round((time.perf_counter() - started) * 1000)),
                error_code=error.code,
            )
        )
        await db.commit()
        raise InterviewStudioError(error.status_code, error.code) from error
    db.add(
        InterviewStudioUsageEvent(
            event_type="STT",
            status="SUCCEEDED",
            duration_ms=max(0, round((time.perf_counter() - started) * 1000)),
            audio_seconds=max(0.0, duration_seconds),
        )
    )
    await db.commit()
    session = await _owned_session(db, student_id, session_id, lock=True)
    await _require_in_progress(db, session, _now())
    question = await _get_question(db, session.id, question_id)
    if session.current_question_position != question.position:
        raise InterviewStudioError(409, "question_not_current")
    return {
        "transcript": transcript,
        "duration_seconds": duration_seconds,
        "duration_token": create_audio_duration_token(
            duration_seconds,
            student_id=student_id,
            session_id=session.id,
            question_id=question.id,
        ),
    }


async def _latest_answer_pairs(
    db: AsyncSession,
    session_id: int,
) -> list[tuple[InterviewAnswer, InterviewQuestion]]:
    rows = (
        await db.execute(
            select(InterviewAnswer, InterviewQuestion)
            .join(
                InterviewQuestion,
                InterviewQuestion.id == InterviewAnswer.question_id,
            )
            .where(InterviewQuestion.session_id == session_id)
            .order_by(
                InterviewQuestion.position,
                InterviewAnswer.submitted_at.desc(),
                InterviewAnswer.id.desc(),
            )
        )
    ).all()
    latest: dict[int, tuple[InterviewAnswer, InterviewQuestion]] = {}
    for answer, question in rows:
        latest.setdefault(question.id, (answer, question))
    return list(latest.values())


async def _report_view(
    db: AsyncSession,
    session: InterviewSession,
    report: InterviewReport,
) -> InterviewReportView:
    reviews = []
    latest_pairs = await _latest_answer_pairs(db, session.id)
    for answer, question in latest_pairs:
        evaluation = await db.scalar(
            select(InterviewEvaluation).where(
                InterviewEvaluation.answer_id == answer.id
            )
        )
        reviews.append(
            InterviewAnswerReview(
                question_id=question.id,
                position=question.position,
                prompt=question.prompt,
                answer_text=answer.answer_text,
                skill_tags=question.skill_tags,
                evaluation_status=evaluation.status if evaluation else "PENDING",
                failure_code=evaluation.failure_code if evaluation else None,
                evaluation=_evaluation_view(evaluation) if evaluation else None,
                duration_seconds=answer.duration_seconds,
                word_count=answer.word_count,
                speaking_pace_wpm=answer.speaking_pace_wpm,
                filler_word_count=answer.filler_word_count,
            )
        )
    voice_answers = (
        [answer for answer, _question in latest_pairs]
        if session.interview_mode in {"VOICE", "VIDEO"}
        else []
    )
    duration_answers = [
        answer for answer in voice_answers
        if answer.duration_seconds is not None and answer.duration_seconds > 0
    ]
    total_duration = sum(answer.duration_seconds or 0 for answer in duration_answers)
    total_word_count = sum(answer.word_count or 0 for answer in voice_answers)
    measured_word_count = sum(answer.word_count or 0 for answer in duration_answers)
    proctoring_summary = await get_proctoring_summary(db, session.id)
    return InterviewReportView(
        session_id=session.id,
        status=report.status,
        overall_score=report.overall_score,
        rubric_scores=report.rubric_scores,
        answer_count=report.answer_count,
        summary=report.summary,
        top_strengths=report.top_strengths or [],
        top_improvements=report.top_improvements or [],
        next_steps=report.next_steps or [],
        failure_code=report.failure_code,
        evaluations=reviews,
        skill_breakdown=report.skill_breakdown,
        voice_metrics={
            "total_duration_seconds": round(total_duration, 2),
            "total_word_count": total_word_count,
            "average_speaking_pace_wpm": (
                round(measured_word_count * 60 / total_duration, 2)
                if total_duration > 0
                else None
            ),
            "total_filler_word_count": sum(
                answer.filler_word_count or 0 for answer in voice_answers
            ),
        } if session.interview_mode in {"VOICE", "VIDEO"} else None,
        video_metrics=(
            {
                "session_duration_seconds": round(
                    max(
                        0.0,
                        (
                            _aware(
                                session.completed_at
                                or report.completed_at
                                or report.created_at
                            )
                            - _aware(session.started_at)
                        ).total_seconds(),
                    ),
                    2,
                )
            }
            if session.interview_mode == "VIDEO" and session.started_at is not None
            else None
        ),
        proctoring_summary=proctoring_summary,
    )


async def get_proctoring_summary(
    db: AsyncSession,
    session_id: int,
) -> InterviewProctoringSummary:
    events = list(
        (
            await db.scalars(
                select(InterviewProctoringEvent).where(
                    InterviewProctoringEvent.session_id == session_id
                )
            )
        ).all()
    )
    counts: dict[str, int] = {}
    total_time_away_ms = 0
    for event in events:
        total_time_away_ms += int(
            (event.event_metadata or {}).get("duration_away_ms") or 0
        )
        if event.event_type == "FOCUS_RETURN":
            continue
        counts[event.event_type] = counts.get(event.event_type, 0) + 1
    return InterviewProctoringSummary(
        violation_count=sum(counts.values()),
        types=counts,
        total_time_away_ms=total_time_away_ms,
    )


async def record_proctoring_event(
    db: AsyncSession,
    student_id: int,
    session_id: int,
    request: InterviewProctoringEventCreate,
) -> InterviewProctoringEventResult:
    session = await _owned_session(db, student_id, session_id, lock=True)
    if session.interview_mode not in {"TEXT", "VIDEO"}:
        raise InterviewStudioError(422, "proctoring_not_enabled_for_mode")
    if session.status != "IN_PROGRESS" and not (
        session.status == "TERMINATED" and request.event_type == "FOCUS_RETURN"
    ):
        raise InterviewStudioError(
            409,
            "proctoring_session_terminated"
            if session.status == "TERMINATED"
            else "invalid_session_transition",
        )

    event_metadata = {
        "question_index": request.question_index,
        "duration_away_ms": request.duration_away_ms,
    }
    if request.event_type == "FOCUS_RETURN":
        pending_focus_events = list(
            (
                await db.scalars(
                    select(InterviewProctoringEvent)
                    .where(
                        InterviewProctoringEvent.session_id == session.id,
                        InterviewProctoringEvent.event_type.in_(
                            ("TAB_HIDDEN", "WINDOW_BLUR")
                        ),
                    )
                    .order_by(InterviewProctoringEvent.id.desc())
                    .limit(20)
                )
            ).all()
        )
        pending_event = next(
            (
                event
                for event in pending_focus_events
                if (event.event_metadata or {}).get("duration_away_ms") is None
            ),
            None,
        )
        if pending_event is not None:
            pending_event.event_metadata = {
                **(pending_event.event_metadata or {}),
                "duration_away_ms": request.duration_away_ms,
            }
        else:
            db.add(
                InterviewProctoringEvent(
                    session_id=session.id,
                    user_id=student_id,
                    event_type=request.event_type,
                    occurred_at=_aware(request.occurred_at),
                    event_metadata=event_metadata,
                )
            )
    else:
        db.add(
            InterviewProctoringEvent(
                session_id=session.id,
                user_id=student_id,
                event_type=request.event_type,
                occurred_at=_aware(request.occurred_at),
                event_metadata=event_metadata,
            )
        )
    await db.flush()
    violation_count = int(
        await db.scalar(
            select(func.count(InterviewProctoringEvent.id)).where(
                InterviewProctoringEvent.session_id == session.id,
                InterviewProctoringEvent.event_type != "FOCUS_RETURN",
            )
        )
        or 0
    )
    terminated = session.status == "TERMINATED" or (
        violation_count >= session.proctoring_max_violations
    )
    if terminated and session.status != "TERMINATED":
        session.status = "TERMINATED"
        session.completed_at = _now()
        report = await db.scalar(
            select(InterviewReport).where(
                InterviewReport.session_id == session.id
            )
        )
        if report is None:
            report = InterviewReport(session_id=session.id, status="FAILED")
            db.add(report)
        report.status = "FAILED"
        report.failure_code = "proctoring_violations"
        report.answer_count = len(await _latest_answer_pairs(db, session.id))
        report.summary = "Interview ended after proctoring violations."
        report.completed_at = session.completed_at
    await db.commit()
    return InterviewProctoringEventResult(
        violation_count=violation_count,
        max_violations=session.proctoring_max_violations,
        terminated=terminated,
    )


def _complete_report(
    report: InterviewReport,
    session: InterviewSession,
    evaluated: list[InterviewEvaluation],
    pairs: list[tuple[InterviewAnswer, InterviewQuestion]],
) -> None:
    report.overall_score, report.rubric_scores = deterministic_overall_score(evaluated)
    evaluation_by_answer = {evaluation.answer_id: evaluation for evaluation in evaluated}
    skill_scores: dict[str, list[float]] = {}
    for answer, question in pairs:
        evaluation = evaluation_by_answer.get(answer.id)
        if evaluation is None or not question.skill_tags:
            continue
        score = round(
            sum(getattr(evaluation, field) or 0 for field in _EVALUATION_FIELDS) * 2,
            2,
        )
        for tag in question.skill_tags:
            skill_scores.setdefault(tag, []).append(score)
    report.skill_breakdown = {
        tag: round(mean(scores), 2)
        for tag, scores in sorted(skill_scores.items())
    }
    report.answer_count = len(evaluated)
    report.summary = (
        f"Feedback is ready for {len(evaluated)} answer(s). "
        "Use the per-answer notes to choose a practice focus."
    )
    report.status = "COMPLETED"
    report.failure_code = None
    report.completed_at = _now()
    session.status = "COMPLETED"
    session.completed_at = report.completed_at


def _answer_hash(answer_text: str) -> str:
    return hashlib.sha256(answer_text.encode("utf-8")).hexdigest()


async def recover_stuck_evaluations(db: AsyncSession) -> int:
    cutoff = _now() - timedelta(minutes=3)
    result = await db.execute(
        update(InterviewEvaluation)
        .where(
            InterviewEvaluation.status == "EVALUATING",
            InterviewEvaluation.evaluating_at < cutoff,
        )
        .values(status="PENDING", evaluating_at=None)
    )
    await db.commit()
    return result.rowcount or 0


async def _claim_pending_evaluation_batch() -> tuple[
    int,
    list[tuple[InterviewEvaluation, InterviewAnswer, InterviewQuestion]],
    list[dict[str, object]],
] | None:
    from app.core.database import async_session_factory

    async with async_session_factory() as db:
        latest_answer_id = (
            select(InterviewAnswer.id)
            .where(InterviewAnswer.question_id == InterviewQuestion.id)
            .order_by(
                InterviewAnswer.submitted_at.desc(),
                InterviewAnswer.id.desc(),
            )
            .limit(1)
            .correlate(InterviewQuestion)
            .scalar_subquery()
        )
        candidate = (
            await db.execute(
                select(InterviewSession.id)
                .join(InterviewQuestion, InterviewQuestion.session_id == InterviewSession.id)
                .join(InterviewAnswer, InterviewAnswer.question_id == InterviewQuestion.id)
                .join(InterviewEvaluation, InterviewEvaluation.answer_id == InterviewAnswer.id)
                .where(
                    InterviewSession.consent_acknowledged.is_(True),
                    InterviewSession.status.in_(
                        ("EVALUATION_PENDING", "EVALUATION_FAILED")
                    ),
                    InterviewAnswer.id == latest_answer_id,
                    InterviewEvaluation.status == "PENDING",
                )
                .order_by(InterviewEvaluation.created_at, InterviewEvaluation.id)
                .with_for_update(skip_locked=True)
                .limit(1)
            )
        ).first()
        if candidate is None:
            return None
        session_id = candidate[0]

        rows_query = (
            select(InterviewEvaluation, InterviewAnswer, InterviewQuestion)
            .join(InterviewAnswer, InterviewAnswer.id == InterviewEvaluation.answer_id)
            .join(InterviewQuestion, InterviewQuestion.id == InterviewAnswer.question_id)
            .where(
                InterviewQuestion.session_id == session_id,
                InterviewEvaluation.status == "PENDING",
            )
        )
        rows_query = rows_query.where(InterviewAnswer.id == latest_answer_id)
        rows = (
            await db.execute(
                rows_query.order_by(
                    InterviewEvaluation.created_at,
                    InterviewEvaluation.id,
                ).with_for_update(skip_locked=True)
            )
        ).all()
        selected = []
        for evaluation, answer, question in rows:
            evaluation.status = "EVALUATING"
            evaluation.evaluating_at = _now()
            evaluation.answer_hash = _answer_hash(answer.answer_text)
            selected.append((evaluation, answer, question))
        if not selected:
            return None

        pending_answer_ids = {answer.id for _evaluation, answer, _question in selected}
        prior_evaluations: list[dict[str, object]] = []
        for answer, question in await _latest_answer_pairs(db, session_id):
            if answer.id in pending_answer_ids:
                continue
            evaluation = await db.scalar(
                select(InterviewEvaluation).where(
                    InterviewEvaluation.answer_id == answer.id,
                    InterviewEvaluation.status == "COMPLETED",
                )
            )
            if evaluation is None:
                continue
            score = evaluation.score
            if score is None:
                available_scores = [
                    getattr(evaluation, field)
                    for field in _EVALUATION_FIELDS
                    if getattr(evaluation, field) is not None
                ]
                score = round(mean(available_scores)) if available_scores else 0
            prior_evaluations.append(
                {
                    "question_id": question.id,
                    "score": score,
                    "strengths": evaluation.strengths or [],
                    "improvements": evaluation.improvements or [],
                    "suggested_answer": evaluation.suggested_answer or "",
                }
            )
        await db.commit()
        return session_id, selected, prior_evaluations


async def _finish_report_if_ready(session_id: int) -> None:
    from app.core.database import async_session_factory

    async with async_session_factory() as db:
        session = await db.get(InterviewSession, session_id, with_for_update=True)
        if session is None or session.status not in {
            "EVALUATION_PENDING",
            "EVALUATION_FAILED",
        }:
            return
        report = await db.scalar(
            select(InterviewReport).where(InterviewReport.session_id == session_id)
        )
        if report is None or report.status == "COMPLETED":
            return
        pairs = await _latest_answer_pairs(db, session_id)
        evaluations = []
        for answer, _question in pairs:
            evaluation = await db.scalar(
                select(InterviewEvaluation).where(
                    InterviewEvaluation.answer_id == answer.id
                )
            )
            if evaluation is None:
                return
            evaluations.append(evaluation)
        report.answer_count = len(pairs)
        if any(item.status in {"PENDING", "EVALUATING"} for item in evaluations):
            report.status = "PENDING"
            session.status = "EVALUATION_PENDING"
            await db.commit()
            return
        failures = [item for item in evaluations if item.status == "FAILED"]
        if failures:
            report.status = "FAILED"
            report.failure_code = failures[0].failure_code or "evaluation_failed"
            report.overall_score = None
            report.rubric_scores = None
            report.skill_breakdown = None
            report.summary = None
            session.status = "EVALUATION_FAILED"
            session.completed_at = None
        else:
            _complete_report(report, session, evaluations, pairs)
        await db.commit()


async def _process_attempt_evaluation_batch(
    provider: InterviewLLMProvider,
    session_id: int,
    items: list[tuple[InterviewEvaluation, InterviewAnswer, InterviewQuestion]],
    prior_evaluations: list[dict[str, object]],
) -> None:
    started = time.perf_counter()
    request_items = [
        {
            "question_id": question.id,
            "question": question.prompt,
            "rubric": question.rubric,
            "answer": answer.answer_text,
            "transcript_stats": {
                "duration_seconds": answer.duration_seconds,
                "word_count": answer.word_count,
                "speaking_pace_wpm": answer.speaking_pace_wpm,
                "filler_word_count": answer.filler_word_count,
            },
        }
        for _evaluation, answer, question in items
    ]
    try:
        evaluate_attempt = getattr(provider, "evaluate_attempt_with_usage", None)
        if not callable(evaluate_attempt):
            raise InterviewProviderError(
                "provider_not_configured",
                provider=getattr(provider, "active_provider_name", None),
                model=getattr(provider, "active_model_name", None)
                or getattr(provider, "model_name", None),
            )
        outcome: InterviewAttemptLLMResult = await evaluate_attempt(
            request_items,
            attempt_id=session_id,
            prior_evaluations=prior_evaluations,
        )
        if outcome.report is None:
            raise InterviewProviderError(
                "invalid_model_output",
                provider=getattr(provider, "active_provider_name", None),
                model=getattr(provider, "active_model_name", None),
            )
        expected_question_ids = {question.id for _evaluation, _answer, question in items}
        returned_question_ids = [result.question_id for result in outcome.answers]
        if (
            len(returned_question_ids) != len(expected_question_ids)
            or set(returned_question_ids) != expected_question_ids
        ):
            raise InterviewProviderError(
                "invalid_model_output",
                provider=getattr(provider, "active_provider_name", None),
                model=getattr(provider, "active_model_name", None),
            )
    except InterviewProviderError as error:
        duration_ms = round((time.perf_counter() - started) * 1000)
        from app.core.database import async_session_factory

        async with async_session_factory() as db:
            session = await db.get(InterviewSession, session_id, with_for_update=True)
            if session is None:
                return
            for claimed_evaluation, answer, _question in items:
                current = await db.get(
                    InterviewEvaluation,
                    claimed_evaluation.id,
                    with_for_update=True,
                )
                if current is None or current.status != "EVALUATING":
                    continue
                current.status = "FAILED"
                current.failure_code = error.failure_code
                current.provider_name = error.provider
                current.model_name = error.model
                current.evaluating_at = None
                current.evaluated_at = _now()
            report = await db.scalar(
                select(InterviewReport)
                .where(InterviewReport.session_id == session_id)
                .with_for_update()
            )
            evaluation_statuses = list(
                (
                    await db.scalars(
                        select(InterviewEvaluation.status)
                        .join(
                            InterviewAnswer,
                            InterviewAnswer.id == InterviewEvaluation.answer_id,
                        )
                        .join(
                            InterviewQuestion,
                            InterviewQuestion.id == InterviewAnswer.question_id,
                        )
                        .where(InterviewQuestion.session_id == session_id)
                    )
                ).all()
            )
            pending_work = any(
                status in {"PENDING", "EVALUATING"}
                for status in evaluation_statuses
            )
            if report is not None:
                report.answer_count = len(await _latest_answer_pairs(db, session_id))
                if pending_work:
                    report.status = "PENDING"
                    session.status = "EVALUATION_PENDING"
                else:
                    report.status = "FAILED"
                    report.failure_code = error.failure_code
                    report.overall_score = None
                    report.rubric_scores = None
                    report.skill_breakdown = None
                    report.summary = None
                    report.top_strengths = None
                    report.top_improvements = None
                    report.next_steps = None
                    session.status = "EVALUATION_FAILED"
                    session.completed_at = None
            _add_llm_usage_event(
                db,
                status="FAILED",
                duration_ms=duration_ms,
                retry_count=error.retry_count,
                error_code=error.failure_code,
                provider_name=error.provider,
                session_id=session_id,
                http_status=error.http_status,
            )
            await db.commit()
        return

    result_by_question_id = {
        result.question_id: result
        for result in outcome.answers
    }

    duration_ms = round((time.perf_counter() - started) * 1000)
    from app.core.database import async_session_factory

    async with async_session_factory() as db:
        session = await db.get(InterviewSession, session_id, with_for_update=True)
        if session is None:
            return
        report = await db.scalar(
            select(InterviewReport)
            .where(InterviewReport.session_id == session_id)
            .with_for_update()
        )
        if report is None:
            report = InterviewReport(
                session_id=session_id,
                status="PENDING",
                answer_count=len(await _latest_answer_pairs(db, session_id)),
            )
            db.add(report)

        for claimed_evaluation, _answer, question in items:
            evaluation = await db.get(
                InterviewEvaluation,
                claimed_evaluation.id,
                with_for_update=True,
            )
            if evaluation is None or evaluation.status != "EVALUATING":
                continue
            result = result_by_question_id[question.id]
            source = outcome.answer_providers.get(question.id)
            provider_name, model_name = source or (
                getattr(provider, "active_provider_name", None) or "custom",
                getattr(provider, "active_model_name", None)
                or getattr(provider, "model_name", "unknown"),
            )
            _apply_attempt_evaluation(
                evaluation,
                result,
                provider_name,
                model_name,
            )

        pairs = await _latest_answer_pairs(db, session_id)
        evaluations_by_answer = {
            evaluation.answer_id: evaluation
            for evaluation in (
                await db.scalars(
                    select(InterviewEvaluation)
                    .join(
                        InterviewAnswer,
                        InterviewAnswer.id == InterviewEvaluation.answer_id,
                    )
                    .join(
                        InterviewQuestion,
                        InterviewQuestion.id == InterviewAnswer.question_id,
                    )
                    .where(InterviewQuestion.session_id == session_id)
                )
            ).all()
        }
        all_evaluated = all(
            answer.id in evaluations_by_answer
            and evaluations_by_answer[answer.id].status == "COMPLETED"
            for answer, _question in pairs
        )
        report.answer_count = len(pairs)
        if all_evaluated and len(outcome.answers) == len(items):
            report.status = "COMPLETED"
            report.overall_score = outcome.report.overall_score
            report.rubric_scores = None
            report.summary = outcome.report.summary
            report.top_strengths = outcome.report.top_strengths
            report.top_improvements = outcome.report.top_improvements
            report.next_steps = outcome.report.next_steps
            report.failure_code = None
            report.completed_at = _now()
            skill_scores: dict[str, list[float]] = {}
            for answer, question in pairs:
                evaluation = evaluations_by_answer[answer.id]
                if evaluation.score is None:
                    continue
                for tag in question.skill_tags or []:
                    skill_scores.setdefault(tag, []).append(evaluation.score * 10)
            report.skill_breakdown = {
                tag: round(mean(scores), 2)
                for tag, scores in sorted(skill_scores.items())
            }
            session.status = "COMPLETED"
            session.completed_at = report.completed_at
        else:
            report.status = "PENDING"
            session.status = "EVALUATION_PENDING"
            session.completed_at = None

        provider_name = next(
            (
                name
                for name, _model in outcome.answer_providers.values()
            ),
            provider.active_provider_name,
        )
        _add_llm_usage_event(
            db,
            status="SUCCEEDED",
            duration_ms=duration_ms,
            prompt_tokens=outcome.prompt_tokens,
            completion_tokens=outcome.completion_tokens,
            retry_count=outcome.retry_count,
            provider_name=provider_name,
            session_id=session_id,
        )
        await db.commit()


async def process_pending_evaluation_batch(
    provider: InterviewLLMProvider | None = None,
) -> bool:
    claimed = await _claim_pending_evaluation_batch()
    if claimed is None:
        return False
    session_id, items, prior_evaluations = claimed
    provider = provider or get_interview_provider()
    await _process_attempt_evaluation_batch(
        provider,
        session_id,
        items,
        prior_evaluations,
    )
    return True


async def interview_evaluation_worker() -> None:
    while True:
        try:
            processed = await process_pending_evaluation_batch()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Interview evaluation worker iteration failed.")
            processed = False
        if not processed:
            await asyncio.sleep(1)


async def complete_session(
    db: AsyncSession,
    student_id: int,
    session_id: int,
) -> InterviewReportView:
    session = await _owned_session(db, student_id, session_id, lock=True)
    if session.status == "IN_PROGRESS":
        await _require_in_progress(db, session, _now())
    elif session.status not in {
        "EVALUATION_PENDING",
        "EVALUATION_FAILED",
        "COMPLETED",
    }:
        raise InterviewStudioError(409, "invalid_session_transition")

    report = await db.scalar(
        select(InterviewReport).where(InterviewReport.session_id == session.id)
    )
    if report is None:
        pairs = await _latest_answer_pairs(db, session.id)
        if not pairs:
            raise InterviewStudioError(422, "no_answers_to_evaluate")
        for answer, _question in pairs:
            evaluation = await db.scalar(
                select(InterviewEvaluation).where(
                    InterviewEvaluation.answer_id == answer.id
                )
            )
            if evaluation is None:
                db.add(InterviewEvaluation(answer_id=answer.id, status="PENDING"))
        session.status = "EVALUATION_PENDING"
        report = InterviewReport(
            session_id=session.id,
            status="PENDING",
            answer_count=len(pairs),
        )
        db.add(report)
        await db.commit()
        await db.refresh(report)
    await _finish_report_if_ready(session.id)
    await db.refresh(report)
    await db.refresh(session)
    return await _report_view(db, session, report)


async def get_report(
    db: AsyncSession,
    student_id: int,
    session_id: int,
) -> InterviewReportView:
    session = await _owned_session(db, student_id, session_id, lock=True)
    if _expire_if_due(session, _now()):
        await db.commit()
    report = await db.scalar(
        select(InterviewReport).where(InterviewReport.session_id == session.id)
    )
    if report is None:
        raise InterviewStudioError(404, "report_not_found")
    return await _report_view(db, session, report)


async def retry_evaluation(
    db: AsyncSession,
    student_id: int,
    session_id: int,
    retryable_failure_codes: tuple[str, ...] | None = None,
) -> InterviewEvaluationRetryView:
    session = await _owned_session(db, student_id, session_id, lock=True)
    await _require_not_expired(db, session)
    if session.status not in {
        "IN_PROGRESS",
        "EVALUATION_PENDING",
        "EVALUATION_FAILED",
        "COMPLETED",
    }:
        raise InterviewStudioError(409, "invalid_session_transition")
    pairs = await _latest_answer_pairs(db, session.id)
    if not pairs:
        raise InterviewStudioError(422, "no_answers_to_evaluate")

    queued = evaluated = failed = 0
    for answer, _question in pairs:
        evaluation = await db.scalar(
            select(InterviewEvaluation)
            .where(InterviewEvaluation.answer_id == answer.id)
            .with_for_update()
        )
        if evaluation is None:
            evaluation = InterviewEvaluation(answer_id=answer.id, status="PENDING")
            db.add(evaluation)
            queued += 1
        elif evaluation.status == "COMPLETED":
            current_hash = _answer_hash(answer.answer_text)
            if evaluation.answer_hash in {None, current_hash}:
                evaluation.answer_hash = current_hash
                evaluated += 1
            else:
                evaluation.status = "PENDING"
                evaluation.answer_hash = current_hash
                evaluation.failure_code = None
                queued += 1
        elif evaluation.status == "FAILED":
            if (
                retryable_failure_codes is None
                or evaluation.failure_code in retryable_failure_codes
            ):
                evaluation.status = "PENDING"
                evaluation.failure_code = None
                evaluation.evaluating_at = None
                queued += 1
            else:
                failed += 1
        else:
            queued += 1

    report = await db.scalar(
        select(InterviewReport).where(InterviewReport.session_id == session.id)
    )
    if report is not None and queued:
        report.status = "PENDING"
        report.failure_code = None
        report.overall_score = None
        report.rubric_scores = None
        report.skill_breakdown = None
        report.summary = None
        report.top_strengths = None
        report.top_improvements = None
        report.next_steps = None
        session.status = "EVALUATION_PENDING"
        session.completed_at = None
    await db.commit()
    return InterviewEvaluationRetryView(
        queued=queued,
        evaluated=evaluated,
        failed=failed,
    )


async def _require_not_expired(
    db: AsyncSession,
    session: InterviewSession,
) -> None:
    if _expire_if_due(session, _now()):
        await db.commit()
        raise InterviewStudioError(409, "session_expired")


async def delete_session(
    db: AsyncSession,
    student_id: int,
    session_id: int,
) -> None:
    session = await _owned_session(db, student_id, session_id, lock=True)
    from app.models import InterviewRecording

    recordings = list(
        await db.scalars(
            select(InterviewRecording).where(
                InterviewRecording.session_id == session.id
            )
        )
    )
    from app.services.interview_video import (
        process_recording_deletions,
        queue_recording_deletions,
    )

    await queue_recording_deletions(db, recordings)
    await db.delete(session)
    await db.commit()
    await process_recording_deletions(db)


def deterministic_overall_score(
    evaluations: list[InterviewEvaluation],
) -> tuple[float, dict[str, float]]:
    if not evaluations:
        raise ValueError("At least one completed evaluation is required.")
    if any(
        getattr(evaluation, field) is None
        for evaluation in evaluations
        for field in _EVALUATION_FIELDS
    ):
        raise ValueError("Completed evaluations must include all rubric scores.")
    rubric_scores = {
        field: round(mean(getattr(evaluation, field) for evaluation in evaluations), 1)
        for field in _EVALUATION_FIELDS
    }
    overall_score = round(
        sum(
            getattr(evaluation, field)
            for evaluation in evaluations
            for field in _EVALUATION_FIELDS
        )
        / (len(evaluations) * len(_EVALUATION_FIELDS))
        * 10,
        1,
    )
    return overall_score, rubric_scores


