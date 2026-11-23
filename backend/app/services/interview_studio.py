"""Persistence and state transitions for student text interview sessions."""

import asyncio
import time
from datetime import datetime, timedelta, timezone
from statistics import mean

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import ValidationError

from app.core.config import get_settings
from app.models import (
    InterviewAnswer,
    InterviewConsent,
    InterviewEvaluation,
    InterviewQuestion,
    InterviewQuestionBank,
    InterviewProctoringEvent,
    InterviewReport,
    InterviewSession,
    InterviewStudioDifficulty,
    InterviewStudioUsageEvent,
    MockTest,
    MockTestCategory,
    MockTestQuestion,
    User,
)
from app.schemas.interview import (
    InterviewAnswerRecord,
    InterviewAnswerView,
    InterviewAnswerReview,
    InterviewEvaluationView,
    InterviewLLMEvaluation,
    InterviewNextQuestionView,
    InterviewQuestionView,
    InterviewProctoringEventCreate,
    InterviewProctoringEventResult,
    InterviewProctoringSummary,
    InterviewReportView,
    InterviewSessionCreate,
    InterviewSessionView,
    MockTestAttemptCreate,
)
from app.services.interview_llm import (
    InterviewLLMProvider,
    InterviewProviderError,
    generate_questions,
    get_interview_provider,
)
from app.services.interview_voice import (
    InterviewVoiceError,
    count_voice_metrics,
    create_audio_duration_token,
    transcribe_audio_clip,
    verify_audio_duration_token,
)
from app.services.interview_studio_settings import (
    get_interview_studio_setting,
    interview_studio_feature_enabled,
)

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


def _retry_provider_error_code(failure_code: str | None) -> str:
    return {
        "provider_not_configured": "evaluation_provider_not_configured",
        "provider_timeout": "evaluation_provider_timeout",
        "provider_rate_limited": "evaluation_provider_rate_limited",
        "provider_insufficient_quota": "evaluation_provider_insufficient_quota",
        "provider_invalid_key": "evaluation_provider_invalid_key",
        "provider_model_not_found": "evaluation_provider_model_not_found",
        "provider_rejected_request": "evaluation_provider_rejected",
        "provider_unavailable": "evaluation_provider_unavailable",
    }.get(failure_code or "", "evaluation_failed")


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
    student = await db.scalar(
        select(User)
        .where(User.id == student_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if student is None:
        raise InterviewStudioError(404, "student_not_found")
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
            select(func.count(MockTestQuestion.id)).where(
                MockTestQuestion.mock_test_id == test.id,
                MockTestQuestion.version == test.version,
            )
        )
        or 0
    )
    if question_rows != test.question_count:
        await db.rollback()
        raise InterviewStudioError(503, "mock_test_questions_unavailable")

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
        session_type=request.session_type or test.default_mode,
        interview_mode=request.interview_mode,
        category=mapped_category,
        difficulty="INTERMEDIATE",
        question_count=test.question_count,
        time_limit_seconds=min(test.time_limit_seconds, SESSION_TIME_LIMIT_SECONDS),
        status="CREATED",
        consent_acknowledged=True,
        consent_acknowledged_at=now,
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
    return [
        InterviewAnswerRecord(
            question_id=question.id,
            position=question.position,
            answer_text=answer.answer_text,
            submitted_at=answer.submitted_at,
        )
        for answer, question in pairs
    ]


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
    if session.status == "IN_PROGRESS":
        if _expire_if_due(session, _now()):
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
    model_name: str,
) -> None:
    for field in _EVALUATION_FIELDS:
        setattr(evaluation, field, getattr(result, field))
    evaluation.feedback = result.feedback
    evaluation.strengths = result.strengths
    evaluation.improvements = result.improvements
    evaluation.status = "COMPLETED"
    evaluation.failure_code = None
    evaluation.model_name = model_name
    evaluation.evaluated_at = _now()


