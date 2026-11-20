import asyncio
import json

import httpx
import pytest

from app.core.config import Settings
import app.services.interview_voice as voice_service
from app.services.interview_voice import (
    InterviewSTTProvider,
    InterviewVoiceError,
    create_audio_duration_token,
    verify_audio_duration_token,
)


@pytest.mark.anyio
async def test_stt_adapter_uses_independent_key_and_whisper_endpoint():
    requests: list[httpx.Request] = []

    def respond(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json={"text": "A clear transcript."})

    provider = InterviewSTTProvider(
        Settings(
            interview_stt_base_url="https://api.groq.com/openai/v1",
            interview_stt_model="whisper-large-v3-turbo",
            interview_stt_api_key="stt-test-key",
        ),
        transport=httpx.MockTransport(respond),
    )

    transcript = await provider.transcribe(b"audio bytes", "audio/webm")

    assert transcript == "A clear transcript."
    assert len(requests) == 1
    assert requests[0].url.path == "/openai/v1/audio/transcriptions"
    assert requests[0].headers["Authorization"] == "Bearer stt-test-key"
    assert b"whisper-large-v3-turbo" in requests[0].content
    assert b"interview-answer.webm" in requests[0].content


@pytest.mark.anyio
async def test_stt_provider_error_is_sanitized_and_429_is_retryable():
    provider = InterviewSTTProvider(
        Settings(interview_stt_api_key="stt-test-key"),
        transport=httpx.MockTransport(
            lambda _request: httpx.Response(429, text="sensitive provider response body")
        ),
    )

    with pytest.raises(InterviewVoiceError) as error:
        await provider.transcribe(b"audio bytes", "audio/webm")

    assert error.value.status_code == 503
    assert error.value.code == "stt_rate_limited"
    assert "sensitive provider response body" not in str(error.value)


def test_audio_duration_token_is_bound_to_student_session_and_question():
    settings = Settings(secret_key="test-secret")
    token = create_audio_duration_token(
        12.5,
        student_id=3,
        session_id=7,
        question_id=11,
        settings=settings,
    )

    assert verify_audio_duration_token(
        token,
        student_id=3,
        session_id=7,
        question_id=11,
        settings=settings,
    ) == 12.5
    with pytest.raises(InterviewVoiceError) as error:
        verify_audio_duration_token(
            token,
            student_id=4,
            session_id=7,
            question_id=11,
            settings=settings,
        )
    assert error.value.code == "invalid_audio_duration_token"


@pytest.mark.anyio
async def test_audio_duration_is_probed_and_server_limit_is_enforced(monkeypatch):
    class FakeProbe:
        returncode = 0

        def __init__(self, packets):
            self.packets = packets

        async def communicate(self, _audio):
            return json.dumps({"packets": self.packets}).encode(), b""

    probes = [
        FakeProbe([{"pts_time": "0", "duration_time": "2.5"}]),
        FakeProbe([{"pts_time": "0", "duration_time": "181"}]),
    ]

    async def create_process(*_args, **_kwargs):
        return probes.pop(0)

    monkeypatch.setattr(asyncio, "create_subprocess_exec", create_process)
    settings = Settings(interview_stt_max_duration_seconds=180)

    assert await voice_service._audio_duration(b"audio", settings=settings) == 2.5
    with pytest.raises(InterviewVoiceError) as error:
        await voice_service._audio_duration(b"audio", settings=settings)
    assert error.value.status_code == 413
    assert error.value.code == "audio_too_long"
