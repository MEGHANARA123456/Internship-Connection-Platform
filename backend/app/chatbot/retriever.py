"""Dependency-free BM25 passage retrieval from the curated Markdown corpus."""

from collections import Counter
from dataclasses import dataclass
import math
from pathlib import Path
import re

from .providers.base import Passage

KB_DIR = Path(__file__).resolve().parents[2] / "kb"
TOKEN_PATTERN = re.compile(r"[a-z0-9]+")
QUERY_STOPWORDS = {
    "a", "about", "and", "are", "can", "do", "does", "for", "how", "i", "in",
    "is", "it", "me", "my", "of", "on", "the", "this", "to", "what", "when",
    "where", "which", "who", "with",
}


@dataclass(frozen=True)
class KnowledgeDocument:
    id: str
    title: str
    audience: tuple[str, ...]
    related_routes: tuple[str, ...]
    sections: tuple[str, ...]


def _tokens(text: str) -> list[str]:
    return TOKEN_PATTERN.findall(text.lower())


def load_documents(directory: Path = KB_DIR) -> list[KnowledgeDocument]:
    documents = []
    for path in sorted(directory.glob("*.md")):
        raw = path.read_text(encoding="utf-8")
        if not raw.startswith("---\n"):
            raise ValueError(f"Knowledge file is missing front matter: {path.name}")
        _, frontmatter, body = raw.split("---", 2)
        fields: dict[str, str] = {}
        for line in frontmatter.splitlines():
            if ":" not in line:
                continue
            key, value = line.split(":", 1)
            fields[key.strip()] = value.strip()
        audiences = tuple(value.strip() for value in fields.get("audience", "").strip("[]").split(",") if value.strip())
        routes = tuple(value.strip() for value in fields.get("related_routes", "").strip("[]").split(",") if value.strip())
        sections = tuple(
            section.strip()
            for section in re.split(r"(?=^## )", body, flags=re.M)
            if section.strip()
        )
        if not fields.get("id") or not fields.get("title") or not audiences:
            raise ValueError(f"Knowledge file has incomplete metadata: {path.name}")
        documents.append(KnowledgeDocument(fields["id"], fields["title"], audiences, routes, sections))
    return documents


class BM25Retriever:
    def __init__(self, documents: list[KnowledgeDocument] | None = None, *, k1: float = 1.5, b: float = 0.75):
        self.documents = documents if documents is not None else load_documents()
        self.k1 = k1
        self.b = b
        self._corpus = [
            _tokens(" ".join((document.title, *document.sections)))
            for document in self.documents
        ]
        self._lengths = [len(tokens) for tokens in self._corpus]
        self._average_length = sum(self._lengths) / max(1, len(self._lengths))
        self._document_frequency = Counter(
            token for document in self._corpus for token in set(document)
        )

    def retrieve(
        self,
        query: str,
        audience: str,
        *,
        top_k: int = 3,
        minimum_score: float = 0.5,
        page_route: str | None = None,
    ) -> list[Passage]:
        query_tokens = [token for token in _tokens(query) if token not in QUERY_STOPWORDS]
        if not query_tokens:
            return []
        scored: list[tuple[float, int]] = []
        total_documents = len(self._corpus)
        for index, document in enumerate(self.documents):
            if audience not in document.audience and "all" not in document.audience:
                continue
            counts = Counter(self._corpus[index])
            score = 0.0
            for token in query_tokens:
                frequency = counts[token]
                if frequency == 0:
                    continue
                df = self._document_frequency[token]
                inverse_frequency = max(0.0, (total_documents - df + 0.5) / (df + 0.5))
                idf = math.log1p(inverse_frequency)
                denominator = frequency + self.k1 * (
                    1 - self.b + self.b * self._lengths[index] / max(1.0, self._average_length)
                )
                score += idf * frequency * (self.k1 + 1) / denominator
            if page_route and any(
                route == page_route
                or (route.endswith("/:id") and page_route.startswith(route[:-4]))
                for route in document.related_routes
            ):
                score += 8.0
            scored.append((score, index))

        scored.sort(key=lambda item: item[0], reverse=True)
        results = []
        for score, index in scored[:top_k]:
            if score < minimum_score:
                continue
            document = self.documents[index]
            sections = sorted(
                document.sections,
                key=lambda section: sum(_tokens(query).count(token) for token in set(_tokens(section))),
                reverse=True,
            )
            section = sections[0] if sections else ""
            results.append(Passage(
                id=document.id,
                title=document.title,
                audience=document.audience,
                text=section,
                related_routes=document.related_routes,
                score=score,
                doc_id=document.id,
            ))
        return results
