import pytest
from httpx import ASGITransport, AsyncClient

from app.api.v1.admin import report_transition_allowed
from app.api.v1.dependencies import get_current_user
from app.main import app
from app.models import User, UserRole


@pytest.mark.parametrize("current,target,allowed", [
    ("OPEN", "INVESTIGATING", True),
    ("INVESTIGATING", "RESOLVED", True),
    ("OPEN", "RESOLVED", False),
    ("RESOLVED", "OPEN", False),
])
def test_report_lifecycle(current: str, target: str, allowed: bool) -> None:
    assert report_transition_allowed(current, target) is allowed


@pytest.mark.anyio
async def test_non_admin_cannot_access_admin_routes() -> None:
    app.dependency_overrides[get_current_user] = lambda: User(id=7, email="student@example.com", role=UserRole.STUDENT, is_active=True)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        for path in ("/api/v1/admin/dashboard", "/api/v1/admin/users", "/api/v1/admin/verifications", "/api/v1/admin/internships", "/api/v1/admin/reports"):
            assert (await client.get(path)).status_code == 403
    app.dependency_overrides.clear()
