"""Lazy CPU embeddings shared by ingestion and retrieval."""

from functools import lru_cache
import logging

logger = logging.getLogger("internsphere.chatbot.rag")

QUERY_PREFIX = "Represent this sentence for searching relevant passages: "


@lru_cache(maxsize=1)
def _embedding_model(model_name: str):
    try:
        from fastembed import TextEmbedding
    except ImportError as error:
        raise RuntimeError(
            "RAG embeddings require fastembed; install backend requirements."
        ) from error
    logger.info("Loading local CPU embedding model %s", model_name)
    return TextEmbedding(model_name=model_name, providers=["CPUExecutionProvider"])


def embed_texts(texts: list[str], model_name: str, *, queries: bool = False) -> list[list[float]]:
    if not texts:
        return []
    model = _embedding_model(model_name)
    prepared = [
        f"{QUERY_PREFIX}{text}" if queries else text
        for text in texts
    ]
    return [vector.tolist() for vector in model.embed(prepared)]
