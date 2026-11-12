"""Dependency-free BM25 passage retrieval from the curated Markdown corpus."""

import math
import re
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

from .providers.base import Passage

KB_DIR = Path(__file__).resolve().parents[2] / "kb"
TOKEN_PATTERN = re.compile(r"[a-z0-9]+")
QUERY_STOPWORDS = {
    "a", "about", "an", "and", "are", "can", "do", "does", "for", "how", "i", "in",
    "is", "it", "me", "my", "of", "on", "the", "this", "to", "what", "when",
    "where", "which", "who", "with",
}
TOKEN_SYNONYMS: dict[str, tuple[str, ...]] = {
    "withdraw": ("cancel", "application"),
    "cancel": ("withdraw", "application"),
    "apply": ("application",),
    "application": ("apply", "submission"),
    "submit": ("apply", "application"),
    "submission": ("application", "apply"),
    "notification": ("alert", "bell"),
    "alert": ("notification", "bell"),
    "bell": ("notification", "alert"),
    "shortlist": ("short", "list"),
    "badge": ("skill",),
    "result": ("score", "assessment"),
    "score": ("result", "assessment"),
    "interview": ("schedule", "candidate"),
    "candidate": ("applicant",),
    "applicant": ("candidate",),
    "posting": ("internship", "role"),
    "internship": ("posting", "role"),
    "archive": ("restore", "topic"),
    "restore": ("archive", "topic"),
    "attend": ("take", "complete"),
    "taken": ("take", "complete"),
    "completed": ("complete", "take"),
}
TOKEN_NORMAL_FORMS: dict[str, str] = {
    "archived": "archive",
    "archiving": "archive",
    "companies": "company",
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
    "applied": "apply",
    "applying": "apply",
    "applications": "application",
    "submissions": "submission",
    "results": "result",
    "scores": "score",
    "candidates": "candidate",
    "applicants": "applicant",
    "postings": "posting",
    "internships": "internship",
    "topics": "topic",
}
FIELD_WEIGHTS = {
    "title": 3.0,
    "heading": 6.0,
    "keywords": 2.2,
    "examples": 1.6,
    "body": 1.0,
}
PAGE_MATCH_BONUS = 1.0
GENERIC_METADATA_TERMS = {
    "assessment", "company", "internship", "internships", "my", "platform",
    "profile", "skill", "student", "topic",
}
SECTION_AUDIENCES = {
    ("application-statuses-timeline", "company-workflow-updates"): frozenset({"company"}),
}


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
        normalized = TOKEN_NORMAL_FORMS.get(token) or token
        if normalized.endswith("ies") and len(normalized) > 5:
            normalized = normalized[:-3] + "y"
        elif normalized.endswith("ing") and len(normalized) > 5:
            normalized = normalized[:-3]
        elif normalized.endswith("ed") and len(normalized) > 4:
            normalized = normalized[:-2]
        elif normalized.endswith("s") and len(normalized) > 4:
            normalized = normalized[:-1]
        tokens.append(normalized)
        tokens.extend(TOKEN_SYNONYMS.get(normalized, ()))
    return tokens


def _section_slug(section: str) -> str:
    heading = section.splitlines()[0].removeprefix("## ").strip()
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", heading.casefold())).strip("-")


def _metadata_tokens(text: str) -> set[str]:
    return set(_tokens(text)) - QUERY_STOPWORDS - GENERIC_METADATA_TERMS


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
        body_sections = tuple(
            section.strip()
            for section in re.split(r"(?=^## )", body, flags=re.MULTILINE)
            if section.strip()
        )
        metadata_section = next(
            (
                section for section in body_sections
                if section.casefold().startswith("## search terms and example questions")
            ),
            "",
        )
        sections = tuple(
            section for section in body_sections
            if not section.casefold().startswith("## search terms and example questions")
        )
        if (
            not fields.get("id")
            or not fields.get("title")
            or not audiences
            or not links
            or any(audience not in {"guest", "student", "company", "admin"} for audience in audiences)
        ):
            raise ValueError(f"Knowledge file has incomplete metadata: {path.name}")
        extracted_keywords = re.search(r"(?im)^Keywords:\s*(.+)$", metadata_section)
        extracted_examples = re.search(r"(?im)^Example questions:\s*(.+)$", metadata_section)
        keywords = tuple(dict.fromkeys((
            *_metadata_list(fields.get("keywords")),
            *_metadata_list(extracted_keywords.group(1) if extracted_keywords else None),
        )))
        examples = tuple(dict.fromkeys((
            *_metadata_list(fields.get("example_questions") or fields.get("examples")),
            *_metadata_list(extracted_examples.group(1) if extracted_examples else None),
        )))
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
        self._chunks = [
            (document, section)
            for document in self.documents
            for section in document.sections
            if section.startswith("## ")
        ]
        self._fields = []
        for document, section in self._chunks:
            heading, _, body = section.partition("\n")
            section_terms = _metadata_tokens(section)
            heading_terms = _metadata_tokens(heading.removeprefix("## "))
            related_metadata = [
                phrase
                for phrase in (*document.keywords, *document.examples)
                if (
                    overlap := _metadata_tokens(phrase) & section_terms
                ) and (len(overlap) >= 2 or overlap & heading_terms)
            ]
            self._fields.append({
                "title": _tokens(document.title),
                "heading": _tokens(heading.removeprefix("## ")),
                "keywords": _tokens(" ".join(
                    phrase for phrase in related_metadata if phrase in document.keywords
                )),
                "examples": _tokens(" ".join(
                    phrase for phrase in related_metadata if phrase in document.examples
                )),
                "body": _tokens(body),
            })

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
            index for index, (document, section) in enumerate(self._chunks)
            if (
                audience in SECTION_AUDIENCES.get(
                    (document.id, _section_slug(section)),
                    frozenset(document.audience),
                )
                or "public" in SECTION_AUDIENCES.get(
                    (document.id, _section_slug(section)),
                    frozenset(document.audience),
                )
            )
        ]
        if not eligible:
            return []
        document_frequency = Counter(
            token
            for index in eligible
            for token in {token for field in self._fields[index].values() for token in field}
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
            document, _ = self._chunks[index]
            routes = set(document.related_routes)
            routes.update(route for _, route in document.links)
            return page_route is not None and page_route in routes

        def rank_score(item: tuple[float, int]) -> float:
            return item[0] + (PAGE_MATCH_BONUS if page_match(item[1]) else 0.0)

        scored.sort(key=lambda item: (rank_score(item), item[0]), reverse=True)
        distinct_scored = []
        seen_documents = set()
        for item in scored:
            document_id = self._chunks[item[1]][0].id
            if document_id not in seen_documents:
                seen_documents.add(document_id)
                distinct_scored.append(item)
        scored = distinct_scored
        if not scored or scored[0][0] < minimum_score:
            return []
        if len(scored) > 1 and rank_score(scored[0]) - rank_score(scored[1]) < minimum_margin:
            return []
        results = []
        for score, index in scored[:top_k]:
            if score < minimum_score:
                break
            document, section = self._chunks[index]
            results.append(Passage(
                id=f"{document.id}#{_section_slug(section)}",
                title=document.title,
                audience=document.audience,
                text=section,
                related_routes=document.related_routes,
                score=score,
                doc_id=document.id,
                links=document.links,
            ))
        return results
