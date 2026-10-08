from app.schemas.auth import TokenResponse


def test_token_response_includes_expiration_metadata():
    response = TokenResponse(
        access_token="access-token",
        refresh_token="refresh-token",
        role="STUDENT",
        user_id=1,
        access_token_expires_in=1800,
        refresh_token_expires_in=604800,
        access_token_expires_at="2026-09-25T00:00:00+00:00",
        refresh_token_expires_at="2026-10-02T00:00:00+00:00",
    )

    assert response.access_token_expires_in == 1800
    assert response.refresh_token_expires_in == 604800
    assert response.access_token_expires_at.isoformat() == "2026-09-25T00:00:00+00:00"
    assert response.refresh_token_expires_at.isoformat() == "2026-10-02T00:00:00+00:00"
