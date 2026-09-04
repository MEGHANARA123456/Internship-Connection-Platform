import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


@pytest.mark.anyio
async def test_admin_signup_rejects_invalid_bootstrap_key() -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post(
            "/api/v1/auth/register/admin",
            json={"email": "admin-key-test@example.com", "password": "strong-password", "signup_key": "wrong-key-that-is-long"},
        )

    assert response.status_code == 403
    assert response.json() == {"detail": "Invalid admin signup key"}