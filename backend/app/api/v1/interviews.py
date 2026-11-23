from typing import Annotated, Any, Awaitable

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile, status
from starlette.responses import StreamingResponse

from app.api.v1.dependencies import DbSession, require_roles
from app.core.config import get_settings
from app.models import User, UserRole
from app.schemas.interview import (
    InterviewAudioTranscriptView,
    InterviewAnswerRecord,
    InterviewAnswerSubmit,
    InterviewAnswerView,
    InterviewNextQuestionView,
    InterviewReportView,
    InterviewProctoringEventCreate,
    InterviewProctoringEventResult,
    InterviewRecordingConsentRequest,
    InterviewRecordingConsentView,
    InterviewRecordingView,
    InterviewVideoChunkResult,
    InterviewVideoRecordingState,
    InterviewSessionCreate,
    InterviewSessionView,
    MockTestAttemptCreate,
    MockTestAttemptSummary,
    MockTestComparisonRequest,
    MockTestComparisonView,
    MockTestDetailView,
    MockTestRecommendationView,
    MockTestView,
)
from app.services.interview_studio import (
    InterviewStudioError,
    acknowledge_proctoring_consent,
    complete_session,
    create_session,
    create_mock_test_session,
    delete_session,
    get_report,
    get_session_answers,
    get_session_detail,
    list_sessions,
    next_question,
    retry_evaluation,
    record_proctoring_event,
    start_session,
    submit_answer,
    transcribe_voice_answer,

)
from app.services.mock_test_library import (
    compare_mock_test_attempts,
    get_mock_test_detail,
    list_mock_test_attempts,
    list_mock_tests,
    recommend_mock_test,
)
from app.services.interview_llm import get_interview_provider_status
from app.services.interview_video import (
    InterviewVideoError,
    VIDEO_RECORDING_CONSENT_VERSION,
    acknowledge_recording_consent,
    create_recording,
    delete_recording,
    finalize_recording,
    get_recording_state,
    open_recording,
    recording_chunk_stream,
    upload_recording_chunk,
)

router = APIRouter(prefix="/interviews", tags=["interviews"])
legacy_router = APIRouter(prefix="/interview-sessions", tags=["interviews"])
student_only = Annotated[User, Depends(require_roles(UserRole.STUDENT))]


async def _execute(operation: Awaitable[Any]) -> Any:
    try:
        return await operation
    except InterviewStudioError as error:
        raise HTTPException(
            status_code=error.status_code,
            detail=error.code,
            headers=(
                {"Retry-After": str(error.retry_after_seconds)}
                if error.retry_after_seconds is not None
                else None
            ),
        ) from error
    except InterviewVideoError as error:
        raise HTTPException(
            status_code=error.status_code,
            detail=error.code,
        ) from error


@router.get("/provider-status")
async def get_student_interview_provider_status(
    _user: student_only,
) -> dict[str, bool | int | None]:
    status_view = await get_interview_provider_status()
    return {
        "available": bool(status_view["configured"] and status_view["last_error"] is None),
        "retry_after_seconds": status_view.get("retry_after_seconds"),
    }


@router.get(
    "/mock-tests/recommendation",
    response_model=MockTestRecommendationView,
)
async def get_mock_test_recommendation(
    user: student_only,
    db: DbSession,
) -> MockTestRecommendationView:
    return await _execute(recommend_mock_test(db, user.id))


@router.get("/mock-tests", response_model=list[MockTestView])
async def get_mock_tests(
    user: student_only,
    db: DbSession,
    category: str | None = None,
    difficulty: str | None = None,
    format: str | None = None,
) -> list[MockTestView]:
    return await _execute(
        list_mock_tests(
            db,
            user.id,
            category=category,
            difficulty=difficulty,
            test_format=format,
        )
    )


@router.post(
    "/mock-tests/{test_id}/attempts",
    response_model=InterviewSessionView,
    status_code=status.HTTP_201_CREATED,
)
async def create_mock_test_attempt(
    test_id: int,
    request: MockTestAttemptCreate,
    user: student_only,
    db: DbSession,
) -> InterviewSessionView:
    return await _execute(create_mock_test_session(db, user.id, test_id, request))


@router.get(
    "/mock-tests/{test_id}/attempts",
    response_model=list[MockTestAttemptSummary],
)
async def get_mock_test_attempts(
    test_id: int,
    user: student_only,
    db: DbSession,
) -> list[MockTestAttemptSummary]:
    return await _execute(list_mock_test_attempts(db, user.id, test_id))


