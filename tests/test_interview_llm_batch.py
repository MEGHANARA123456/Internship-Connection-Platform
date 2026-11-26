import json
from unittest.mock import AsyncMock

import httpx
import pytest

from app.core.config import Settings
from app.services.interview_llm import InterviewLLMProvider


def _items(count: int = 2, *, answer_size: int = 50) -> list[dict[str, object]]:
    return [
        {
            "question_id": question_id,
            "question": f"Question {question_id}",
            "rubric": "Explain the approach and its outcome.",
            "answer": f"Answer {question_id}. " + ("A" * answer_size),
            "transcript_stats": {
                "duration_seconds": 30,
                "word_count": 40,
                "speaking_pace_wpm": 80,
                "filler_word_count": 1,
            },
        }
        for question_id in range(1, count + 1)
    ]


def _response_content(question_ids: list[int]) -> str:
    return json.dumps(
        {
            "answers": [
                {
                    "question_id": question_id,
                    "score": 8,
                    "strengths": ["Clear explanation"],
                    "improvements": ["Add a measurable outcome"],
                    "suggested_answer": "A concise example with a measurable outcome.",
                }
                for question_id in question_ids
            ],
            "report": {
                "overall_score": 80,
                "summary": "The attempt demonstrates clear reasoning.",
                "top_strengths": ["Clear explanation"],
                "top_improvements": ["Add a measurable outcome"],
                "next_steps": ["Practice concise examples."],
            },
        }
    )


def _response_for_request(request: httpx.Request) -> httpx.Response:
    body = json.loads(request.content)
    payload = json.loads(body["messages"][1]["content"])
    question_ids = [
        item["question_id"] for item in payload.get("answers", [])
    ]
    return httpx.Response(
        200,
        json={
            "choices": [
                {"message": {"content": _response_content(question_ids)}}
            ]
        },
    )


def _settings(**overrides: object) -> Settings:
    defaults: dict[str, object] = {
        "llm_providers": "groq",
        "groq_api_key": "test-groq-key",
        "groq_base_url": "https://api.groq.com/openai",
        "groq_model": "test-groq-model",
        "llm_max_retries": 3,
        "llm_tpm_limit": 6000,
        "interview_llm_timeout_seconds": 1,
    }
    defaults.update(overrides)
    return Settings(**defaults)


@pytest.mark.anyio
async def test_attempt_batch_success_is_one_request_and_accepts_markdown_fences():
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        body = json.loads(request.content)
        payload = json.loads(body["messages"][1]["content"])
        ids = [item["question_id"] for item in payload["answers"]]
        content = f"```json\n{_response_content(ids)}\n```"
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": content}}]},
        )

    provider = InterviewLLMProvider(
        _settings(),
        transport=httpx.MockTransport(handler),
    )
    result = await provider.evaluate_attempt_with_usage(
        _items(),
        attempt_id=42,
    )

    assert calls == 1
    assert [answer.question_id for answer in result.answers] == [1, 2]
    assert result.report is not None
    assert result.report.overall_score == 80
    assert result.answer_providers == {
        1: ("groq", "test-groq-model"),
        2: ("groq", "test-groq-model"),
    }


@pytest.mark.anyio
async def test_invalid_json_retries_once_with_stricter_prompt():
    requests: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        requests.append(body)
        if len(requests) == 1:
            content = "not json"
        else:
            payload = json.loads(body["messages"][1]["content"])
            content = _response_content(
                [item["question_id"] for item in payload["answers"]]
            )
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": content}}]},
        )

    provider = InterviewLLMProvider(
        _settings(),
        transport=httpx.MockTransport(handler),
    )
    result = await provider.evaluate_attempt_with_usage(
        _items(1),
        attempt_id=43,
    )

    assert len(requests) == 2
    assert "previous response was invalid" in requests[1]["messages"][0]["content"]
    assert result.answers[0].question_id == 1


