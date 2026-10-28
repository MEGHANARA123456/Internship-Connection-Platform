"""add pgvector-backed chatbot knowledge chunks

Revision ID: 0027_chatbot_knowledge
Revises: 0026_skill_assessment_reports
"""

from alembic import op


revision = "0027_chatbot_knowledge"
down_revision = "0026_skill_assessment_reports"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.execute(
        """
        CREATE TABLE kb_chunks (
            id BIGSERIAL PRIMARY KEY,
            doc_id VARCHAR(255) NOT NULL,
            source_path VARCHAR(1000) NOT NULL,
            title VARCHAR(500) NOT NULL,
            section VARCHAR(500) NOT NULL,
            content TEXT NOT NULL,
            audience VARCHAR(20) NOT NULL
                CHECK (audience IN ('student', 'company', 'admin', 'all')),
            route_hint VARCHAR(500) NOT NULL,
            content_hash VARCHAR(64) NOT NULL,
            embedding vector(384) NOT NULL,
            token_count INTEGER NOT NULL CHECK (token_count >= 0),
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT uq_kb_chunks_source_hash UNIQUE (source_path, content_hash)
        )
        """
    )
    op.execute(
        "CREATE INDEX ix_kb_chunks_audience ON kb_chunks (audience)"
    )
    op.execute(
        """
        CREATE INDEX ix_kb_chunks_embedding_hnsw
        ON kb_chunks USING hnsw (embedding vector_cosine_ops)
        """
    )
    op.execute(
        """
        CREATE INDEX ix_kb_chunks_content_fts
        ON kb_chunks USING gin (
            to_tsvector('english', title || ' ' || section || ' ' || content)
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS kb_chunks")
