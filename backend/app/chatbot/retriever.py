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
    "a", "about", "an", "and", "are", "can", "do", "does", "for", "how", "i", "in",
    "is", "it", "me", "my", "of", "on", "the", "this", "to", "what", "when",
    "where", "which", "who", "with",
}
TOKEN_SYNONYMS = {
    "withdraw": ("cancel", "application"),
    "cancel": ("withdraw", "application"),
    "notification": ("alert", "bell"),
    "alert": ("notification", "bell"),
    "bell": ("notification", "alert"),
    "shortlist": ("short", "list"),
    "badge": ("skill",),
    "attend": ("take", "complete"),
    "taken": ("take", "complete"),
    "completed": ("complete", "take"),
}
TOKEN_NORMAL_FORMS = {
    "archived": "archive",
    "archiving": "archive",
    "imported": "import",
    "importing": "import",
    "withdrawing": "withdraw",
    "withdrawn": "withdraw",
    "scheduled": "schedule",
    "scheduling": "schedule",
    "shortlisted": "shortlist",
    "shortlisting": "shortlist",
    "notifications": "notification",
    "badges": "badge",
    "assessments": "assessment",
}
FIELD_WEIGHTS = {"title": 3.0, "keywords": 2.2, "examples": 1.6, "body": 1.0}


@dataclass(frozen=True)
class KnowledgeDocument:
    id: str
    title: str
    audience: tuple[str, ...]
    related_routes: tuple[str, ...]
    sections: tuple[str, ...]
    keywords: tuple[str, ...] = ()
    examples: tuple[str, ...] = ()
    links: tuple[tuple[str, str], ...] = ()


def _tokens(text: str) -> list[str]:
    """Normalize punctuation, case, light inflections, and supported product synonyms."""
    tokens = []
    for token in TOKEN_PATTERN.findall(text.casefold()):
        normalized = TOKEN_NORMAL_FORMS.get(token, token)
        if normalized.endswith("ing") and len(normalized) > 5:
            normalized = normalized[:-3]
        elif normalized.endswith("ed") and len(normalized) > 4:
            normalized = normalized[:-2]
        elif normalized.endswith("s") and len(normalized) > 4:
            normalized = normalized[:-1]
        tokens.append(normalized)
        tokens.extend(TOKEN_SYNONYMS.get(normalized, ()))
    return tokens


def _front_matter_values(frontmatter: str) -> tuple[dict[str, str], tuple[tuple[str, str], ...]]:
    """Parse scalar metadata and the small links list without requiring a YAML runtime dependency."""
    fields: dict[str, str] = {}
    links: list[tuple[str, str]] = []
    current_link: dict[str, str] | None = None
    for line in frontmatter.splitlines():
        stripped = line.strip()
        if stripped.startswith("- label:"):
            if current_link and current_link.get("label") and current_link.get("route"):
                links.append((current_link["label"], current_link["route"]))
            current_link = {"label": stripped.split(":", 1)[1].strip().strip("\"'")}
        elif current_link is not None and stripped.startswith("route:"):
            current_link["route"] = stripped.split(":", 1)[1].strip().strip("\"'")
        elif ":" in line and not line.startswith((" ", "\t")):
            key, value = line.split(":", 1)
            fields[key.strip()] = value.strip().strip("\"'")
            current_link = None
    if current_link and current_link.get("label") and current_link.get("route"):
        links.append((current_link["label"], current_link["route"]))
    return fields, tuple(links)


def _metadata_list(value: str | None) -> tuple[str, ...]:
    if not value:
        return ()
    stripped = value.strip().strip("[]")
    return tuple(
        item.strip().strip("\"'")
        for item in stripped.split(",")
        if item.strip()
    )


def load_documents(directory: Path = KB_DIR) -> list[KnowledgeDocument]:
    """Load Markdown documents with required metadata and split their bodies by level-two headings."""
    documents = []
    for path in sorted(directory.glob("*.md")):
        raw = path.read_text(encoding="utf-8")
        if not raw.startswith("---\n"):
            raise ValueError(f"Knowledge file is missing front matter: {path.name}")
        _, frontmatter, body = raw.split("---", 2)
        fields, links = _front_matter_values(frontmatter)
        audiences = _metadata_list(fields.get("audience"))
        audiences = tuple("public" if value == "all" else value for value in audiences)
        routes = tuple(route for _, route in links)
        sections = tuple(
            section.strip()
            for section in re.split(r"(?=^## )", body, flags=re.M)
            if section.strip()
            and not section.strip().casefold().startswith("## search terms and example questions")
        )
        if (
            not fields.get("id")
            or not fields.get("title")
            or not audiences
            or not links
            or any(audience not in {"guest", "student", "company", "admin"} for audience in audiences)
        ):
            raise ValueError(f"Knowledge file has incomplete metadata: {path.name}")
        keywords = _metadata_list(fields.get("keywords"))
        examples = _metadata_list(fields.get("example_questions") or fields.get("examples"))
        documents.append(KnowledgeDocument(
            fields["id"],
            fields["title"],
            audiences,
            routes,
            sections,
            keywords,
            examples,
            links,
        ))
    return documents


