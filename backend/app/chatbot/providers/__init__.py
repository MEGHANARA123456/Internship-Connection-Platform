"""Optional answer providers."""

from ..chatbot_config import ChatbotConfig
from .base import AnswerProvider
from .llm_http import LLMHTTPProvider


def create_answer_provider(config: ChatbotConfig) -> AnswerProvider:
    if config.provider == "anthropic":
        from .anthropic import AnthropicProvider

        return AnthropicProvider(config)
    if config.provider == "openai-compatible":
        return LLMHTTPProvider(config)
    raise ValueError(f"Unsupported chatbot provider: {config.provider}")