async def _evaluate_with_usage(
    provider: InterviewLLMProvider,
    *,
    question: str,
    answer: str,
    rubric: str,
    allow_follow_up: bool,
) -> tuple[InterviewLLMEvaluation | None, str | None, int, int, int, int, int | None]:
    started = time.perf_counter()
    try:
        usage_call = getattr(provider, "evaluate_with_usage", None)
        if callable(usage_call):
            result, prompt_tokens, completion_tokens, retry_count, retry_after = await usage_call(
                question=question,
                answer=answer,
                rubric=rubric,
                allow_follow_up=allow_follow_up,
            )
        else:
            result = await provider.evaluate(
                question=question,
                answer=answer,
                rubric=rubric,
                allow_follow_up=allow_follow_up,
            )
            prompt_tokens = completion_tokens = retry_count = 0
            retry_after = None
        return (
            result,
            None,
            round((time.perf_counter() - started) * 1000),
            prompt_tokens,
            completion_tokens,
            retry_count,
            retry_after,
        )
    except InterviewProviderError as error:
        return (
            None,
            error.failure_code,
            round((time.perf_counter() - started) * 1000),
            error.prompt_tokens,
            error.completion_tokens,
            error.retry_count,
            error.retry_after_seconds,
        )


def _add_llm_usage_event(
    db: AsyncSession,
    *,
    status: str,
    duration_ms: int,
    prompt_tokens: int = 0,
    completion_tokens: int = 0,
    retry_count: int = 0,
    error_code: str | None = None,
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
    await db.refresh(evaluation)

    if session_type == "ASSESSMENT":
        return InterviewAnswerView(answer_id=answer.id, evaluation_status="PENDING")

    provider = provider or get_interview_provider()
    question_count = int(
        await db.scalar(
            select(func.count(InterviewQuestion.id)).where(
                InterviewQuestion.session_id == session.id
            )
        )
        or 0
    )
    existing_follow_up = await db.scalar(
        select(InterviewQuestion.id).where(
            InterviewQuestion.follow_up_to_answer_id == answer.id
        )
    )
    allow_follow_up = (
        existing_follow_up is None
        and question_count < session.question_count
        and session.mock_test_id is None
    )
    (
        result,
        failure_code,
        duration_ms,
        prompt_tokens,
        completion_tokens,
        retry_count,
        retry_after_seconds,
    ) = (
        await _evaluate_with_usage(
            provider,
            question=question.prompt,
            answer=answer_text,
            rubric=question.rubric,
            allow_follow_up=allow_follow_up,
        )
    )
    if result is None:
        evaluation.status = "FAILED"
        evaluation.failure_code = failure_code or "provider_unavailable"
        evaluation.model_name = provider.model_name
        evaluation.evaluated_at = _now()
        _add_llm_usage_event(
            db,
            status="FAILED",
            duration_ms=duration_ms,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            retry_count=retry_count,
            error_code=evaluation.failure_code,
        )
        await db.commit()
        return InterviewAnswerView(
            answer_id=answer.id,
            evaluation_status="FAILED",
            failure_code=evaluation.failure_code,
            retry_after_seconds=retry_after_seconds,
        )

    _apply_evaluation(evaluation, result, provider.model_name)
    _add_llm_usage_event(
        db,
        status="SUCCEEDED",
        duration_ms=duration_ms,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        retry_count=retry_count,
    )
    if allow_follow_up and result.follow_up_question:
        current_session = await _owned_session(
            db, student_id, session.id, lock=True
        )
        if not _expire_if_due(current_session, _now()):
            existing_follow_up = await db.scalar(
                select(InterviewQuestion.id).where(
                    InterviewQuestion.follow_up_to_answer_id == answer.id
                )
            )
            current_count = int(
                await db.scalar(
                    select(func.count(InterviewQuestion.id)).where(
                        InterviewQuestion.session_id == session.id
                    )
                )
                or 0
            )
            if existing_follow_up is None and current_count < session.question_count:
                db.add(
                    InterviewQuestion(
                        session_id=session.id,
                        follow_up_to_question_id=question.id,
                        follow_up_to_answer_id=answer.id,
                        position=current_count + 1,
                        prompt=result.follow_up_question,
                        hint=None,
                        rubric=question.rubric,
                        is_follow_up=True,
                    )
                )
        else:
            await db.flush()
    await db.commit()
    return InterviewAnswerView(
        answer_id=answer.id,
        evaluation_status="COMPLETED",
        evaluation=_evaluation_view(evaluation),
    )


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


async def _run_evaluations(
    db: AsyncSession,
    session_id: int,
    pairs: list[tuple[InterviewAnswer, InterviewQuestion]],
    provider: InterviewLLMProvider,
    *,
    finalize: bool,
    retryable_failure_codes: tuple[str, ...] | None = None,
) -> InterviewReportView | list[InterviewAnswerView]:
    evaluation_by_answer: dict[int, InterviewEvaluation] = {}
    for answer, _question in pairs:
        evaluation = await db.scalar(
            select(InterviewEvaluation).where(
                InterviewEvaluation.answer_id == answer.id
            )
        )
        if evaluation is None:
            evaluation = InterviewEvaluation(answer_id=answer.id, status="PENDING")
            db.add(evaluation)
            await db.flush()
        evaluation_by_answer[answer.id] = evaluation

    to_evaluate = [
        (answer, question)
        for answer, question in pairs
        if evaluation_by_answer[answer.id].status != "COMPLETED"
        and (
            retryable_failure_codes is None
            or (
                evaluation_by_answer[answer.id].status == "FAILED"
                and evaluation_by_answer[answer.id].failure_code in retryable_failure_codes
            )
        )
    ]

    async def evaluate_one(
        answer: InterviewAnswer,
        question: InterviewQuestion,
    ) -> tuple[int, InterviewLLMEvaluation | None, str | None, int, int, int, int, int | None]:
        (
            result,
            failure_code,
            duration_ms,
            prompt_tokens,
            completion_tokens,
            retry_count,
            retry_after_seconds,
        ) = await _evaluate_with_usage(
            provider,
            question=question.prompt,
            answer=answer.answer_text,
            rubric=question.rubric,
            allow_follow_up=False,
        )
        return (
            answer.id,
            result,
            failure_code,
            duration_ms,
            prompt_tokens,
            completion_tokens,
            retry_count,
            retry_after_seconds,
        )

    outcomes = []
    for answer, question in to_evaluate:
        outcomes.append(await evaluate_one(answer, question))
    retry_after_by_answer = {
        outcome[0]: outcome[7]
        for outcome in outcomes
        if outcome[7] is not None
    }
    for (
        answer_id,
        result,
        failure_code,
        duration_ms,
        prompt_tokens,
        completion_tokens,
        retry_count,
        _retry_after_seconds,
    ) in outcomes:
        evaluation = evaluation_by_answer[answer_id]
        if result is None:
            evaluation.status = "FAILED"
            evaluation.failure_code = failure_code or "provider_unavailable"
            evaluation.model_name = provider.model_name
            evaluation.evaluated_at = _now()
            _add_llm_usage_event(
                db,
                status="FAILED",
                duration_ms=duration_ms,
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                retry_count=retry_count,
                error_code=evaluation.failure_code,
            )
        else:
            _apply_evaluation(evaluation, result, provider.model_name)
            _add_llm_usage_event(
                db,
                status="SUCCEEDED",
                duration_ms=duration_ms,
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                retry_count=retry_count,
            )

    session = await db.get(InterviewSession, session_id, with_for_update=True)
    if session is None:
        raise InterviewStudioError(404, "session_not_found")

    if not finalize:
        await db.commit()
        return [
            InterviewAnswerView(
                answer_id=answer.id,
                evaluation_status=evaluation_by_answer[answer.id].status,
                failure_code=evaluation_by_answer[answer.id].failure_code,
                retry_after_seconds=retry_after_by_answer.get(answer.id),
                evaluation=_evaluation_view(evaluation_by_answer[answer.id]),
            )
            for answer, _question in pairs
            if answer.id in {outcome[0] for outcome in outcomes}
        ]

    report = await db.scalar(
        select(InterviewReport).where(InterviewReport.session_id == session.id)
    )
    if report is None:
        report = InterviewReport(session_id=session.id, status="PENDING")
        db.add(report)
        await db.flush()

    latest_evaluations = [evaluation_by_answer[answer.id] for answer, _ in pairs]
    failures = [
        item for item in latest_evaluations if item.status != "COMPLETED"
    ]
    report.answer_count = len(pairs)
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
        _complete_report(report, session, latest_evaluations, pairs)
    await db.commit()
    report_view = await _report_view(db, session, report)
    report_view.retry_after_seconds = next(
        (
            retry_after_by_answer.get(evaluation.answer_id)
            for evaluation in latest_evaluations
            if evaluation.status == "FAILED"
            and retry_after_by_answer.get(evaluation.answer_id) is not None
        ),
        None,
    )
    return report_view


async def complete_session(
    db: AsyncSession,
    student_id: int,
    session_id: int,
    provider: InterviewLLMProvider | None = None,
) -> InterviewReportView:
    session = await _owned_session(db, student_id, session_id, lock=True)
    await _require_in_progress(db, session, _now())
    pairs = await _latest_answer_pairs(db, session.id)
    if not pairs:
        raise InterviewStudioError(422, "no_answers_to_evaluate")

    session.status = "EVALUATION_PENDING"
    report = await db.scalar(
        select(InterviewReport).where(InterviewReport.session_id == session.id)
    )
    if report is None:
        report = InterviewReport(session_id=session.id, status="PENDING")
        db.add(report)
    else:
        report.status = "PENDING"
        report.failure_code = None
    await db.commit()
    result = await _run_evaluations(
        db,
        session.id,
        pairs,
        provider or get_interview_provider(),
        finalize=True,
    )
    if not isinstance(result, InterviewReportView):
        raise RuntimeError("Completed interview evaluation did not produce a report.")
    return result


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
    provider: InterviewLLMProvider | None = None,
    retryable_failure_codes: tuple[str, ...] | None = None,
) -> InterviewReportView | list[InterviewAnswerView]:
    session = await _owned_session(db, student_id, session_id, lock=True)
    await _require_not_expired(db, session)
    if session.status not in {
        "IN_PROGRESS",
        "EVALUATION_PENDING",
        "EVALUATION_FAILED",
    }:
        raise InterviewStudioError(409, "invalid_session_transition")
    pairs = await _latest_answer_pairs(db, session.id)
    if not pairs:
        raise InterviewStudioError(422, "no_answers_to_evaluate")

    if session.status in {"EVALUATION_FAILED", "EVALUATION_PENDING"}:
        session.status = "EVALUATION_PENDING"
        report = await db.scalar(
            select(InterviewReport).where(InterviewReport.session_id == session.id)
        )
        if report is not None:
            report.status = "PENDING"
            report.failure_code = None
        await db.commit()
        result = await _run_evaluations(
            db,
            session.id,
            pairs,
            provider or get_interview_provider(),
            finalize=True,
            retryable_failure_codes=retryable_failure_codes,
        )
        if not isinstance(result, InterviewReportView):
            raise RuntimeError("Retried interview evaluation did not produce a report.")
        if result.status == "FAILED":
            raise InterviewStudioError(
                503,
                _retry_provider_error_code(result.failure_code),
                retry_after_seconds=result.retry_after_seconds,
            )
        return result

    if session.session_type != "PRACTICE":
        raise InterviewStudioError(409, "assessment_evaluation_not_started")
    failed_pairs = []
    for answer, question in pairs:
        evaluation = await db.scalar(
            select(InterviewEvaluation).where(
                InterviewEvaluation.answer_id == answer.id
            )
        )
        if (
            evaluation is not None
            and evaluation.status == "FAILED"
            and (
                retryable_failure_codes is None
                or evaluation.failure_code in retryable_failure_codes
            )
        ):
            if retryable_failure_codes is None:
                evaluation.status = "PENDING"
                evaluation.failure_code = None
            failed_pairs.append((answer, question))
    if not failed_pairs:
        raise InterviewStudioError(409, "no_failed_evaluations")
    await db.commit()
    result = await _run_evaluations(
        db,
        session.id,
        failed_pairs,
        provider or get_interview_provider(),
        finalize=False,
        retryable_failure_codes=retryable_failure_codes,
    )
    if isinstance(result, InterviewReportView):
        raise RuntimeError("Practice answer retry unexpectedly produced a report.")
    failed_result = next(
        (item for item in result if item.evaluation_status == "FAILED"),
        None,
    )
    if failed_result is not None:
        raise InterviewStudioError(
            503,
            _retry_provider_error_code(failed_result.failure_code),
            retry_after_seconds=failed_result.retry_after_seconds,
        )
    return result


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
    from app.services.interview_video_storage import LocalPrivateInterviewVideoStorage

    recording_keys = list(
        await db.scalars(
            select(InterviewRecording.storage_key).where(
                InterviewRecording.session_id == session.id
            )
        )
    )
    await db.delete(session)
    await db.commit()
    storage = LocalPrivateInterviewVideoStorage(
        get_settings().interview_video_storage_path
    )
    for storage_key in recording_keys:
        await asyncio.to_thread(storage.delete, storage_key)


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