@router.post(
    "/mock-tests/{test_id}/compare",
    response_model=MockTestComparisonView,
)
async def compare_interview_test_attempts(
    test_id: int,
    request: MockTestComparisonRequest,
    user: student_only,
    db: DbSession,
) -> MockTestComparisonView:
    return await _execute(
        compare_mock_test_attempts(db, user.id, test_id, request.attempt_ids)
    )


@router.get("/mock-tests/{test_id}", response_model=MockTestDetailView)
async def get_mock_test(
    test_id: int,
    user: student_only,
    db: DbSession,
) -> MockTestDetailView:
    return await _execute(get_mock_test_detail(db, test_id))


@router.post(
    "/sessions",
    response_model=InterviewSessionView,
    status_code=status.HTTP_201_CREATED,
)
async def create_interview_session(
    request: InterviewSessionCreate,
    user: student_only,
    db: DbSession,
) -> InterviewSessionView:
    return await _execute(create_session(db, user.id, request))


@router.get("/sessions", response_model=list[InterviewSessionView])
async def get_interview_sessions(
    user: student_only,
    db: DbSession,
) -> list[InterviewSessionView]:
    return await _execute(list_sessions(db, user.id))


@router.get("/sessions/{session_id}")
async def get_interview_session(
    session_id: int,
    user: student_only,
    db: DbSession,
) -> dict[str, object]:
    return await _execute(get_session_detail(db, user.id, session_id))


@router.get(
    "/sessions/{session_id}/answers",
    response_model=list[InterviewAnswerRecord],
)
@legacy_router.get("/{session_id}/answers", response_model=list[InterviewAnswerRecord])
async def get_interview_answers(
    session_id: int,
    user: student_only,
    db: DbSession,
) -> list[InterviewAnswerRecord]:
    return await _execute(get_session_answers(db, user.id, session_id))


@router.post(
    "/sessions/{session_id}/proctoring-consent",
    response_model=InterviewSessionView,
)
async def post_interview_proctoring_consent(
    session_id: int,
    user: student_only,
    db: DbSession,
) -> InterviewSessionView:
    return await _execute(acknowledge_proctoring_consent(db, user.id, session_id))


@router.post(
    "/sessions/{session_id}/proctoring-events",
    response_model=InterviewProctoringEventResult,
)
@legacy_router.post(
    "/{session_id}/proctoring-events",
    response_model=InterviewProctoringEventResult,
)
async def post_interview_proctoring_event(
    session_id: int,
    request: InterviewProctoringEventCreate,
    user: student_only,
    db: DbSession,
) -> InterviewProctoringEventResult:
    return await _execute(
        record_proctoring_event(db, user.id, session_id, request)
    )


@router.post(
    "/sessions/{session_id}/start",
    response_model=InterviewSessionView,
)
async def start_interview_session(
    session_id: int,
    user: student_only,
    db: DbSession,
) -> InterviewSessionView:
    return await _execute(start_session(db, user.id, session_id))


@router.post(
    "/sessions/{session_id}/next-question",
    response_model=InterviewNextQuestionView,
)
async def get_next_interview_question(
    session_id: int,
    user: student_only,
    db: DbSession,
) -> InterviewNextQuestionView:
    return await _execute(next_question(db, user.id, session_id))


@router.post(
    "/sessions/{session_id}/answers",
    response_model=InterviewAnswerView,
)
async def submit_interview_answer(
    session_id: int,
    request: InterviewAnswerSubmit,
    user: student_only,
    db: DbSession,
) -> InterviewAnswerView:
    return await _execute(
        submit_answer(
            db,
            user.id,
            session_id,
            request.question_id,
            request.answer_text,
            audio_duration_token=request.audio_duration_token,
        )
    )


@router.post(
    "/sessions/{session_id}/audio",
    response_model=InterviewAudioTranscriptView,
)
async def transcribe_interview_audio(
    session_id: int,
    user: student_only,
    db: DbSession,
    question_id: int = Form(..., gt=0),
    audio: UploadFile = File(...),
) -> InterviewAudioTranscriptView:
    settings = get_settings()
    max_bytes = min(settings.interview_stt_max_audio_bytes, 10 * 1024 * 1024)
    try:
        contents = await audio.read(max_bytes + 1)
        return await _execute(
            transcribe_voice_answer(
                db,
                user.id,
                session_id,
                question_id,
                contents,
                audio.content_type or "",
            )
        )
    finally:
        await audio.close()


