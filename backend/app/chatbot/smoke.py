"""Make one safe, grounded completion request to the configured chatbot provider."""

import asyncio
import json
import logging
import time

from .chatbot_config import load_config, provider_configured
from .guardrails import output_is_safe
from .providers import create_answer_provider
from .providers.base import ProviderPayload
from .providers.llm_http import LLMHTTPProvider, ProviderRateLimitError
from .retriever import BM25Retriever


async def _smoke() -> int:
    config = load_config()
    if not config.enabled:
        raise RuntimeError("Enable the chatbot before running the provider smoke test.")
    if config.mode != "llm" or not provider_configured(config):
        raise RuntimeError(
            "Configure a complete LLM provider; retrieval fallback cannot be smoke-tested."
        )

    question = "Where can students update their academic details and resume?"
    passages = BM25Retriever().retrieve(
        question,
        "student",
        top_k=config.top_k,
        minimum_score=config.min_score,
    )
    if not passages:
        raise RuntimeError("The smoke-test question did not retrieve safe knowledge evidence.")

    payload = ProviderPayload(
        question=question,
        history=(),
        role="student",
        page="profile",
        passages=tuple(passages),
    )
    provider = create_answer_provider(config)
    started = time.monotonic()
    try:
        if isinstance(provider, LLMHTTPProvider):
            result = await provider.rewrite(payload, retry_on_truncation=False)
        else:
            result = await provider.rewrite(payload)
    except ProviderRateLimitError as error:
        print(json.dumps({
            "mode": config.mode,
            "provider": config.provider,
            "model": config.model,
            "latency_ms": round((time.monotonic() - started) * 1000),
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "total_tokens": 0,
            "grounded": False,
            "error": "provider_rate_limited",
            "retry_after_seconds": error.retry_after,
        }))
        return 1
    except RuntimeError:
        print(json.dumps({
            "mode": config.mode,
            "provider": config.provider,
            "model": config.model,
            "latency_ms": round((time.monotonic() - started) * 1000),
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "total_tokens": 0,
            "grounded": False,
            "error": "provider_request_failed",
        }))
        return 1
    latency_ms = round((time.monotonic() - started) * 1000)
    allowed_ids = {passage.id for passage in passages}
    allowed_routes = {
        route for passage in passages for route in passage.related_routes
    }
    grounded = (
        result.answerable
        and bool(result.sources)
        and set(result.sources).issubset(allowed_ids)
        and result.confidence >= config.rag_min_score
        and output_is_safe(result.answer, allowed_routes)
    )
    print(json.dumps({
        "mode": config.mode,
        "provider": config.provider,
        "model": config.model,
        "latency_ms": latency_ms,
        "prompt_tokens": result.prompt_tokens,
        "completion_tokens": result.completion_tokens,
        "total_tokens": result.total_tokens,
        "grounded": grounded,
    }))
    return 0 if grounded else 1


def main() -> int:
    logging.basicConfig(level=logging.INFO)
    return asyncio.run(_smoke())


if __name__ == "__main__":
    raise SystemExit(main())
