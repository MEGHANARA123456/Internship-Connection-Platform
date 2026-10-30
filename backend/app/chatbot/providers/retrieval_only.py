"""Marker provider for the deterministic retrieval-only mode."""

class RetrievalOnlyProvider:
    async def rewrite(self, payload):
        """Reject generation attempts because retrieval-only mode never calls an LLM."""
        raise RuntimeError("Retrieval-only mode does not call a model provider.")
