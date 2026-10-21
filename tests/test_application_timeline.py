from datetime import date, datetime, timedelta, timezone

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.v1.dependencies import get_db
from app.core.security import create_token
from app.main import app
from app.models import (
    Application,
    ApplicationEvent,
    ApplicationStatusEvent,
    EmailMessage,
    Internship,
    Interview,
    Notification,
    User,
    UserRole,
)
from app.models.base import Base


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest.mark.anyio
async def test_application_timeline_access_email_scope_and_gmail_url() -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    async def override_db():
        async with sessions() as session:
            yield session

    app.dependency_overrides[get_db] = override_db
    now = datetime.now(timezone.utc)
    async with sessions() as session:
        student = User(email="candidate@gmail.com", password_hash="fake", role=UserRole.STUDENT)
        other_student = User(email="other.student@gmail.com", password_hash="fake", role=UserRole.STUDENT)
        company = User(email="company@example.com", password_hash="fake", role=UserRole.COMPANY)
        other_company = User(email="other@example.com", password_hash="fake", role=UserRole.COMPANY)
        admin = User(email="admin@example.com", password_hash="fake", role=UserRole.ADMIN)
        session.add_all([student, other_student, company, other_company, admin])
        await session.flush()
        internship = Internship(
            company_id=company.id,
            title="Backend Intern",
            description="Build APIs",
            location="Remote",
            industry="Software",
            duration_months=3,
            work_mode="REMOTE",
            deadline=date.today() + timedelta(days=30),
            status="PUBLISHED",
        )
        session.add(internship)
        await session.flush()
        application = Application(internship_id=internship.id, student_id=student.id, status="INTERVIEW_SCHEDULED")
        session.add(application)
        await session.flush()
        interview = Interview(
            application_id=application.id,
            scheduled_by=company.id,
            scheduled_at=now + timedelta(days=1),
            interview_type="VIDEO",
            meeting_link="https://meet.example.com/room",
            notes="Bring a portfolio",
        )
        session.add(interview)
        await session.flush()
        session.add_all(
            [
                ApplicationEvent(
                    application_id=application.id,
                    event_type="APPLIED",
                    created_at=now - timedelta(days=2),
                ),
                ApplicationStatusEvent(
                    application_id=application.id,
                    from_status=None,
                    to_status="APPLIED",
                    changed_at=now - timedelta(days=2),
                ),
                ApplicationStatusEvent(
                    application_id=application.id,
                    from_status="SHORTLISTED",
                    to_status="INTERVIEW_SCHEDULED",
                    changed_at=now - timedelta(days=1),
                ),
                ApplicationEvent(
                    application_id=application.id,
                    event_type="INTERVIEW_SCHEDULED",
                    created_at=now - timedelta(days=1),
                ),
                EmailMessage(
                    user_id=student.id,
                    recipient_email=student.email,
                    sender_email="noreply@example.com",
                    subject="Interview invitation",
                    message_type="INTERVIEW_INVITE",
                    body="Your interview is scheduled.",
                    application_id=application.id,
                    delivered_via_smtp=True,
                    message_id="<message-1@example.com>",
                ),
                EmailMessage(
                    user_id=company.id,
                    recipient_email=company.email,
                    sender_email="noreply@example.com",
                    subject="Candidate update",
                    message_type="APPLICATION_STATUS",
                    body="Candidate update.",
                    application_id=application.id,
                ),
            ]
        )
        await session.commit()

    async def headers_for(user: User) -> dict[str, str]:
        token = create_token(str(user.id), user.role.value, "access", timedelta(minutes=30))
        return {"Authorization": f"Bearer {token}"}

    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            student_headers = await headers_for(student)
            other_student_headers = await headers_for(other_student)
            company_headers = await headers_for(company)
            admin_headers = await headers_for(admin)
            outsider_headers = await headers_for(other_company)
            student_timeline = await client.get(f"/api/v1/applications/{application.id}/timeline", headers=student_headers)
            company_timeline = await client.get(f"/api/v1/applications/{application.id}/timeline", headers=company_headers)
            admin_timeline = await client.get(f"/api/v1/applications/{application.id}/timeline", headers=admin_headers)
            outsider_timeline = await client.get(f"/api/v1/applications/{application.id}/timeline", headers=outsider_headers)
            other_student_timeline = await client.get(f"/api/v1/applications/{application.id}/timeline", headers=other_student_headers)
            anonymous_timeline = await client.get(f"/api/v1/applications/{application.id}/timeline")
            mailbox = await client.get("/api/v1/me/emails", headers=student_headers)
    finally:
        app.dependency_overrides.clear()
        await engine.dispose()

    assert student_timeline.status_code == 200
    student_data = student_timeline.json()
    assert student_data["summary"]["status"] == "INTERVIEW_SCHEDULED"
    assert [step["key"] for step in student_data["steps"][:6]] == [
        "APPLIED", "APPLICATION_VIEWED", "RESUME_VIEWED", "UNDER_REVIEW", "SHORTLISTED", "INTERVIEW_SCHEDULED",
    ]
    interview_step = student_data["steps"][5]
    assert interview_step["interview"]["link"] == "https://meet.example.com/room"
    interview_mail = interview_step["emails"][0]
    assert interview_mail["gmail_url"] == (
        "https://mail.google.com/mail/?authuser=candidate%40gmail.com"
        "#search/rfc822msgid%3A%3Cmessage-1%40example.com%3E"
    )
    assert company_timeline.status_code == 200
    assert len(company_timeline.json()["related_emails"]) == 1
    assert admin_timeline.status_code == 200
    assert len(admin_timeline.json()["related_emails"]) == 2
    assert outsider_timeline.status_code == 404
    assert other_student_timeline.status_code == 404
    assert anonymous_timeline.status_code == 401
    assert mailbox.status_code == 200
    assert mailbox.json()[0]["gmail_url"] == (
        "https://mail.google.com/mail/?authuser=candidate%40gmail.com"
        "#search/rfc822msgid%3A%3Cmessage-1%40example.com%3E"
    )


