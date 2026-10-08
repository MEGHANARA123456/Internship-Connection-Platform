import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.v1.dependencies import get_current_user, get_db
from app.main import app
from app.models import User, UserRole
from app.models.base import Base


@pytest.mark.anyio
async def test_health_check() -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/api/v1/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


@pytest.fixture
async def client():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    async def override_db():
        async with sessions() as session:
            yield session

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_user] = lambda: User(email="student@example.com", role=UserRole.STUDENT, is_active=True)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as test_client:
        yield test_client
    app.dependency_overrides.clear()
    await engine.dispose()


@pytest.mark.anyio
async def test_student_token_cannot_access_company_or_admin_routes(client: AsyncClient) -> None:
    headers = {"Authorization": "Bearer test-student-token"}

    assert (await client.get("/api/v1/student/me", headers=headers)).status_code == 200
    assert (await client.get("/api/v1/company/dashboard", headers=headers)).status_code == 403
    assert (await client.get("/api/v1/admin/dashboard", headers=headers)).status_code == 403