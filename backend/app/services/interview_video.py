"""Owner-scoped consent, chunk upload, retention, and streaming for video interviews."""

import asyncio
import json
import math
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.models import InterviewConsent, InterviewRecording, InterviewSession
from app.services.interview_studio_settings import (
    get_interview_studio_setting,
    interview_studio_feature_enabled,
)
from app.services.interview_video_storage import (
    InterviewVideoStorage,
    LocalPrivateInterviewVideoStorage,
)

VIDEO_RECORDING_CONSENT_VERSION = "2026-11-v1"
VIDEO_MIME_TYPES = {"video/webm", "video/mp4"}


class InterviewVideoError(RuntimeError):
    def __init__(self, status_code: int, code: str):
        super().__init__(code)
        self.status_code = status_code
        self.code = code


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


def _storage(settings: Settings | None = None) -> InterviewVideoStorage:
    configured = settings or get_settings()
    return LocalPrivateInterviewVideoStorage(configured.interview_video_storage_path)


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
        "mime_type": recording.mime_type,
        "chunk_count": recording.chunk_count,
        "next_chunk_index": recording.chunk_count,
        "total_bytes": recording.total_bytes,
        "duration_seconds": recording.duration_seconds,
        "retention_expires_at": recording.retention_expires_at,
        "created_at": recording.created_at,
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
    storage_adapter = storage or _storage()
    for recording in recordings:
        if recording.status in {"AVAILABLE", "UPLOADING"} and (
            _aware(recording.retention_expires_at) <= _now()
        ):
            await asyncio.to_thread(
                storage_adapter.delete,
                recording.storage_key,
            )
            recording.status = "EXPIRED"
    if recordings:
        await db.commit()
    visible_recordings = [
        _recording_view(recording)
        for recording in recordings
        if recording.status in {"UPLOADING", "AVAILABLE"}
    ]
    return {
        "required_consent_version": VIDEO_RECORDING_CONSENT_VERSION,
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
    existing = await db.scalar(
        select(InterviewRecording)
        .where(
            InterviewRecording.session_id == session.id,
            InterviewRecording.student_id == student_id,
            InterviewRecording.status.in_(("UPLOADING", "AVAILABLE")),
        )
        .order_by(InterviewRecording.created_at.desc())
    )
    if existing is not None:
        if existing.status == "UPLOADING":
            return _recording_view(existing)
    retention_days = int(
        await get_interview_studio_setting(db, "retention_days")
    )
    recording = InterviewRecording(
        session_id=session.id,
        student_id=student_id,
        storage_key=str(uuid.uuid4()),
        status="UPLOADING",
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
    if recording.total_bytes + len(content) > settings.interview_video_max_bytes:
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
    if duration > settings.interview_video_max_duration_seconds:
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
        await asyncio.to_thread((storage or _storage()).delete, recording.storage_key)
        recording.status = "EXPIRED"
        await db.commit()
        raise InterviewVideoError(410, "recording_expired")
    if recording.status == "AVAILABLE":
        return _recording_view(recording)
    if recording.status != "UPLOADING":
        raise InterviewVideoError(404, "recording_not_found")
    if recording.chunk_count == 0:
        raise InterviewVideoError(422, "video_recording_empty")

    settings = get_settings()
    storage = storage or _storage(settings)
    await asyncio.to_thread(
        storage.assemble, recording.storage_key, recording.chunk_count
    )
    if recording.total_bytes > settings.interview_video_max_bytes:
        raise InterviewVideoError(413, "video_recording_too_large")
    duration = await _recording_duration(storage, recording.storage_key, settings)
    if session.started_at is not None:
        actual_session_duration = max(
            0.0, (_now() - _aware(session.started_at)).total_seconds()
        )
        if actual_session_duration > settings.interview_video_max_duration_seconds + 60:
            raise InterviewVideoError(413, "video_recording_exceeds_session_limit")
    recording.status = "AVAILABLE"
    recording.duration_seconds = duration
    recording.completed_at = _now()
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
        await asyncio.to_thread((storage or _storage()).delete, recording.storage_key)
        recording.status = "EXPIRED"
        await db.commit()
        raise InterviewVideoError(404, "recording_not_found")
    storage = storage or _storage()
    path = storage.recording_path(recording.storage_key)
    if not path.is_file():
        recording.status = "FAILED"
        await db.commit()
        raise InterviewVideoError(404, "recording_not_found")
    return recording, storage


async def delete_recording(
    db: AsyncSession,
    student_id: int,
    session_id: int,
    recording_id: int,
    *,
    storage: InterviewVideoStorage | None = None,
) -> None:
    await _owned_session(db, student_id, session_id, lock=True)
    recording = await _owned_recording(
        db, student_id, session_id, recording_id, lock=True
    )
    await asyncio.to_thread((storage or _storage()).delete, recording.storage_key)
    recording.status = "DELETED"
    recording.deleted_at = _now()
    await db.commit()


async def expire_video_recordings(db: AsyncSession) -> int:
    now = _now()
    recordings = list(
        (
            await db.scalars(
                select(InterviewRecording)
                .where(
                    InterviewRecording.status.in_(("UPLOADING", "AVAILABLE")),
                    InterviewRecording.retention_expires_at <= now,
                )
                .with_for_update(skip_locked=True)
            )
        ).all()
    )
    if not recordings:
        return 0
    storage = _storage()
    for recording in recordings:
        await asyncio.to_thread(storage.delete, recording.storage_key)
        recording.status = "EXPIRED"
    await db.commit()
    return len(recordings)


def recording_chunk_stream(storage: InterviewVideoStorage, storage_key: str):
    return storage.iter_recording(storage_key)


