from datetime import datetime, timedelta, timezone

from app.api.v1.auth import _is_expired
from app.schemas.auth import TokenResponse


def test_expiration_comparison_treats_naive_datetimes_as_utc():
    now = datetime.now(timezone.utc)

    assert _is_expired((now - timedelta(seconds=1)).replace(tzinfo=None))
    assert not _is_expired((now + timedelta(seconds=60)).replace(tzinfo=None))
    assert _is_expired(now - timedelta(seconds=1))
    assert not _is_expired(now + timedelta(seconds=60))


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
