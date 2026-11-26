"""Owner-scoped consent, chunk upload, retention, and streaming for video interviews."""

import asyncio
import json
import logging
import math
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.models import (
    InterviewConsent,
    InterviewRecording,
    InterviewRecordingDeletion,
    InterviewSession,
    InterviewStudioUsageEvent,
)
from app.services.interview_studio_settings import (
    get_interview_studio_setting,
    interview_studio_feature_enabled,
)
from app.services.interview_video_storage import (
    InterviewVideoStorage,
    LocalPrivateInterviewVideoStorage,
)
from app.services.interview_video_gdrive import (
    GoogleDriveInterviewStorage,
    InterviewStorageError,
)

VIDEO_RECORDING_CONSENT_VERSION = "2026-11-v1"
VIDEO_MIME_TYPES = {"video/webm", "video/mp4"}
logger = logging.getLogger(__name__)


class InterviewVideoError(RuntimeError):
    def __init__(self, status_code: int, code: str):
        super().__init__(code)
        self.status_code = status_code
        self.code = code


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


def _storage(
    settings: Settings | None = None,
    backend: str | None = None,
) -> InterviewVideoStorage:
    configured = settings or get_settings()
    selected_backend = backend or configured.effective_interview_video_storage_backend
    if selected_backend == "gdrive":
        return GoogleDriveInterviewStorage(
            configured.interview_video_storage_path,
            configured.google_service_account_json,
            configured.gdrive_folder_id,
        )
    return LocalPrivateInterviewVideoStorage(configured.interview_video_storage_path)


def _recording_storage(recording: InterviewRecording) -> InterviewVideoStorage:
    return _storage(backend=recording.storage_backend)


def _retention_days(settings: Settings, configured_days: int | None = None) -> int:
    if settings.video_retention_days is not None:
        return settings.video_retention_days
    if configured_days is not None:
        return configured_days
    return settings.interview_video_retention_days


def _max_video_bytes(settings: Settings) -> int:
    return (
        settings.video_max_mb * 1024 * 1024
        if settings.video_max_mb is not None
        else settings.interview_video_max_bytes
    )