@router.get(
    "/sessions/{session_id}/recordings",
    response_model=InterviewVideoRecordingState,
)
async def get_interview_recording_state(
    session_id: int,
    user: student_only,
    db: DbSession,
) -> InterviewVideoRecordingState:
    return await _execute(get_recording_state(db, user.id, session_id))


@router.post(
    "/sessions/{session_id}/recordings/consent",
    response_model=InterviewRecordingConsentView,
)
async def acknowledge_interview_recording_consent(
    session_id: int,
    request: InterviewRecordingConsentRequest,
    user: student_only,
    db: DbSession,
) -> InterviewRecordingConsentView:
    if request.consent_version != VIDEO_RECORDING_CONSENT_VERSION:
        raise HTTPException(status_code=409, detail="consent_version_mismatch")
    return await _execute(
        acknowledge_recording_consent(
            db, user.id, session_id, request.consent_version
        )
    )


@router.post(
    "/sessions/{session_id}/recordings",
    response_model=InterviewRecordingView,
    status_code=status.HTTP_201_CREATED,
)
async def create_interview_recording(
    session_id: int,
    user: student_only,
    db: DbSession,
) -> InterviewRecordingView:
    return await _execute(create_recording(db, user.id, session_id))


@router.post(
    "/sessions/{session_id}/recordings/{recording_id}/chunks",
    response_model=InterviewVideoChunkResult,
)
async def upload_interview_recording_chunk(
    session_id: int,
    recording_id: int,
    user: student_only,
    db: DbSession,
    chunk_index: int = Form(..., ge=0),
    chunk: UploadFile = File(...),
) -> InterviewVideoChunkResult:
    settings = get_settings()
    try:
        content = await chunk.read(settings.interview_video_max_chunk_bytes + 1)
        return await _execute(
            upload_recording_chunk(
                db,
                user.id,
                session_id,
                recording_id,
                chunk_index,
                content,
                chunk.content_type or "",
            )
        )
    finally:
        await chunk.close()


@router.post(
    "/sessions/{session_id}/recordings/{recording_id}/finalize",
    response_model=InterviewRecordingView,
)
async def finalize_interview_recording(
    session_id: int,
    recording_id: int,
    user: student_only,
    db: DbSession,
) -> InterviewRecordingView:
    return await _execute(
        finalize_recording(db, user.id, session_id, recording_id)
    )


@router.get("/sessions/{session_id}/recordings/{recording_id}/content")
async def stream_interview_recording(
    session_id: int,
    recording_id: int,
    user: student_only,
    db: DbSession,
) -> StreamingResponse:
    recording, storage = await _execute(
        open_recording(db, user.id, session_id, recording_id)
    )
    return StreamingResponse(
        recording_chunk_stream(storage, recording.storage_key),
        media_type=recording.mime_type,
        headers={
            "Cache-Control": "private, no-store",
            "Content-Disposition": 'inline; filename="interview-recording"',
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.delete(
    "/sessions/{session_id}/recordings/{recording_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_interview_recording(
    session_id: int,
    recording_id: int,
    user: student_only,
    db: DbSession,
) -> Response:
    await _execute(delete_recording(db, user.id, session_id, recording_id))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/sessions/{session_id}/complete",
    response_model=InterviewReportView,
)
async def complete_interview_session(
    session_id: int,
    user: student_only,
    db: DbSession,
) -> InterviewReportView:
    return await _execute(complete_session(db, user.id, session_id))


@router.get(
    "/sessions/{session_id}/report",
    response_model=InterviewReportView,
)
async def get_interview_report(
    session_id: int,
    user: student_only,
    db: DbSession,
) -> InterviewReportView:
    return await _execute(get_report(db, user.id, session_id))


@router.post("/sessions/{session_id}/evaluation/retry")
async def retry_interview_evaluation(
    session_id: int,
    user: student_only,
    db: DbSession,
) -> Any:
    return await _execute(retry_evaluation(db, user.id, session_id))


@router.delete(
    "/sessions/{session_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_interview_session(
    session_id: int,
    user: student_only,
    db: DbSession,
) -> Response:
    await _execute(delete_session(db, user.id, session_id))
    return Response(status_code=status.HTTP_204_NO_CONTENT)
