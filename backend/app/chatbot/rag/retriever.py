"""Audience-filtered hybrid vector and full-text retrieval."""

import asyncio
import logging
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.chatbot.chatbot_config import ChatbotConfig
from app.chatbot.rag.embeddings import embed_texts
from app.chatbot.providers.base import Passage

RRF_K = 60
CANDIDATE_LIMIT = 20
logger = logging.getLogger("internsphere.chatbot.rag")


def standalone_query(query: str, history: list[tuple[str, str]]) -> str:
    recent = history[-3:]
    if recent and len(query.split()) <= 7:
        context = " ".join(content[:160] for _, content in recent)
        return f"{context} Follow-up: {query}"
    return query


class HybridRetriever:
    def __init__(self, config: ChatbotConfig):
        self.config = config

    async def retrieve(
        self,
        db: AsyncSession,
        query: str,
        audience: str,
        history: list[tuple[str, str]] | None = None,
    ) -> list[Passage]:
        if audience not in {"student", "company", "admin", "all"}:
            audience = "all"
        recent_history = history or []
        resolved_query = standalone_query(query, recent_history)
        if (
            self.config.mode == "llm"
            and self.config.provider == "anthropic"
            and recent_history
            and len(query.split()) <= 7
        ):
            from app.chatbot.providers.anthropic import AnthropicProvider

            try:
                resolved_query = await AnthropicProvider(self.config).rewrite_query(
                    query,
                    recent_history[-3:],
                    audience,
                )
            except RuntimeError:
                logger.warning(
                    "chatbot_query_rewrite_fallback",
                    extra={"chatbot_meta": {"role": audience, "operation": "query_rewrite"}},
                )
        vectors = await asyncio.to_thread(
            embed_texts,
            [resolved_query],
            self.config.embedding_model,
            queries=True,
        )
        if len(vectors[0]) != self.config.embedding_dim:
            raise ValueError(
                f"Embedding model dimension {len(vectors[0])} does not match configured dimension "
                f"{self.config.embedding_dim}."
            )
        vector_literal = "[" + ",".join(map(str, vectors[0])) + "]"
        role_filter = "all" if audience == "all" else audience
        vector_rows = (await db.execute(
            text(
                """
                SELECT id, doc_id, title, section, content, audience, route_hint,
                       1 - (embedding <=> CAST(:embedding AS vector)) AS similarity
                FROM kb_chunks
                WHERE audience IN (:audience, 'all')
                ORDER BY embedding <=> CAST(:embedding AS vector)
                LIMIT :limit
                """
            ),
            {"embedding": vector_literal, "audience": role_filter, "limit": CANDIDATE_LIMIT},
        )).mappings().all()
        text_rows = (await db.execute(
            text(
                """
                SELECT id, doc_id, title, section, content, audience, route_hint,
                       ts_rank_cd(
                           to_tsvector('english', title || ' ' || section || ' ' || content),
                           websearch_to_tsquery('english', :query)
                       ) AS rank
                FROM kb_chunks
                WHERE audience IN (:audience, 'all')
                  AND to_tsvector('english', title || ' ' || section || ' ' || content)
                      @@ websearch_to_tsquery('english', :query)
                ORDER BY rank DESC
                LIMIT :limit
                """
            ),
            {"query": resolved_query, "audience": role_filter, "limit": CANDIDATE_LIMIT},
        )).mappings().all()

        ranks: dict[int, tuple[Any, float, float]] = {}
        for rows, has_similarity in ((vector_rows, True), (text_rows, False)):
            for rank, row in enumerate(rows, start=1):
                chunk_id = int(row["id"])
                similarity = float(row["similarity"]) if has_similarity else 0.0
                current = ranks.get(chunk_id, (row, 0.0, 0.0))
                ranks[chunk_id] = (
                    row,
                    current[1] + 1 / (RRF_K + rank),
                    max(current[2], similarity),
                )
        ordered = sorted(ranks.values(), key=lambda item: item[1], reverse=True)[:CANDIDATE_LIMIT]
        threshold = self.config.rag_min_score
        return [
            Passage(
                id=str(row["id"]),
                title=str(row["title"]),
                audience=(str(row["audience"]),),
                text=str(row["content"]),
                related_routes=(str(row["route_hint"]),),
                score=similarity,
                doc_id=str(row["doc_id"]),
            )
            for row, _, similarity in ordered[:self.config.rag_top_k]
            if similarity >= threshold
        ]
