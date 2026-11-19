"""Audio transcription, duration validation, and deterministic speech metrics."""

import asyncio
import base64
import hashlib
import hmac
import json
import math
import re
import time
from urllib.parse import urlsplit

import httpx

from app.core.config import Settings, get_settings

AUDIO_EXTENSIONS = {
    "audio/flac": "flac",
    "audio/m4a": "m4a",
    "audio/mp4": "mp4",
    "audio/mpga": "mpga",
    "audio/mpeg": "mp3",
    "audio/ogg": "ogg",
    "audio/wav": "wav",
    "audio/x-m4a": "m4a",
    "audio/x-wav": "wav",
    "audio/webm": "webm",
}
_WORD_PATTERN = re.compile(r"\b[\w]+(?:['’][\w]+)*\b", re.UNICODE)
_FILLER_PATTERN = re.compile(r"\b(?:erm|uh|um|er|hmm|mm)\b", re.IGNORECASE)
_MAX_AUDIO_BYTES = 10 * 1024 * 1024
_DURATION_TOKEN_TTL_SECONDS = 30 * 60


class InterviewVoiceError(RuntimeError):
    def __init__(self, status_code: int, code: str):
        super().__init__(code)
        self.status_code = status_code
        self.code = code


def _encoded(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _decoded(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


async def _audio_duration(
    audio: bytes,
    *,
    settings: Settings,
) -> float:
    timeout_seconds = 10
    max_duration = settings.interview_stt_max_duration_seconds
    command = [
        settings.interview_ffprobe_path,
        "-v",
        "error",
        "-select_streams",
        "a:0",
        "-read_intervals",
        f"%+{max_duration + 1}",
        "-show_packets",
        "-show_entries",
        "packet=pts_time,duration_time:stream=start_time,duration",
        "-of",
        "json",
        "-i",
        "pipe:0",
    ]
    try:
        process = await asyncio.create_subprocess_exec(
            *command,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
    except FileNotFoundError:
        raise InterviewVoiceError(503, "audio_duration_unavailable") from None

    try:
        stdout, _ = await asyncio.wait_for(
            process.communicate(audio),
            timeout=timeout_seconds,
        )
    except asyncio.TimeoutError:
        process.kill()
        await process.communicate()
        raise InterviewVoiceError(422, "audio_duration_unavailable") from None

    if process.returncode != 0:
        raise InterviewVoiceError(422, "invalid_audio")
    try:
        metadata = json.loads(stdout)
        packets = metadata.get("packets", [])
        starts = [
            float(packet["pts_time"])
            for packet in packets
            if packet.get("pts_time") not in (None, "N/A")
        ]
        ends = [
            float(packet["pts_time"]) + float(packet.get("duration_time") or 0)
            for packet in packets
            if packet.get("pts_time") not in (None, "N/A")
        ]
        duration = max(ends) - min(starts) if starts and ends else 0
        if duration <= 0:
            streams = metadata.get("streams", [])
            stream_durations = [
                float(stream["duration"])
                for stream in streams
                if stream.get("duration") not in (None, "N/A")
            ]
            duration = max(stream_durations, default=0)
    except (ValueError, KeyError, TypeError, json.JSONDecodeError):
        raise InterviewVoiceError(422, "invalid_audio") from None

    if not math.isfinite(duration) or duration < 0.01:
        raise InterviewVoiceError(422, "audio_too_short")
    if duration > max_duration:
        raise InterviewVoiceError(413, "audio_too_long")
    return round(duration, 3)


class InterviewSTTProvider:
    """Whisper-compatible provider isolated from the interview LLM adapter."""

    def __init__(
        self,
        settings: Settings | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
    ):
        self._settings = settings or get_settings()
        self._transport = transport

    @property
    def is_configured(self) -> bool:
        return bool(self._settings.interview_stt_api_key)

    async def transcribe(self, audio: bytes, content_type: str) -> str:
        if not self._settings.interview_stt_api_key:
            raise InterviewVoiceError(503, "stt_not_configured")
        url = self._transcription_url()
        media_type = content_type.split(";", 1)[0].strip().casefold()
        extension = AUDIO_EXTENSIONS.get(media_type)
        if extension is None:
            raise InterviewVoiceError(415, "unsupported_audio_type")

        try:
            async with httpx.AsyncClient(
                timeout=self._settings.interview_stt_timeout_seconds,
                transport=self._transport,
            ) as client:
                response = await client.post(
                    url,
                    headers={
                        "Authorization": f"Bearer {self._settings.interview_stt_api_key}",
                        "Accept": "application/json",
                    },
                    data={
                        "model": self._settings.interview_stt_model,
                        "response_format": "json",
                        "temperature": "0",
                    },
                    files={
                        "file": (
                            f"interview-answer.{extension}",
                            audio,
                            media_type,
                        )
                    },
                )
                response.raise_for_status()
        except httpx.TimeoutException:
            raise InterviewVoiceError(503, "stt_timeout") from None
        except httpx.HTTPStatusError as error:
            code = (
                "stt_rate_limited"
                if error.response.status_code == 429
                else "stt_unavailable"
                if error.response.status_code >= 500
                else "stt_rejected_request"
            )
            raise InterviewVoiceError(503, code) from None
        except httpx.RequestError:
            raise InterviewVoiceError(503, "stt_unavailable") from None

        try:
            body = response.json()
            transcript = body["text"]
            if not isinstance(transcript, str):
                raise ValueError
        except (ValueError, KeyError, TypeError):
            raise InterviewVoiceError(502, "stt_invalid_response") from None
        transcript = transcript.strip()
        if not transcript:
            raise InterviewVoiceError(422, "stt_empty_transcript")
        return transcript

    def _transcription_url(self) -> str:
        base_url = self._settings.interview_stt_base_url.strip().rstrip("/")
        if base_url.casefold().endswith("/v1"):
            base_url = base_url[:-3].rstrip("/")
        parsed = urlsplit(base_url)
        allowed_hosts = {
            host.strip().casefold()
            for host in self._settings.interview_allowed_provider_hosts
            if host.strip()
        }
        if (
            parsed.scheme not in {"http", "https"}
            or not parsed.hostname
            or parsed.hostname.casefold() not in allowed_hosts
        ):
            raise InterviewVoiceError(503, "stt_not_configured")
        return f"{base_url}/v1/audio/transcriptions"


async def transcribe_audio_clip(
    audio: bytes,
    content_type: str,
    provider: InterviewSTTProvider | None = None,
) -> tuple[str, float]:
    settings = get_settings()
    media_type = content_type.split(";", 1)[0].strip().casefold()
    if media_type not in AUDIO_EXTENSIONS:
        raise InterviewVoiceError(415, "unsupported_audio_type")
    if not audio:
        raise InterviewVoiceError(422, "audio_empty")
    if len(audio) > min(settings.interview_stt_max_audio_bytes, _MAX_AUDIO_BYTES):
        raise InterviewVoiceError(413, "audio_too_large")
    provider = provider or InterviewSTTProvider(settings)
    if not provider.is_configured:
        raise InterviewVoiceError(503, "stt_not_configured")
    duration = await _audio_duration(audio, settings=settings)
    transcript = await provider.transcribe(audio, media_type)
    return transcript, duration


def create_audio_duration_token(
    duration_seconds: float,
    *,
    student_id: int,
    session_id: int,
    question_id: int,
    settings: Settings | None = None,
) -> str:
    settings = settings or get_settings()
    payload = json.dumps(
        {
            "duration": duration_seconds,
            "student": student_id,
            "session": session_id,
            "question": question_id,
            "expires": int(time.time()) + _DURATION_TOKEN_TTL_SECONDS,
        },
        separators=(",", ":"),
    ).encode("utf-8")
    signature = hmac.new(
        settings.secret_key.encode("utf-8"),
        payload,
        hashlib.sha256,
    ).digest()
    return f"{_encoded(payload)}.{_encoded(signature)}"


def verify_audio_duration_token(
    token: str,
    *,
    student_id: int,
    session_id: int,
    question_id: int,
    settings: Settings | None = None,
) -> float:
    settings = settings or get_settings()
    try:
        encoded_payload, encoded_signature = token.split(".", 1)
        payload = _decoded(encoded_payload)
        supplied_signature = _decoded(encoded_signature)
        expected_signature = hmac.new(
            settings.secret_key.encode("utf-8"),
            payload,
            hashlib.sha256,
        ).digest()
        if not hmac.compare_digest(supplied_signature, expected_signature):
            raise ValueError
        claims = json.loads(payload)
        duration = float(claims["duration"])
        if (
            claims["student"] != student_id
            or claims["session"] != session_id
            or claims["question"] != question_id
            or int(claims["expires"]) < int(time.time())
            or not math.isfinite(duration)
            or duration < 0.01
        ):
            raise ValueError
        return duration
    except (ValueError, TypeError, KeyError, json.JSONDecodeError):
        raise InterviewVoiceError(422, "invalid_audio_duration_token") from None


def count_voice_metrics(
    transcript: str,
    duration_seconds: float | None,
) -> dict[str, int | float | None]:
    word_count = len(_WORD_PATTERN.findall(transcript))
    filler_word_count = len(_FILLER_PATTERN.findall(transcript))
    speaking_pace = (
        round(word_count * 60 / duration_seconds, 2)
        if duration_seconds is not None and duration_seconds > 0
        else None
    )
    return {
        "word_count": word_count,
        "speaking_pace_wpm": speaking_pace,
        "filler_word_count": filler_word_count,
    }