class BM25Retriever:
    def __init__(self, documents: list[KnowledgeDocument] | None = None, *, k1: float = 1.5, b: float = 0.75):
        """Build BM25 corpus statistics from supplied documents or the default knowledge directory."""
        self.documents = documents if documents is not None else load_documents()
        self.k1 = k1
        self.b = b
        self._fields = [
            {
                "title": _tokens(document.title),
                "keywords": _tokens(" ".join(document.keywords)),
                "examples": _tokens(" ".join(document.examples)),
                "body": _tokens(" ".join(document.sections)),
            }
            for document in self.documents
        ]

    def _best_section(self, sections: tuple[str, ...], query_tokens: list[str]) -> str:
        """Choose the section with the strongest BM25 match, prioritizing specific query terms."""
        if not sections:
            return ""
        tokenized_sections = [_tokens(section) for section in sections]
        document_frequency = Counter(
            token
            for section_tokens in tokenized_sections
            for token in set(section_tokens)
        )
        average_length = max(
            1.0,
            sum(map(len, tokenized_sections)) / len(tokenized_sections),
        )
        query_frequency = Counter(query_tokens)
        scored_sections = []
        for section, section_tokens in zip(sections, tokenized_sections, strict=True):
            term_frequency = Counter(section_tokens)
            heading = section.splitlines()[0] if section.startswith("## ") else ""
            heading_terms = set(_tokens(heading))
            score = 0.0
            for token, query_count in query_frequency.items():
                frequency = term_frequency[token]
                if not frequency:
                    continue
                inverse_frequency = (
                    len(sections) - document_frequency[token] + 0.5
                ) / (document_frequency[token] + 0.5)
                idf = math.log1p(inverse_frequency)
                denominator = frequency + self.k1 * (
                    1 - self.b + self.b * len(section_tokens) / average_length
                )
                score += query_count * idf * frequency * (self.k1 + 1) / denominator
                if token in heading_terms:
                    score += 2 * query_count * idf
            scored_sections.append((score, section))
        return max(scored_sections, key=lambda item: item[0])[1]

    def retrieve(
        self,
        query: str,
        audience: str,
        *,
        top_k: int = 3,
        minimum_score: float = 4.0,
        minimum_margin: float = 0.01,
        page_route: str | None = None,
    ) -> list[Passage]:
        """Rank only audience-visible articles and require a score and top-result margin."""
        query_tokens = [token for token in _tokens(query) if token not in QUERY_STOPWORDS]
        if not query_tokens:
            return []
        eligible = [
            index for index, document in enumerate(self.documents)
            if audience in document.audience or "public" in document.audience
        ]
        if not eligible:
            return []
        document_frequency = Counter(
            token
            for index in eligible
            for token in set(token for field in self._fields[index].values() for token in field)
        )
        field_average_lengths = {
            field_name: sum(len(self._fields[index][field_name]) for index in eligible)
            / max(1, len(eligible))
            for field_name in FIELD_WEIGHTS
        }
        scored: list[tuple[float, int]] = []
        total_documents = len(eligible)
        for index in eligible:
            score = 0.0
            for token in query_tokens:
                df = document_frequency[token]
                inverse_frequency = (total_documents - df + 0.5) / (df + 0.5)
                idf = math.log1p(inverse_frequency)
                for field_name, weight in FIELD_WEIGHTS.items():
                    counts = Counter(self._fields[index][field_name])
                    frequency = counts[token]
                    if not frequency:
                        continue
                    average_length = max(1.0, field_average_lengths[field_name])
                    field_length = len(self._fields[index][field_name])
                    denominator = frequency + self.k1 * (
                        1 - self.b + self.b * field_length / average_length
                    )
                    score += weight * idf * frequency * (self.k1 + 1) / denominator
            scored.append((score, index))

        def page_match(index: int) -> bool:
            document = self.documents[index]
            routes = set(document.related_routes)
            routes.update(route for _, route in document.links)
            return page_route is not None and page_route in routes

        scored.sort(key=lambda item: (item[0], page_match(item[1])), reverse=True)
        if not scored or scored[0][0] < minimum_score:
            return []
        if len(scored) > 1 and scored[0][0] - scored[1][0] < minimum_margin:
            page_resolves_tie = (
                scored[0][0] == scored[1][0]
                and page_match(scored[0][1])
                and not page_match(scored[1][1])
            )
            if not page_resolves_tie:
                return []
        results = []
        for score, index in scored[:top_k]:
            if score < minimum_score:
                break
            document = self.documents[index]
            section = self._best_section(document.sections, query_tokens)
            results.append(Passage(
                id=document.id,
                title=document.title,
                audience=document.audience,
                text=section,
                related_routes=document.related_routes,
                score=score,
                doc_id=document.id,
                links=document.links,
            ))
        return results
