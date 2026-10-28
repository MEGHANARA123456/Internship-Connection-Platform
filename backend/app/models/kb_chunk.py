"""Indexed help-center passages used by chatbot retrieval."""

from datetime import datetime

from sqlalchemy import BigInteger, CheckConstraint, DateTime, Index, Integer, String, Text, UniqueConstraint, func, text
from sqlalchemy.orm import Mapped, mapped_column
from pgvector.sqlalchemy import Vector

from app.models.base import Base


class KBChunk(Base):
    __tablename__ = "kb_chunks"
    __table_args__ = (
        CheckConstraint(
            "audience IN ('student', 'company', 'admin', 'all')",
            name="kb_chunks_audience_check",
        ),
        CheckConstraint("token_count >= 0", name="kb_chunks_token_count_check"),
        UniqueConstraint("source_path", "content_hash", name="uq_kb_chunks_source_hash"),
        Index(
            "ix_kb_chunks_audience",
            "audience",
        ),
        Index(
            "ix_kb_chunks_embedding_hnsw",
            "embedding",
            postgresql_using="hnsw",
            postgresql_ops={"embedding": "vector_cosine_ops"},
        ),
        Index(
            "ix_kb_chunks_content_fts",
            text(
                "to_tsvector('english'::regconfig, "
                "(((title::text || ' '::text) || section::text) || ' '::text) || content)"
            ),
            postgresql_using="gin",
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    doc_id: Mapped[str] = mapped_column(String(255), nullable=False)
    source_path: Mapped[str] = mapped_column(String(1000), nullable=False)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    section: Mapped[str] = mapped_column(String(500), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    audience: Mapped[str] = mapped_column(String(20), nullable=False)
    route_hint: Mapped[str] = mapped_column(String(500), nullable=False)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    embedding: Mapped[list[float]] = mapped_column(Vector(384), nullable=False)
    token_count: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
