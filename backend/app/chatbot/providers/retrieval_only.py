"""Marker provider for the deterministic retrieval-only mode."""

class RetrievalOnlyProvider:
    async def rewrite(self, payload):
        raise RuntimeError("Retrieval-only mode does not call a model provider.")
