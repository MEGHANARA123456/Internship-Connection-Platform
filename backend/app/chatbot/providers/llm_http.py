"""Vendor-neutral OpenAI-compatible HTTP chat completion provider."""

import asyncio
import json
import logging
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from ..chatbot_config import ChatbotConfig
from ..prompts import system_prompt_for
from ..redaction import redact
from .base import ProviderPayload, ProviderResult

logger = logging.getLogger("internsphere.chatbot")


def _extract_json_object(content: str) -> dict[str, object]:
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
        self._config = config

    async def rewrite(self, payload: ProviderPayload) -> ProviderResult:
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
            "live_data": (
                f"<<<UNTRUSTED_LIVE_DATA>>>\n{payload.live_data}\n<<<END_UNTRUSTED_LIVE_DATA>>>"
                if payload.live_data is not None
                else None
            ),
        }
        headers = {"Content-Type": "application/json"}
        if self._config.api_key:
            headers["Authorization"] = f"Bearer {self._config.api_key}"
        try:
            completion = None
            content = ""
            for attempt in range(2):
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
                if self._config.model.lower().startswith("gpt-oss"):
                    body["reasoning_effort"] = "low"
                request = Request(
                    f"{self._config.base_url}/v1/chat/completions",
                    data=json.dumps(body).encode("utf-8"),
                    headers=headers,
                    method="POST",
                )
                response_bytes = await asyncio.wait_for(
                    asyncio.to_thread(self._post, request),
                    timeout=self._config.timeout_seconds,
                )
                response = json.loads(response_bytes)
                choices = response.get("choices")
                if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
                    raise ValueError("Provider response has no completion choice.")
                completion = choices[0]
                finish_reason = completion.get("finish_reason")
                logger.info(
                    "chatbot_provider_finish",
                    extra={"chatbot_meta": {"finish_reason": finish_reason}},
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
            return ProviderResult(
                parsed["answerable"],
                parsed["answer"],
                tuple(source_values),
                float(confidence),
            )
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
        with urlopen(request, timeout=self._config.timeout_seconds) as response:
            return response.read(256_000)
