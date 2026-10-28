"""Vendor-neutral OpenAI-compatible HTTP chat completion provider."""

import asyncio
import json
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from ..chatbot_config import ChatbotConfig
from ..prompts import system_prompt_for
from .base import ProviderPayload, ProviderResult


class LLMHTTPProvider:
    def __init__(self, config: ChatbotConfig):
        self._config = config

    async def rewrite(self, payload: ProviderPayload) -> ProviderResult:
        passages = [
            {
                "id": item.id,
                "title": item.title,
                "reference": f"<<<UNTRUSTED_REFERENCE id={item.id}>>>\n{item.text}\n<<<END_UNTRUSTED_REFERENCE>>>",
                "routes": item.related_routes,
            }
            for item in payload.passages
        ]
        safe_payload = {
            "role": payload.role,
            "page": payload.page,
            "question": payload.question,
            "history": [{"role": role, "content": text} for role, text in payload.history],
            "passages": passages,
        }
        body = json.dumps({
            "model": self._config.model,
            "temperature": self._config.temperature,
            "max_tokens": self._config.max_tokens,
            "stream": False,
            "messages": [
                {"role": "system", "content": system_prompt_for(payload.role)},
                {"role": "user", "content": json.dumps(safe_payload)},
            ],
        }).encode("utf-8")
        headers = {"Content-Type": "application/json"}
        if self._config.api_key:
            headers["Authorization"] = f"Bearer {self._config.api_key}"
        request = Request(
            f"{self._config.base_url}/v1/chat/completions",
            data=body,
            headers=headers,
            method="POST",
        )
        try:
            response_bytes = await asyncio.wait_for(
                asyncio.to_thread(self._post, request),
                timeout=self._config.timeout_seconds,
            )
            response = json.loads(response_bytes)
            content = response["choices"][0]["message"]["content"]
            parsed = json.loads(content)
            if not isinstance(parsed, dict):
                raise ValueError("Provider response must be a JSON object.")
            if not isinstance(parsed.get("answerable"), bool) or not isinstance(parsed.get("answer"), str):
                raise ValueError("Provider response does not match the required schema.")
            source_values = parsed.get("used_chunk_ids")
            if not isinstance(source_values, list) or not all(isinstance(value, str) for value in source_values):
                raise ValueError("Provider sources do not match the required schema.")
            confidence = parsed.get("confidence")
            if not isinstance(confidence, (int, float)) or not 0 <= confidence <= 1:
                raise ValueError("Provider confidence does not match the required schema.")
            return ProviderResult(parsed["answerable"], parsed["answer"], tuple(source_values), float(confidence))
        except (asyncio.TimeoutError, HTTPError, URLError, KeyError, IndexError, TypeError, ValueError, json.JSONDecodeError) as error:
            raise RuntimeError("Chatbot answer provider request failed.") from error

    def _post(self, request: Request) -> bytes:
        with urlopen(request, timeout=self._config.timeout_seconds) as response:
            return response.read(256_000)
