"""Shared normalization, matching, and ranking for user-entered search text."""

from difflib import SequenceMatcher
import re
import unicodedata
from typing import Any

from sqlalchemy import case, func, or_
from sqlalchemy.sql.elements import ColumnElement

_WORD_PATTERN = re.compile(r"[^\W_]+", re.UNICODE)


def normalize_search_text(value: str) -> str:
    """Case-fold text, remove accents and punctuation, and collapse whitespace."""
    folded = unicodedata.normalize("NFKD", value.casefold())
    ascii_text = "".join(character for character in folded if not unicodedata.combining(character))
    return " ".join(_WORD_PATTERN.findall(ascii_text))


def search_terms(value: str) -> list[str]:
    """Split normalized text into terms while preserving punctuation-only literal searches."""
    normalized = normalize_search_text(value)
    if normalized:
        return normalized.split()
    literal = value.strip().casefold()
    return [literal] if literal else []


def escape_search_term(value: str) -> str:
    """Escape LIKE metacharacters so user-provided text is matched literally."""
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _escaped_like(value: str) -> str:
    return escape_search_term(value)


def _field_match(field: ColumnElement[Any], term: str, *, postgres: bool) -> ColumnElement[bool]:
    escaped = _escaped_like(term)
    contains = field.ilike(f"%{escaped}%", escape="\\")
    if postgres and len(term) >= 3:
        fuzzy = func.lower(field).op("%")(term)
        return or_(contains, fuzzy)
    return contains


def search_conditions(
    query: str,
    fields: tuple[ColumnElement[Any], ...],
    *,
    postgres: bool = False,
) -> list[ColumnElement[bool]]:
    """Return conditions requiring every normalized word to match some searchable field."""
    return [
        or_(*(_field_match(field, term, postgres=postgres) for field in fields))
        for term in search_terms(query)
    ]


def search_rank_expression(
    query: str,
    fields: tuple[ColumnElement[Any], ...],
    *,
    postgres: bool = False,
) -> ColumnElement[Any]:
    """Build a SQL score that orders exact, prefix, substring, and fuzzy matches."""
    scores: list[ColumnElement[Any]] = []
    for term in search_terms(query):
        escaped = _escaped_like(term)
        exact = or_(*(func.lower(field) == term for field in fields))
        prefix = or_(*(func.lower(field).like(f"{escaped}%", escape="\\") for field in fields))
        contains = or_(*(field.ilike(f"%{escaped}%", escape="\\") for field in fields))
        conditions = [(exact, 4), (prefix, 3), (contains, 2)]
        if postgres and len(term) >= 3:
            fuzzy = or_(*(func.lower(field).op("%")(term) for field in fields))
            conditions.append((fuzzy, 1))
        scores.append(case(*conditions, else_=0))
    return sum(scores, start=0)


def match_search_text(query: str, fields: tuple[str | None, ...]) -> float | None:
    """Score text fields in Python for portable fuzzy fallback when trigram search is unavailable."""
    terms = search_terms(query)
    if terms and not normalize_search_text(query):
        literal_query = query.strip().casefold()
        return (
            2.0
            if any(literal_query in value.casefold() for value in fields if value is not None)
            else None
        )
    normalized_fields = [
        normalize_search_text(value)
        for value in fields
        if value is not None and value.strip()
    ]
    if not terms:
        return None

    scores: list[float] = []
    for term in terms:
        best = 0.0
        for field in normalized_fields:
            for word in field.split():
                if word == term:
                    best = max(best, 4.0)
                elif word.startswith(term):
                    best = max(best, 3.0)
                elif term in word:
                    best = max(best, 2.0)
                elif len(term) >= 3 and SequenceMatcher(None, term, word).ratio() >= 0.6:
                    best = max(best, 1.0 + SequenceMatcher(None, term, word).ratio())
            if term in field:
                best = max(best, 2.0)
        if best == 0:
            return None
        scores.append(best)
    return sum(scores) / len(scores)
