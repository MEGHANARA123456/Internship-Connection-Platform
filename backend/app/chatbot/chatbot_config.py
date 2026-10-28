"""Chatbot-only configuration. This module deliberately does not import app settings."""

from dataclasses import dataclass, field
from io import StringIO
import os
from pathlib import Path
from urllib.parse import urlsplit

from dotenv import dotenv_values


CHATBOT_ENV_NAMES = (
    "CHATBOT_ENABLED",
    "CHATBOT_MODE",
    "CHATBOT_PROVIDER",
    "CHATBOT_BASE_URL",
    "CHATBOT_API_KEY",
    "ANTHROPIC_API_KEY",
    "CHATBOT_MODEL",
    "CHATBOT_ROUTER_MODEL",
    "CHATBOT_MAX_TOKENS",
    "CHATBOT_TEMPERATURE",
    "CHATBOT_RETRIES",
    "CHATBOT_TOP_K",
    "CHATBOT_MIN_SCORE",
    "CHATBOT_TIMEOUT_SECONDS",
    "CHATBOT_USER_PER_MINUTE",
    "CHATBOT_USER_PER_DAY",
    "CHATBOT_GUEST_PER_MINUTE",
    "RAG_ENABLED",
    "EMBEDDING_MODEL",
    "EMBEDDING_DIM",
    "RAG_TOP_K",
    "RAG_MIN_SCORE",
    "RERANK_ENABLED",
    "KB_PATH",
)
DEFAULT_KB_PATH = Path(__file__).resolve().parents[2] / "kb"


def _chatbot_dotenv() -> dict[str, str | None]:
    env_file = Path(".env")
    if not env_file.is_file():
        return {}
    chatbot_lines = [
        line for line in env_file.read_text(encoding="utf-8").splitlines()
        if line.lstrip().startswith(CHATBOT_ENV_NAMES)
    ]
    return dotenv_values(stream=StringIO("\n".join(chatbot_lines)))


@dataclass(frozen=True)
class ChatbotConfig:
    enabled: bool = False
    mode: str = "retrieval"
    provider: str = "anthropic"
    base_url: str = ""
    api_key: str = field(default="", repr=False)
    model: str = ""
    router_model: str = ""
    max_tokens: int = 600
    temperature: float = 0.1
    retries: int = 1
    top_k: int = 3
    min_score: float = 0.5
    timeout_seconds: float = 8.0
    user_per_minute: int = 20
    user_per_day: int = 200
    guest_per_minute: int = 5
    rag_enabled: bool = True
    embedding_model: str = "BAAI/bge-small-en-v1.5"
    embedding_dim: int = 384
    rag_top_k: int = 5
    rag_min_score: float = 0.55
    rerank_enabled: bool = False
    kb_path: Path = DEFAULT_KB_PATH


def load_config() -> ChatbotConfig:
    """Read CHATBOT_* process or .env values without loading unrelated secrets."""
    dotenv = _chatbot_dotenv()

    def setting(name: str, default: str) -> str:
        if name in os.environ:
            return os.environ[name]
        value = dotenv.get(name)
        return default if value is None else value

    def boolean_setting(name: str, default: bool) -> bool:
        return setting(name, str(default)).strip().lower() in {"1", "true", "yes", "on"}

    provider = setting("CHATBOT_PROVIDER", "anthropic").strip().lower()
    config = ChatbotConfig(
        enabled=setting("CHATBOT_ENABLED", "false").strip().lower() in {"1", "true", "yes", "on"},
        mode=setting("CHATBOT_MODE", "retrieval").strip().lower(),
        provider=provider,
        base_url=setting("CHATBOT_BASE_URL", "").strip().rstrip("/"),
        api_key=setting(
            "ANTHROPIC_API_KEY" if provider == "anthropic" else "CHATBOT_API_KEY",
            "",
        ).strip(),
        model=setting("CHATBOT_MODEL", "claude-haiku-5-5").strip(),
        router_model=setting(
            "CHATBOT_ROUTER_MODEL",
            setting("CHATBOT_MODEL", "claude-haiku-5-5"),
        ).strip(),
        max_tokens=max(1, min(600, int(setting("CHATBOT_MAX_TOKENS", "600")))),
        temperature=max(0.0, min(0.2, float(setting("CHATBOT_TEMPERATURE", "0.1")))),
        retries=max(0, min(1, int(setting("CHATBOT_RETRIES", "1")))),
        top_k=max(1, min(8, int(setting("CHATBOT_TOP_K", "3")))),
        min_score=max(0.0, float(setting("CHATBOT_MIN_SCORE", "0.5"))),
        timeout_seconds=min(15.0, max(0.1, float(setting("CHATBOT_TIMEOUT_SECONDS", "15")))),
        user_per_minute=max(1, int(setting("CHATBOT_USER_PER_MINUTE", "20"))),
        user_per_day=max(1, int(setting("CHATBOT_USER_PER_DAY", "200"))),
        guest_per_minute=max(1, int(setting("CHATBOT_GUEST_PER_MINUTE", "5"))),
        rag_enabled=boolean_setting("RAG_ENABLED", True),
        embedding_model=setting("EMBEDDING_MODEL", "BAAI/bge-small-en-v1.5").strip(),
        embedding_dim=max(1, int(setting("EMBEDDING_DIM", "384"))),
        rag_top_k=max(1, min(5, int(setting("RAG_TOP_K", "5")))),
        rag_min_score=max(0.0, min(1.0, float(setting("RAG_MIN_SCORE", "0.55")))),
        rerank_enabled=boolean_setting("RERANK_ENABLED", False),
        kb_path=Path(setting("KB_PATH", str(DEFAULT_KB_PATH))).expanduser(),
    )
    if config.mode not in {"retrieval", "llm"}:
        raise ValueError("CHATBOT_MODE must be 'retrieval' or 'llm'.")
    if config.provider not in {"anthropic", "openai-compatible"}:
        raise ValueError("CHATBOT_PROVIDER must be 'anthropic' or 'openai-compatible'.")
    if config.enabled and config.mode == "llm" and not provider_configured(config):
        raise ValueError(
            "Configure the selected chatbot provider, answer model, router model, and API key before enabling LLM mode."
        )
    return config


def provider_configured(config: ChatbotConfig) -> bool:
    if config.mode == "retrieval":
        return True
    parsed_url = urlsplit(config.base_url)
    local_provider = parsed_url.hostname in {"localhost", "127.0.0.1", "::1"}
    if config.provider == "anthropic":
        return bool(config.api_key and config.model and config.router_model)
    return bool(
        parsed_url.scheme in {"http", "https"}
        and parsed_url.hostname
        and config.model
        and (config.api_key or local_provider)
    )