@pytest.mark.anyio
async def test_rate_limit_fails_over_to_second_configured_provider(monkeypatch):
    hosts: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        hosts.append(request.url.host)
        if request.url.host == "api.groq.com":
            return httpx.Response(
                429,
                headers={"Retry-After": "0"},
                json={"error": {"code": "rate_limit", "message": "slow down"}},
            )
        return _response_for_request(request)

    monkeypatch.setattr(
        "app.services.interview_llm.asyncio.sleep",
        AsyncMock(),
    )
    provider = InterviewLLMProvider(
        _settings(
            llm_providers="groq,gemini",
            gemini_api_key="test-gemini-key",
            gemini_base_url="https://generativelanguage.googleapis.com/v1beta/openai",
            gemini_model="test-gemini-model",
        ),
        transport=httpx.MockTransport(handler),
    )
    result = await provider.evaluate_attempt_with_usage(
        _items(1),
        attempt_id=44,
    )

    assert hosts == [
        "api.groq.com",
        "generativelanguage.googleapis.com",
    ]
    assert result.answer_providers[1] == (
        "gemini",
        "test-gemini-model",
    )


@pytest.mark.anyio
async def test_large_prompt_prefers_configured_large_batch_provider():
    hosts: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        hosts.append(request.url.host)
        return _response_for_request(request)

    provider = InterviewLLMProvider(
        _settings(
            llm_providers="groq,gemini",
            gemini_api_key="test-gemini-key",
            gemini_base_url="https://generativelanguage.googleapis.com/v1beta/openai",
            gemini_model="test-gemini-model",
            llm_batch_large_prompt_tokens=1,
            llm_batch_provider_order="gemini,groq",
        ),
        transport=httpx.MockTransport(handler),
    )
    await provider.evaluate_attempt_with_usage(
        _items(1),
        attempt_id=45,
    )

    assert hosts == ["generativelanguage.googleapis.com"]


@pytest.mark.anyio
async def test_missing_answer_is_reasked_without_resending_completed_answer():
    payloads: list[list[int]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        payload = json.loads(body["messages"][1]["content"])
        requested = [item["question_id"] for item in payload.get("answers", [])]
        payloads.append(requested)
        returned = requested if len(payloads) > 1 else requested[:1]
        content = json.loads(_response_content(returned))
        if len(payloads) == 1:
            content["report"] = json.loads(_response_content(returned))["report"]
        return httpx.Response(
            200,
            json={
                "choices": [
                    {"message": {"content": json.dumps(content)}}
                ]
            },
        )

    provider = InterviewLLMProvider(
        _settings(),
        transport=httpx.MockTransport(handler),
    )
    result = await provider.evaluate_attempt_with_usage(
        _items(2),
        attempt_id=46,
    )

    assert payloads == [[1, 2], [2]]
    assert [answer.question_id for answer in result.answers] == [1, 2]


@pytest.mark.anyio
async def test_oversized_attempt_splits_answers_then_generates_report():
    calls: list[list[int]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        payload = json.loads(body["messages"][1]["content"])
        ids = [item["question_id"] for item in payload.get("answers", [])]
        calls.append(ids)
        if not ids:
            content = _response_content([])
        else:
            content = _response_content(ids)
            content_json = json.loads(content)
            content_json["report"] = None
            content = json.dumps(content_json)
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": content}}]},
        )

    provider = InterviewLLMProvider(
        _settings(llm_batch_max_prompt_tokens=650),
        transport=httpx.MockTransport(handler),
    )
    result = await provider.evaluate_attempt_with_usage(
        _items(4, answer_size=5000),
        attempt_id=47,
    )

    answer_calls = [call for call in calls if call]
    assert len(answer_calls) > 1
    assert [len(call) for call in answer_calls] == [2, 2]
    assert calls[-1] == []
    assert sorted(question_id for call in answer_calls for question_id in call) == [
        1,
        2,
        3,
        4,
    ]
    assert result.report is not None
