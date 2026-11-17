"""Vendor-neutral OpenAI-compatible HTTP chat completion provider."""

import asyncio
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import json
import logging
import math
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from ..chatbot_config import ChatbotConfig
from ..prompts import system_prompt_for
from ..redaction import redact
from .base import ProviderPayload, ProviderResult

logger = logging.getLogger("internsphere.chatbot")


class ProviderRateLimitError(RuntimeError):
    """A provider 429 response with a bounded Retry-After delay."""

    def __init__(self, retry_after: int):
        super().__init__("Chatbot answer provider rate limit reached.")
        self.retry_after = retry_after


def _retry_after_seconds(value: str | None) -> int:
    """Parse Retry-After seconds or HTTP dates without exposing provider response content."""
    if not value:
        return 60
    try:
        return max(1, min(86400, math.ceil(float(value))))
    except (ValueError, OverflowError):
        try:
            retry_at = parsedate_to_datetime(value)
            if retry_at.tzinfo is None:
                retry_at = retry_at.replace(tzinfo=timezone.utc)
            return max(
                1,
                min(86400, math.ceil((retry_at - datetime.now(timezone.utc)).total_seconds())),
            )
        except (TypeError, ValueError, OverflowError):
            return 60


def _extract_json_object(content: str) -> dict[str, object]:
    """Parse the first complete JSON object, tolerating optional Markdown code fences."""
    text = content.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        if lines and lines[-1].strip() == "```":
            lines = lines[1:-1]
        else:
            lines = lines[1:]
        text = "\n".join(lines).strip()

    start = text.find("{")
    if start < 0:
        raise ValueError("Provider response contains no JSON object.")

    depth = 0
    in_string = False
    escaped = False
    for index in range(start, len(text)):
        character = text[index]
        if in_string:
            if escaped:
                escaped = False
            elif character == "\\":
                escaped = True
            elif character == '"':
                in_string = False
        elif character == '"':
            in_string = True
        elif character == "{":
            depth += 1
        elif character == "}":
            depth -= 1
            if depth == 0:
                parsed = json.loads(text[start:index + 1])
                if not isinstance(parsed, dict):
                    raise ValueError("Provider response must be a JSON object.")
                return parsed
    raise ValueError("Provider response contains an incomplete JSON object.")


