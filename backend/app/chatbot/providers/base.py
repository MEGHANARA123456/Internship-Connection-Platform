"""Provider protocol and payload types."""

from dataclasses import dataclass
from typing import Protocol, runtime_checkable


@dataclass(frozen=True)
class Passage:
    id: str
    title: str
    audience: tuple[str, ...]
    text: str
    related_routes: tuple[str, ...]
    score: float
    doc_id: str | None = None


@dataclass(frozen=True)
class ProviderPayload:
    question: str
    history: tuple[tuple[str, str], ...]
    role: str
    page: str
    passages: tuple[Passage, ...]
    live_data: str | None = None


@dataclass(frozen=True)
class ProviderResult:
    answerable: bool
    answer: str
    sources: tuple[str, ...]
    confidence: float = 0.0


class AnswerProvider(Protocol):
    async def rewrite(self, payload: ProviderPayload) -> ProviderResult: ...


@runtime_checkable
class ChatbotRouterProvider(Protocol):
    async def classify_intent(self, message: str, role: str) -> str: ...

    async def rewrite_query(
        self,
        query: str,
        history: list[tuple[str, str]],
        role: str,
    ) -> str: ...