def _max_video_seconds(settings: Settings) -> int:
    return (
        settings.video_max_seconds
        if settings.video_max_seconds is not None
        else settings.interview_video_max_duration_seconds
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
        raise InterviewVideoError(404, "session_not_found")
    if session.interview_mode != "VIDEO":
        raise InterviewVideoError(409, "video_mode_required")
    return session


def _expire_session_if_due(session: InterviewSession, now: datetime) -> bool:
    if (
        session.status == "IN_PROGRESS"
        and session.expires_at is not None
        and _aware(session.expires_at) <= now
    ):
        session.status = "EXPIRED"
        return True
    return False


async def _require_active_session(
    db: AsyncSession,
    session: InterviewSession,
    now: datetime,
) -> None:
    if _expire_session_if_due(session, now):
        await db.commit()
        raise InterviewVideoError(409, "session_expired")
    if session.status == "EXPIRED":
        raise InterviewVideoError(409, "session_expired")
    if session.status != "IN_PROGRESS":
        raise InterviewVideoError(409, "invalid_session_transition")


async def _owned_recording(
    db: AsyncSession,
    student_id: int,
    session_id: int,
    recording_id: int,
    *,
    lock: bool = False,
) -> InterviewRecording:
    statement = select(InterviewRecording).where(
        InterviewRecording.id == recording_id,
        InterviewRecording.session_id == session_id,
        InterviewRecording.student_id == student_id,
    )
    if lock:
        statement = statement.with_for_update()
    recording = await db.scalar(statement)
    if recording is None:
        raise InterviewVideoError(404, "recording_not_found")
    return recording


def _recording_view(recording: InterviewRecording) -> dict[str, object]:
    return {
        "id": recording.id,
        "status": recording.status,
        "finalized": recording.completed_at is not None,
        "source_type": recording.source_type,
        "retryable": (
            recording.storage_backend == "gdrive"
            and recording.status == "FAILED"
        ),
        "mime_type": recording.mime_type,
        "chunk_count": recording.chunk_count,
        "next_chunk_index": recording.chunk_count,
        "total_bytes": recording.total_bytes,
        "duration_seconds": recording.duration_seconds,
        "retention_expires_at": recording.retention_expires_at,
        "created_at": recording.created_at,
        "error_code": recording.error_code,
    }


async def acknowledge_recording_consent(
    db: AsyncSession,
    student_id: int,
    session_id: int,
    consent_version: str,
) -> dict[str, object]:
    if consent_version != VIDEO_RECORDING_CONSENT_VERSION:
        raise InterviewVideoError(409, "consent_version_mismatch")
    session = await _owned_session(db, student_id, session_id, lock=True)
    await _require_active_session(db, session, _now())
    consent = await db.scalar(
        select(InterviewConsent).where(
            InterviewConsent.session_id == session.id,
            InterviewConsent.student_id == student_id,
            InterviewConsent.consent_type == "VIDEO_RECORDING",
            InterviewConsent.version == VIDEO_RECORDING_CONSENT_VERSION,
        )
    )
    if consent is None:
        consent = InterviewConsent(
            session_id=session.id,
            student_id=student_id,
            consent_type="VIDEO_RECORDING",
            version=VIDEO_RECORDING_CONSENT_VERSION,
            acknowledged_at=_now(),
        )
        db.add(consent)
        await db.commit()
        await db.refresh(consent)
    return {
        "acknowledged": True,
        "consent_version": consent.version,
        "acknowledged_at": consent.acknowledged_at,
    }


async def set_video_storage_consent(
    db: AsyncSession,
    student_id: int,
    session_id: int,
    acknowledged: bool,
) -> dict[str, object]:
    session = await _owned_session(db, student_id, session_id, lock=True)
    if session.status != "CREATED":
        raise InterviewVideoError(409, "video_storage_consent_locked")
    if acknowledged and session.interview_mode != "VIDEO":
        raise InterviewVideoError(409, "video_mode_required")
    session.video_storage_consent = acknowledged
    session.video_storage_consent_at = _now() if acknowledged else None
    await db.commit()
    return {
        "acknowledged": session.video_storage_consent,
        "acknowledged_at": session.video_storage_consent_at,
    }


async def get_recording_state(
    db: AsyncSession,
    student_id: int,
    session_id: int,
    *,
    storage: InterviewVideoStorage | None = None,
) -> dict[str, object]:
    session = await _owned_session(db, student_id, session_id, lock=True)
    if _expire_session_if_due(session, _now()):
        await db.commit()
    consent = await db.scalar(
        select(InterviewConsent)
        .where(
            InterviewConsent.session_id == session.id,
            InterviewConsent.student_id == student_id,
            InterviewConsent.consent_type == "VIDEO_RECORDING",
        )
        .order_by(InterviewConsent.acknowledged_at.desc())
    )
    recordings = list(
        (
            await db.scalars(
                select(InterviewRecording)
                .where(
                    InterviewRecording.session_id == session.id,
                    InterviewRecording.student_id == student_id,
                )
                .order_by(InterviewRecording.created_at.desc())
            )
        ).all()
    )
    for recording in recordings:
        if recording.status in {"AVAILABLE", "UPLOADING", "PENDING_UPLOAD"} and (
            _aware(recording.retention_expires_at) <= _now()
        ):
            await _mark_for_deletion(db, recording, "EXPIRED")
    if recordings:
        await db.commit()
        await process_recording_deletions(db)
    visible_recordings = [_recording_view(recording) for recording in recordings]
    return {
        "required_consent_version": VIDEO_RECORDING_CONSENT_VERSION,
        "video_storage_consent": session.video_storage_consent,
        "retention_days": _retention_days(
            get_settings(),
            int(await get_interview_studio_setting(db, "retention_days")),
        ),
        "storage_backend": get_settings().effective_interview_video_storage_backend,
        "consent": (
            {
                "acknowledged": True,
                "consent_version": consent.version,
                "acknowledged_at": consent.acknowledged_at,
            }
            if consent is not None
            else None
        ),
        "recording": visible_recordings[0] if visible_recordings else None,
        "recordings": visible_recordings,
    }


async def video_recording_policy(db: AsyncSession) -> dict[str, int | str]:
    settings = get_settings()
    return {
        "retention_days": _retention_days(
            settings,
            int(await get_interview_studio_setting(db, "retention_days")),
        ),
        "storage_backend": settings.effective_interview_video_storage_backend,
    }


async def create_recording(
    db: AsyncSession,
    student_id: int,
    session_id: int,
) -> dict[str, object]:
    session = await _owned_session(db, student_id, session_id, lock=True)
    now = _now()
    await _require_active_session(db, session, now)
    if not await interview_studio_feature_enabled(db, "recording_enabled"):
        raise InterviewVideoError(403, "recording_disabled")
    if not await interview_studio_feature_enabled(db, "video_enabled"):
        raise InterviewVideoError(403, "video_mode_disabled")
    consent = await db.scalar(
        select(InterviewConsent).where(
            InterviewConsent.session_id == session.id,
            InterviewConsent.student_id == student_id,
            InterviewConsent.consent_type == "VIDEO_RECORDING",
            InterviewConsent.version == VIDEO_RECORDING_CONSENT_VERSION,
        )
    )
    if consent is None:
        raise InterviewVideoError(403, "recording_consent_required")
    if not session.video_storage_consent:
        raise InterviewVideoError(403, "video_storage_consent_required")
    existing = await db.scalar(
        select(InterviewRecording)
        .where(
            InterviewRecording.session_id == session.id,
            InterviewRecording.student_id == student_id,
            InterviewRecording.status.in_(
                ("UPLOADING", "PENDING_UPLOAD", "AVAILABLE")
            ),
        )
        .order_by(InterviewRecording.created_at.desc())
    )
    if existing is not None:
        if existing.status == "UPLOADING":
            return _recording_view(existing)
    settings = get_settings()
    retention_days = _retention_days(
        settings,
        int(await get_interview_studio_setting(db, "retention_days")),
    )
    recording = InterviewRecording(
        session_id=session.id,
        student_id=student_id,
        storage_key=str(uuid.uuid4()),
        status="UPLOADING",
        source_type="mock" if session.mock_test_id is not None else "real",
        storage_backend=settings.effective_interview_video_storage_backend,
        mime_type="",
        chunk_count=0,
        total_bytes=0,
        retention_expires_at=now + timedelta(days=retention_days),
    )
    db.add(recording)
    await db.commit()
    await db.refresh(recording)
    return _recording_view(recording)


async def upload_recording_chunk(
    db: AsyncSession,
    student_id: int,
    session_id: int,
    recording_id: int,
    chunk_index: int,
    content: bytes,
    content_type: str,
    *,
    storage: InterviewVideoStorage | None = None,
) -> dict[str, int]:
    settings = get_settings()
    media_type = content_type.split(";", 1)[0].strip().casefold()
    if media_type not in VIDEO_MIME_TYPES:
        raise InterviewVideoError(415, "unsupported_video_type")
    if not content:
        raise InterviewVideoError(422, "video_chunk_empty")
    if len(content) > settings.interview_video_max_chunk_bytes:
        raise InterviewVideoError(413, "video_chunk_too_large")
    if chunk_index < 0:
        raise InterviewVideoError(422, "invalid_chunk_index")

    session = await _owned_session(db, student_id, session_id, lock=True)
    await _require_active_session(db, session, _now())
    recording = await _owned_recording(
        db, student_id, session_id, recording_id, lock=True
    )
    if recording.status != "UPLOADING":
        raise InterviewVideoError(409, "recording_not_uploading")
    if chunk_index < recording.chunk_count:
        return {
            "recording_id": recording.id,
            "next_chunk_index": recording.chunk_count,
        }
    if chunk_index != recording.chunk_count:
        raise InterviewVideoError(409, "video_chunk_out_of_order")
    if recording.mime_type and recording.mime_type != media_type:
        raise InterviewVideoError(415, "video_chunk_type_mismatch")
    if recording.total_bytes + len(content) > _max_video_bytes(settings):
        raise InterviewVideoError(413, "video_recording_too_large")

    storage = storage or _storage(settings)
    await asyncio.to_thread(storage.write_chunk, recording.storage_key, chunk_index, content)
    recording.mime_type = media_type
    recording.total_bytes += len(content)
    recording.chunk_count += 1
    await db.commit()
    return {
        "recording_id": recording.id,
        "next_chunk_index": recording.chunk_count,
    }


async def _recording_duration(
    storage: InterviewVideoStorage,
    storage_key: str,
    settings: Settings,
) -> float:
    command = [
        settings.interview_ffprobe_path,
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "json",
        "-i",
        str(storage.recording_path(storage_key)),
    ]
    try:
        process = await asyncio.create_subprocess_exec(
            *command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
    except FileNotFoundError:
        raise InterviewVideoError(503, "video_validator_unavailable") from None
    try:
        stdout, _ = await asyncio.wait_for(process.communicate(), timeout=20)
    except asyncio.TimeoutError:
        process.kill()
        await process.communicate()
        raise InterviewVideoError(422, "invalid_video_recording") from None
    if process.returncode != 0:
        raise InterviewVideoError(422, "invalid_video_recording")
    try:
        metadata = json.loads(stdout)
        duration = float(metadata["format"]["duration"])
    except (ValueError, KeyError, TypeError, json.JSONDecodeError):
        raise InterviewVideoError(422, "invalid_video_recording") from None
    if not math.isfinite(duration) or duration <= 0.1:
        raise InterviewVideoError(422, "video_recording_too_short")
    if duration > _max_video_seconds(settings):
        raise InterviewVideoError(413, "video_recording_too_long")
    return round(duration, 3)


async def finalize_recording(
    db: AsyncSession,
    student_id: int,
    session_id: int,
    recording_id: int,
    *,
    storage: InterviewVideoStorage | None = None,
) -> dict[str, object]:
    session = await _owned_session(db, student_id, session_id, lock=True)
    if _expire_session_if_due(session, _now()):
        await db.commit()
    recording = await _owned_recording(
        db, student_id, session_id, recording_id, lock=True
    )
    if _aware(recording.retention_expires_at) <= _now():
        await _mark_for_deletion(db, recording, "EXPIRED")
        await db.commit()
        await process_recording_deletions(db)
        raise InterviewVideoError(410, "recording_expired")
    if recording.status in {"AVAILABLE", "PENDING_UPLOAD"} or (
        recording.storage_backend == "gdrive" and recording.completed_at is not None
    ):
        return _recording_view(recording)
    if recording.status != "UPLOADING":
        raise InterviewVideoError(404, "recording_not_found")
    if recording.chunk_count == 0:
        raise InterviewVideoError(422, "video_recording_empty")

    settings = get_settings()
    storage = storage or _storage(settings, backend=recording.storage_backend)
    await asyncio.to_thread(
        storage.assemble, recording.storage_key, recording.chunk_count
    )
    if recording.total_bytes > _max_video_bytes(settings):
        raise InterviewVideoError(413, "video_recording_too_large")
    duration = await _recording_duration(storage, recording.storage_key, settings)
    if session.started_at is not None:
        actual_session_duration = max(
            0.0, (_now() - _aware(session.started_at)).total_seconds()
        )
        if actual_session_duration > _max_video_seconds(settings) + 60:
            raise InterviewVideoError(413, "video_recording_exceeds_session_limit")
    recording.duration_seconds = duration
    recording.completed_at = _now()
    if recording.storage_backend == "gdrive":
        recording.status = "PENDING_UPLOAD"
        recording.error_code = None
        await db.commit()
        await asyncio.to_thread(
            storage.remove_chunks, recording.storage_key, recording.chunk_count
        )
        return _recording_view(recording)

    recording.status = "AVAILABLE"
    await db.commit()
    await asyncio.to_thread(
        storage.remove_chunks, recording.storage_key, recording.chunk_count
    )
    return _recording_view(recording)


async def open_recording(
    db: AsyncSession,
    student_id: int,
    session_id: int,
    recording_id: int,
    *,
    storage: InterviewVideoStorage | None = None,
) -> tuple[InterviewRecording, InterviewVideoStorage]:
    await _owned_session(db, student_id, session_id)
    recording = await _owned_recording(db, student_id, session_id, recording_id)
    if recording.status != "AVAILABLE":
        raise InterviewVideoError(404, "recording_not_found")
    if _aware(recording.retention_expires_at) <= _now():
        await _mark_for_deletion(db, recording, "EXPIRED")
        await db.commit()
        raise InterviewVideoError(404, "recording_not_found")
    selected_storage = storage or _recording_storage(recording)
    if not await asyncio.to_thread(
        selected_storage.exists,
        recording.storage_key,
        file_id=recording.storage_file_id,
    ):
        recording.status = "FAILED"
        recording.error_code = "recording_file_missing"
        await db.commit()
        raise InterviewVideoError(404, "recording_not_found")
    return recording, selected_storage


async def delete_recording(
    db: AsyncSession,
    student_id: int,
    session_id: int,
    recording_id: int,
    *,
    storage: InterviewVideoStorage | None = None,
) -> bool:
    await _owned_session(db, student_id, session_id, lock=True)
    recording = await _owned_recording(
        db, student_id, session_id, recording_id, lock=True
    )
    if recording.status == "PENDING_DELETE":
        return False
    if recording.status == "DELETED":
        return True
    await _mark_for_deletion(
        db,
        recording,
        "DELETED",
        storage=storage,
    )
    await db.commit()
    return recording.status == "DELETED"


async def expire_video_recordings(db: AsyncSession) -> int:
    now = _now()
    recordings = list(
        (
            await db.scalars(
                select(InterviewRecording)
                .where(
                    InterviewRecording.status.in_(
                        ("UPLOADING", "PENDING_UPLOAD", "AVAILABLE", "FAILED")
                    ),
                    InterviewRecording.retention_expires_at <= now,
                )
                .with_for_update(skip_locked=True)
            )
        ).all()
    )
    expired = 0
    for recording in recordings:
        await _mark_for_deletion(db, recording, "EXPIRED")
        expired += 1
    await db.commit()
    await process_recording_deletions(db)
    return expired


def parse_byte_range(range_header: str | None, size: int) -> tuple[int, int, bool]:
    if not range_header:
        return 0, max(0, size - 1), False
    if not range_header.startswith("bytes=") or "," in range_header:
        raise InterviewVideoError(416, "invalid_range")
    value = range_header[6:].strip()
    try:
        first, last = value.split("-", 1)
        if not first:
            suffix_length = int(last)
            if suffix_length <= 0:
                raise ValueError
            start = max(0, size - suffix_length)
            end = size - 1
        else:
            start = int(first)
            end = min(int(last), size - 1) if last else size - 1
    except (ValueError, TypeError):
        raise InterviewVideoError(416, "invalid_range") from None
    if size == 0 or start < 0 or start >= size or end < start:
        raise InterviewVideoError(416, "invalid_range")
    return start, end, True


def recording_chunk_stream(
    storage: InterviewVideoStorage,
    storage_key: str,
    *,
    file_id: str | None = None,
    start: int | None = None,
    end: int | None = None,
):
    return storage.open_stream(
        storage_key,
        file_id=file_id,
        start=start,
        end=end,
    )


async def retry_recording_upload(
    db: AsyncSession,
    student_id: int,
    session_id: int,
    recording_id: int,
) -> dict[str, object]:
    await _owned_session(db, student_id, session_id, lock=True)
    recording = await _owned_recording(
        db, student_id, session_id, recording_id, lock=True
    )
    if recording.status != "FAILED" or recording.storage_backend != "gdrive":
        raise InterviewVideoError(409, "recording_not_retryable")
    staging = _storage(backend="local")
    if not staging.recording_path(recording.storage_key).is_file():
        raise InterviewVideoError(409, "recording_staging_file_missing")
    recording.status = "PENDING_UPLOAD"
    recording.error_code = None
    await db.commit()
    return _recording_view(recording)


async def recover_video_uploads(db: AsyncSession) -> int:
    stuck = list(
        (
            await db.scalars(
                select(InterviewRecording).where(
                    InterviewRecording.storage_backend == "gdrive",
                    InterviewRecording.upload_active.is_(True),
                )
            )
        ).all()
    )
    for recording in stuck:
        if recording.completed_at is not None:
            if recording.status != "PENDING_DELETE":
                recording.status = "PENDING_UPLOAD"
            recording.error_code = None
        recording.upload_active = False
    queued_updates = await db.execute(
        update(InterviewRecordingDeletion)
        .where(InterviewRecordingDeletion.upload_active.is_(True))
        .values(upload_active=False)
    )
    if stuck or queued_updates.rowcount:
        await db.commit()
    return len(stuck)


async def process_pending_video_uploads(db: AsyncSession, limit: int = 1) -> int:
    completed = 0
    for _ in range(limit):
        recording = await db.scalar(
            select(InterviewRecording)
            .where(
                InterviewRecording.storage_backend == "gdrive",
                InterviewRecording.status == "PENDING_UPLOAD",
            )
            .order_by(InterviewRecording.created_at)
            .with_for_update(skip_locked=True)
            .limit(1)
        )
        if recording is None:
            break
        recording.status = "UPLOADING"
        recording.upload_active = True
        await db.commit()
        settings = get_settings()
        staging_storage = _storage(settings, backend="local")
        provider_storage = _storage(settings, backend="gdrive")
        path = staging_storage.recording_path(recording.storage_key)
        try:
            file_id = await asyncio.to_thread(
                provider_storage.save_from_path,
                path,
                source_type=recording.source_type,
                user_id=recording.student_id,
                session_id=recording.session_id,
                storage_key=recording.storage_key,
                mime_type=recording.mime_type,
            )
            actual_size = await asyncio.to_thread(
                provider_storage.size,
                recording.storage_key,
                file_id=file_id,
            )
            if actual_size != recording.total_bytes:
                raise InterviewStorageError("uploaded_size_mismatch")
            current = await db.scalar(
                select(InterviewRecording)
                .where(InterviewRecording.id == recording.id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
            deletion = await db.scalar(
                select(InterviewRecordingDeletion)
                .where(InterviewRecordingDeletion.storage_key == recording.storage_key)
                .order_by(InterviewRecordingDeletion.created_at)
                .limit(1)
            )
            if current is None and deletion is None:
                await asyncio.to_thread(
                    provider_storage.delete,
                    recording.storage_key,
                    file_id=file_id,
                )
                continue
            if current is not None:
                current.storage_file_id = file_id
                current.upload_active = False
                if current.status == "PENDING_DELETE" or deletion is not None:
                    current.status = "PENDING_DELETE"
                else:
                    current.status = "AVAILABLE"
                    current.error_code = None
            if deletion is not None:
                deletion.storage_file_id = file_id
                deletion.upload_active = False
            elif current is not None and current.status == "PENDING_DELETE":
                deletion = InterviewRecordingDeletion(
                    storage_key=current.storage_key,
                    storage_backend=current.storage_backend,
                    storage_file_id=file_id,
                    source_type=current.source_type,
                    user_id=current.student_id,
                    session_id=current.session_id,
                    final_status="DELETED",
                )
                db.add(deletion)
            await db.commit()
            await asyncio.to_thread(
                provider_storage.remove_staging,
                recording.storage_key,
            )
            if deletion is not None:
                await process_recording_deletions(db)
            completed += 1
        except Exception as error:
            await db.rollback()
            current = await db.get(InterviewRecording, recording.id)
            if current is not None:
                current.upload_active = False
                if current.status == "UPLOADING":
                    current.status = "FAILED"
                    current.error_code = _storage_error_code(error)
                db.add(
                    InterviewStudioUsageEvent(
                        event_type="VIDEO_STORAGE",
                        status="FAILED",
                        provider_name="gdrive",
                        session_id=current.session_id,
                        http_status=getattr(error, "status_code", None),
                        error_code=_storage_error_code(error),
                    )
                )
            deletion = await db.scalar(
                select(InterviewRecordingDeletion).where(
                    InterviewRecordingDeletion.storage_key == recording.storage_key
                )
            )
            if deletion is not None:
                deletion.upload_active = False
            await db.commit()
            logger.warning(
                "Interview recording storage upload failed.",
                extra={
                    "recording_id": recording.id,
                    "session_id": recording.session_id,
                    "status_code": getattr(error, "status_code", None),
                    "error_code": _storage_error_code(error),
                },
            )
    return completed


def _storage_error_code(error: Exception) -> str:
    if isinstance(error, InterviewStorageError):
        return error.code
    return "storage_provider_error"


async def _mark_for_deletion(
    db: AsyncSession,
    recording: InterviewRecording,
    final_status: str,
    *,
    storage: InterviewVideoStorage | None = None,
) -> None:
    storage_adapter = storage or _recording_storage(recording)
    if recording.upload_active:
        recording.status = "PENDING_DELETE"
        recording.deleted_at = _now()
        db.add(
            InterviewRecordingDeletion(
                storage_key=recording.storage_key,
                storage_backend=recording.storage_backend,
                storage_file_id=recording.storage_file_id,
                source_type=recording.source_type,
                user_id=recording.student_id,
                session_id=recording.session_id,
                upload_active=True,
                final_status=final_status,
            )
        )
        return
    try:
        file_id = recording.storage_file_id
        if recording.storage_backend == "gdrive" and file_id is None:
            file_id = await asyncio.to_thread(
                storage_adapter.find_file_id,
                source_type=recording.source_type,
                user_id=recording.student_id,
                session_id=recording.session_id,
                storage_key=recording.storage_key,
            )
        await asyncio.to_thread(
            storage_adapter.delete,
            recording.storage_key,
            file_id=file_id,
        )
        recording.status = final_status
        recording.deleted_at = _now()
        recording.error_code = None
    except Exception as delete_error:
        recording.status = "PENDING_DELETE"
        recording.deleted_at = _now()
        recording.error_code = _storage_error_code(delete_error)
        db.add(
            InterviewRecordingDeletion(
                storage_key=recording.storage_key,
                storage_backend=recording.storage_backend,
                storage_file_id=recording.storage_file_id,
                source_type=recording.source_type,
                user_id=recording.student_id,
                session_id=recording.session_id,
                upload_active=recording.upload_active,
                final_status=final_status,
                error_code=_storage_error_code(delete_error),
            )
        )
        logger.warning(
            "Interview recording storage deletion queued.",
            extra={
                "recording_id": recording.id,
                "session_id": recording.session_id,
                "status_code": getattr(delete_error, "status_code", None),
                "error_code": _storage_error_code(delete_error),
            },
        )


async def queue_recording_deletions(
    db: AsyncSession,
    recordings: list[InterviewRecording],
) -> None:
    for recording in recordings:
        db.add(
            InterviewRecordingDeletion(
                storage_key=recording.storage_key,
                storage_backend=recording.storage_backend,
                storage_file_id=recording.storage_file_id,
                source_type=recording.source_type,
                user_id=recording.student_id,
                session_id=recording.session_id,
                upload_active=recording.upload_active,
                final_status="DELETED",
            )
        )


async def process_recording_deletions(db: AsyncSession, limit: int = 20) -> int:
    queue = list(
        (
            await db.scalars(
                select(InterviewRecordingDeletion)
                .order_by(InterviewRecordingDeletion.created_at)
                .with_for_update(skip_locked=True)
                .limit(limit)
            )
        ).all()
    )
    deleted = 0
    for item in queue:
        if item.upload_active:
            continue
        storage_adapter = _storage(backend=item.storage_backend)
        try:
            file_id = item.storage_file_id
            if item.storage_backend == "gdrive" and file_id is None:
                file_id = await asyncio.to_thread(
                    storage_adapter.find_file_id,
                    source_type=item.source_type,
                    user_id=item.user_id,
                    session_id=item.session_id or 0,
                    storage_key=item.storage_key,
                )
            await asyncio.to_thread(
                storage_adapter.delete,
                item.storage_key,
                file_id=file_id,
            )
        except Exception as error:
            item.attempts += 1
            item.error_code = _storage_error_code(error)
            db.add(
                InterviewStudioUsageEvent(
                    event_type="VIDEO_STORAGE",
                    status="FAILED",
                    provider_name="gdrive" if item.storage_backend == "gdrive" else "local",
                    session_id=item.session_id,
                    http_status=getattr(error, "status_code", None),
                    error_code=_storage_error_code(error),
                )
            )
            logger.warning(
                "Interview recording deletion retry failed.",
                extra={
                    "status_code": getattr(error, "status_code", None),
                    "error_code": item.error_code,
                },
            )
        else:
            recording = await db.scalar(
                select(InterviewRecording).where(
                    InterviewRecording.storage_key == item.storage_key
                )
            )
            if recording is not None:
                recording.status = item.final_status
                recording.error_code = None
            await db.delete(item)
            deleted += 1
    if queue:
        await db.commit()
    return deleted


async def check_recording_storage_health() -> None:
    settings = get_settings()
    if settings.effective_interview_video_storage_backend != "gdrive":
        return
    storage = _storage(settings)
    try:
        await asyncio.to_thread(storage.health_check)
    except Exception as error:
        logger.error(
            "Google Drive storage health check failed; check the service account "
            "permissions and shared-drive access.",
            extra={
                "status_code": getattr(error, "status_code", None),
                "error_code": _storage_error_code(error),
            },
        )