class LLMHTTPProvider:
    def __init__(self, config: ChatbotConfig):
        """Store provider configuration for subsequent completion requests."""
        self._config = config

    async def rewrite(
        self,
        payload: ProviderPayload,
        *,
        retry_on_truncation: bool = True,
    ) -> ProviderResult:
        """Send redacted, untrusted-context-wrapped input and validate the model's JSON answer."""
        passages = [
            {
                "id": item.id,
                "title": item.title,
                "reference": (
                    f"<<<UNTRUSTED_REFERENCE id={item.id}>>>\n"
                    f"{item.text}\n<<<END_UNTRUSTED_REFERENCE>>>"
                ),
                "routes": item.related_routes,
            }
            for item in payload.passages
        ]
        safe_payload = {
            "role": payload.role,
            "page": payload.page,
            "question": redact(payload.question),
            "history": [
                {"role": role, "content": redact(text)}
                for role, text in payload.history
            ],
            "passages": passages,
        }
        headers = {"Content-Type": "application/json",
    "Accept": "application/json",
    "User-Agent": "InternSphere/1.0",}
        if self._config.api_key:
            headers["Authorization"] = "Bearer " + self._config.api_key
        try:
            completion = None
            content = ""
            prompt_tokens = 0
            completion_tokens = 0
            total_tokens = 0
            usage_reported = False
            attempts = 1 + self._config.retries if retry_on_truncation else 1
            for attempt in range(attempts):
                body = {
                    "model": self._config.model,
                    "temperature": self._config.temperature,
                    "max_tokens": 1500 if attempt else self._config.max_tokens,
                    "stream": False,
                    "messages": [
                        {"role": "system", "content": system_prompt_for(payload.role)},
                        {"role": "user", "content": json.dumps(safe_payload)},
                    ],
                }
                if "gpt-oss" in self._config.model.lower():
                    body["reasoning_effort"] = "low"
                body["response_format"] = {"type": "json_object"}
                request = Request(
                    f"{self._config.base_url}/v1/chat/completions",
                    data=json.dumps(body).encode("utf-8"),
                    headers=headers,
                    method="POST",
                )
                try:
                    response_bytes = await asyncio.wait_for(
                        asyncio.to_thread(self._post, request),
                        timeout=self._config.timeout_seconds,
                    )
                except ProviderRateLimitError:
                    raise
                except HTTPError as error:
                    if error.code == 429:
                        raise ProviderRateLimitError(
                            _retry_after_seconds(
                                (error.headers or {}).get("Retry-After")
                            )
                        ) from error
                    raise
                response = json.loads(response_bytes)
                if not isinstance(response, dict):
                    raise ValueError("Provider response must be a JSON object.")
                usage = response.get("usage")
                request_prompt_tokens = 0
                request_completion_tokens = 0
                if isinstance(usage, dict):
                    raw_prompt_tokens = usage.get("prompt_tokens")
                    raw_completion_tokens = usage.get("completion_tokens")
                    if (
                        isinstance(raw_prompt_tokens, int)
                        and not isinstance(raw_prompt_tokens, bool)
                        and raw_prompt_tokens >= 0
                        and isinstance(raw_completion_tokens, int)
                        and not isinstance(raw_completion_tokens, bool)
                        and raw_completion_tokens >= 0
                    ):
                        request_prompt_tokens = raw_prompt_tokens
                        request_completion_tokens = raw_completion_tokens
                        prompt_tokens += request_prompt_tokens
                        completion_tokens += request_completion_tokens
                        total_tokens += max(
                            request_prompt_tokens + request_completion_tokens,
                            usage.get("total_tokens", 0)
                            if isinstance(usage.get("total_tokens"), int)
                            and not isinstance(usage.get("total_tokens"), bool)
                            else 0,
                        )
                        usage_reported = True
                choices = response.get("choices")
                if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
                    raise ValueError("Provider response has no completion choice.")
                completion = choices[0]
                finish_reason = completion.get("finish_reason")
                logger.info(
                    "chatbot_provider_finish finish_reason=%s prompt_tokens=%d "
                    "completion_tokens=%d total_tokens=%d retry=%d",
                    finish_reason,
                    request_prompt_tokens,
                    request_completion_tokens,
                    (
                        max(
                            request_prompt_tokens + request_completion_tokens,
                            usage.get("total_tokens", 0)
                            if isinstance(usage, dict)
                            and isinstance(usage.get("total_tokens"), int)
                            and not isinstance(usage.get("total_tokens"), bool)
                            else 0,
                        )
                        if usage_reported
                        else 0
                    ),
                    attempt,
                    extra={
                        "chatbot_meta": {
                            "finish_reason": finish_reason,
                            "prompt_tokens": request_prompt_tokens,
                            "completion_tokens": request_completion_tokens,
                            "total_tokens": (
                                max(
                                    request_prompt_tokens + request_completion_tokens,
                                    usage.get("total_tokens", 0)
                                    if isinstance(usage, dict)
                                    and isinstance(usage.get("total_tokens"), int)
                                    and not isinstance(usage.get("total_tokens"), bool)
                                    else 0,
                                )
                                if usage_reported
                                else 0
                            ),
                            "retry": attempt,
                        }
                    },
                )
                message = completion.get("message")
                content_value = message.get("content") if isinstance(message, dict) else None
                content = content_value if isinstance(content_value, str) else ""
                if attempt == 0 and (finish_reason == "length" or not content.strip()):
                    continue
                if not content.strip():
                    raise ValueError("Provider response content is empty.")
                break

            if completion is None:
                raise ValueError("Provider response has no completion.")
            parsed = _extract_json_object(content)
            if not isinstance(parsed.get("answerable"), bool) or not isinstance(parsed.get("answer"), str):
                raise ValueError("Provider response does not match the required schema.")
            source_values = parsed.get("used_chunk_ids")
            if not isinstance(source_values, list) or not all(isinstance(value, str) for value in source_values):
                raise ValueError("Provider sources do not match the required schema.")
            confidence = parsed.get("confidence")
            if not isinstance(confidence, (int, float)) or not 0 <= confidence <= 1:
                raise ValueError("Provider confidence does not match the required schema.")
            needs_clarification = parsed.get("needs_clarification")
            if needs_clarification is not None and not isinstance(needs_clarification, str):
                raise ValueError("Provider clarification does not match the required schema.")
            return ProviderResult(
                parsed["answerable"],
                parsed["answer"],
                tuple(source_values),
                float(confidence),
                needs_clarification,
                prompt_tokens,
                completion_tokens,
                total_tokens,
                attempt,
                usage_reported,
            )
        except ProviderRateLimitError:
            raise
        except (
            asyncio.TimeoutError,
            HTTPError,
            URLError,
            KeyError,
            IndexError,
            TypeError,
            ValueError,
            json.JSONDecodeError,
        ) as error:
            raise RuntimeError("Chatbot answer provider request failed.") from error

    def _post(self, request: Request) -> bytes:
        """Perform the blocking HTTP request and cap the response body at 256 KB."""
        try:
            with urlopen(request, timeout=self._config.timeout_seconds) as response:
                return response.read(256_000)
        except HTTPError as error:
            if error.code == 429:
                raise ProviderRateLimitError(
                    _retry_after_seconds((error.headers or {}).get("Retry-After"))
                ) from error
            raise
