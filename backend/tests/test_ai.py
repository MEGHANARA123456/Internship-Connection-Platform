import pytest
from httpx import ASGITransport, AsyncClient
from app.main import app

@pytest.mark.anyio
async def test_ai_mock_interview_evaluation():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Test mock evaluation
        resp = await client.post(
            "/api/v1/ai/mock-interview/evaluate",
            json={
                "question": "How do you handle microservice race conditions?",
                "answer": "I use distributed locks via Redis or PostgreSQL advisory locks, combined with idempotency keys.",
            },
        )
        # Should return 401 without auth (secure by default)
        assert resp.status_code == 401