@pytest.mark.anyio
async def test_legacy_application_email_and_notification_rows_remain_readable() -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    async def override_db():
        async with sessions() as session:
            yield session

    previous_overrides = app.dependency_overrides.copy()
    app.dependency_overrides[get_db] = override_db
    async with sessions() as session:
        student = User(email="legacy.student@gmail.com", password_hash="fake", role=UserRole.STUDENT)
        company = User(email="legacy.company@example.com", password_hash="fake", role=UserRole.COMPANY)
        session.add_all([student, company])
        await session.flush()
        internship = Internship(
            company_id=company.id,
            title="Legacy Role",
            description="Existing role with no event history",
            location="Remote",
            industry="Technology",
            duration_months=3,
            work_mode="REMOTE",
            deadline=date.today() + timedelta(days=30),
            status="PUBLISHED",
        )
        session.add(internship)
        await session.flush()
        application = Application(
            internship_id=internship.id,
            student_id=student.id,
            status="APPLIED",
        )
        session.add(application)
        await session.flush()
        session.add_all(
            [
                EmailMessage(
                    user_id=student.id,
                    recipient_email=student.email,
                    sender_email="noreply@internship.local",
                    subject="Older application email",
                    message_type="GENERAL",
                    body="Legacy message",
                    application_id=None,
                    message_id=None,
                    delivered_via_smtp=False,
                ),
                Notification(
                    user_id=student.id,
                    application_id=None,
                    notification_type="GENERAL",
                    title="Older notification",
                    body="Notification created before application links.",
                ),
            ]
        )
        await session.commit()
        application_id = application.id
        student_id = student.id

    token = create_token(str(student_id), UserRole.STUDENT.value, "access", timedelta(minutes=30))
    headers = {"Authorization": f"Bearer {token}"}
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            dashboard = await client.get("/api/v1/applications/mine", headers=headers)
            mailbox = await client.get("/api/v1/me/emails", headers=headers)
            notifications = await client.get("/api/v1/notifications", headers=headers)
            timeline = await client.get(f"/api/v1/applications/{application_id}/timeline", headers=headers)
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(previous_overrides)
        await engine.dispose()

    assert dashboard.status_code == 200
    assert dashboard.json()["applications"][0]["id"] == application_id
    assert "latest_event_type" not in dashboard.json()["applications"][0]
    assert mailbox.status_code == 200
    assert mailbox.json()[0]["gmail_url"] is None
    assert notifications.status_code == 200
    assert notifications.json()[0]["application_id"] is None
    assert notifications.json()[0]["gmail_url"] is None
    assert timeline.status_code == 200
    assert timeline.json()["steps"][0]["key"] == "APPLIED"
