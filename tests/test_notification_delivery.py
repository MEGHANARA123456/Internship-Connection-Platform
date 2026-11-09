from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta, timezone

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.v1.dependencies import get_db
from app.core.security import create_token
from app.main import app
from app.models import (
    Application,
    CompanyProfile,
    EmailMessage,
    Interview,
    Internship,
    Notification,
    StudentProfile,
    User,
    UserRole,
)
from app.models.base import Base
from app.services.notify import notify


@asynccontextmanager
async def client_with_database():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    previous_overrides = app.dependency_overrides.copy()

    async def override_db():
        async with sessions() as session:
            yield session

    app.dependency_overrides[get_db] = override_db
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            yield client, sessions
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(previous_overrides)
        await engine.dispose()


def access_headers(user: User) -> dict[str, str]:
    token = create_token(str(user.id), user.role.value, "access", timedelta(minutes=30))
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest.mark.anyio
async def test_apply_notifies_company_and_student_and_lists_newest_first() -> None:
    async with client_with_database() as (client, sessions):
        async with sessions() as db:
            student = User(email="student@example.com", password_hash="fake", role=UserRole.STUDENT, is_verified=True)
            company = User(email="company@example.com", password_hash="fake", role=UserRole.COMPANY, is_verified=True)
            db.add_all([student, company])
            await db.flush()
            db.add_all(
                [
                    StudentProfile(
                        user_id=student.id,
                        full_name="Taylor Student",
                        university="State University",
                        major="Computer Science",
                        graduation_year=2027,
                        skills="Python",
                    ),
                    CompanyProfile(
                        user_id=company.id,
                        company_name="Example Co",
                        industry="Technology",
                        verification_status="VERIFIED",
                    ),
                ]
            )
            internship = Internship(
                company_id=company.id,
                title="Backend Intern",
                description="Build backend systems and services.",
                location="Remote",
                industry="Technology",
                duration_months=3,
                stipend=1000,
                work_mode="REMOTE",
                skills="Python",
                deadline=date.today() + timedelta(days=30),
                status="PUBLISHED",
            )
            db.add(internship)
            db.add(
                Notification(
                    user_id=company.id,
                    notification_type="APPLICATION_STATUS",
                    title="Older update",
                    body="An earlier update.",
                    created_at=datetime.now(timezone.utc) - timedelta(days=1),
                )
            )
            await db.commit()
            await db.refresh(internship)

        response = await client.post(
            f"/api/v1/applications/internships/{internship.id}",
            json={"cover_note": "I am interested in this role."},
            headers=access_headers(student),
        )
        assert response.status_code == 201
        application_id = response.json()["id"]

        company_alerts = await client.get("/api/v1/notifications", headers=access_headers(company))
        student_alerts = await client.get("/api/v1/notifications", headers=access_headers(student))
        timeline = await client.get(
            f"/api/v1/applications/{application_id}/timeline",
            headers=access_headers(student),
        )
        assert company_alerts.status_code == 200
        assert student_alerts.status_code == 200
        assert timeline.status_code == 200
        assert timeline.json()["steps"][0]["key"] == "APPLIED"
        assert company_alerts.json()[0]["title"] == "New application: Taylor Student applied to Backend Intern"
        assert company_alerts.json()[1]["title"] == "Older update"
        assert student_alerts.json()[0]["title"] == "Application submitted for Backend Intern"
        assert company_alerts.json()[0]["application_id"] == application_id
        assert student_alerts.json()[0]["application_id"] == application_id


@pytest.mark.anyio
async def test_pre_migration_notification_without_application_and_email_links_is_returned() -> None:
    async with client_with_database() as (client, sessions):
        async with sessions() as db:
            student = User(email="legacy-notification@gmail.com", password_hash="fake", role=UserRole.STUDENT)
            db.add(student)
            await db.flush()
            notification = Notification(
                user_id=student.id,
                application_id=None,
                notification_type="GENERAL",
                title="A legacy alert",
                body="No application link was stored.",
            )
            db.add(notification)
            db.add(
                EmailMessage(
                    user_id=student.id,
                    recipient_email=student.email,
                    sender_email="noreply@internship.local",
                    subject="Old message",
                    message_type="GENERAL",
                    body="Old mail without identifiers",
                    application_id=None,
                    message_id=None,
                    delivered_via_smtp=False,
                )
            )
            await db.commit()
            headers = access_headers(student)

        notification_response = await client.get("/api/v1/notifications", headers=headers)
        mailbox_response = await client.get("/api/v1/me/emails", headers=headers)

        assert notification_response.status_code == 200
        assert notification_response.json()[0]["application_id"] is None
        assert notification_response.json()[0]["gmail_url"] is None
        assert mailbox_response.status_code == 200
        assert mailbox_response.json()[0]["gmail_url"] is None


@pytest.mark.anyio
async def test_email_detail_is_owner_only_sanitized_and_uses_reference_gmail_search() -> None:
    async with client_with_database() as (client, sessions):
        async with sessions() as db:
            owner = User(email="owner@gmail.com", password_hash="fake", role=UserRole.STUDENT)
            other = User(email="other@gmail.com", password_hash="fake", role=UserRole.STUDENT)
            db.add_all([owner, other])
            await db.flush()
            email = EmailMessage(
                user_id=owner.id,
                recipient_email=owner.email,
                sender_email="sender@internsphere.example",
                subject="Interview update",
                message_type="INTERVIEW",
                body="Your interview is scheduled.",
                html='<p>Hello</p><script>alert("bad")</script><img src=x onerror="alert(1)">',
                delivered_via_smtp=True,
            )
            db.add(email)
            await db.commit()
            await db.refresh(email)
            owner_headers = access_headers(owner)
            other_headers = access_headers(other)
            email_id = email.id

        owner_response = await client.get(f"/api/v1/emails/{email_id}", headers=owner_headers)
        other_response = await client.get(f"/api/v1/emails/{email_id}", headers=other_headers)

        assert owner_response.status_code == 200
        assert "<script" not in owner_response.json()["html"].lower()
        assert "alert(" not in owner_response.json()["html"]
        assert "onerror" not in owner_response.json()["html"]
        assert owner_response.json()["gmail_url"].endswith(
            f"#search/%22IS-{email_id}%22%20in%3Aanywhere"
        )
        assert other_response.status_code == 404


@pytest.mark.anyio
async def test_interview_invite_count_follows_actionable_schedule_and_student_ownership() -> None:
    async with client_with_database() as (client, sessions):
        async with sessions() as db:
            student = User(email="invite-student@example.com", password_hash="fake", role=UserRole.STUDENT)
            other_student = User(email="other-invite-student@example.com", password_hash="fake", role=UserRole.STUDENT)
            company = User(email="invite-company@example.com", password_hash="fake", role=UserRole.COMPANY)
            db.add_all([student, other_student, company])
            await db.flush()
            internship = Internship(
                company_id=company.id,
                title="Invite Intern",
                description="Role",
                location="Remote",
                industry="Technology",
                duration_months=3,
                work_mode="REMOTE",
                skills="",
                deadline=date.today() + timedelta(days=30),
                status="PUBLISHED",
            )
            db.add(internship)
            await db.flush()
            upcoming_app = Application(
                internship_id=internship.id,
                student_id=student.id,
                status="INTERVIEW_SCHEDULED",
            )
            past_app = Application(
                internship_id=internship.id,
                student_id=other_student.id,
                status="INTERVIEW_SCHEDULED",
            )
            db.add_all([upcoming_app, past_app])
            await db.flush()
            upcoming_interview = Interview(
                    application_id=upcoming_app.id,
                    scheduled_by=company.id,
                    scheduled_at=datetime.now(timezone.utc) + timedelta(days=1),
                    interview_type="VIDEO",
                    status="SCHEDULED",
                )
            db.add_all([
                upcoming_interview,
                Interview(
                    application_id=past_app.id,
                    scheduled_by=company.id,
                    scheduled_at=datetime.now(timezone.utc) - timedelta(days=1),
                    interview_type="VIDEO",
                    status="CANCELLED",
                ),
                Notification(
                    user_id=student.id,
                    application_id=upcoming_app.id,
                    notification_type="INTERVIEW_INVITE",
                    title="Upcoming",
                    body="Interview",
                ),
                Notification(
                    user_id=other_student.id,
                    application_id=past_app.id,
                    notification_type="INTERVIEW_INVITE",
                    title="Cancelled",
                    body="Interview",
                ),
                Notification(
                    user_id=other_student.id,
                    application_id=past_app.id,
                    notification_type="APPLICATION_STATUS",
                    title="Other notification",
                    body="Not an invite",
                ),
            ])
            await db.commit()
            await db.refresh(upcoming_interview)
            student_headers = access_headers(student)
            other_headers = access_headers(other_student)
            company_headers = access_headers(company)

        counts = await client.get("/api/v1/students/me/nav-counts", headers=student_headers)
        assert counts.status_code == 200
        assert counts.json()["invites_new"] == 1

        reschedule = await client.patch(
            f"/api/v1/interviews/{upcoming_interview.id}",
            headers=company_headers,
            json={
                "status": "RESCHEDULED",
                "scheduled_at": (datetime.now(timezone.utc) + timedelta(days=2)).isoformat(),
                "change_reason": "Recruiter availability changed",
            },
        )
        assert reschedule.status_code == 200
        rescheduled_counts = await client.get("/api/v1/students/me/nav-counts", headers=student_headers)
        assert rescheduled_counts.json()["invites_new"] == 1

        clear = await client.patch("/api/v1/interviews/invites/read", headers=student_headers)
        assert clear.status_code == 204
        counts_after_open = await client.get("/api/v1/students/me/nav-counts", headers=student_headers)
        assert counts_after_open.json()["invites_new"] == 0

        other_notifications = await client.get("/api/v1/notifications", headers=other_headers)
        other_invite = next(item for item in other_notifications.json() if item["notification_type"] == "INTERVIEW_INVITE")
        other_application_notice = next(item for item in other_notifications.json() if item["notification_type"] == "APPLICATION_STATUS")
        assert other_invite["read_at"] is None
        assert other_application_notice["read_at"] is None
        other_counts = await client.get("/api/v1/students/me/nav-counts", headers=other_headers)
        assert other_counts.json()["invites_new"] == 0
        other_notifications = await client.get("/api/v1/notifications", headers=other_headers)
        other_invite = next(item for item in other_notifications.json() if item["notification_type"] == "INTERVIEW_INVITE")
        other_application_notice = next(item for item in other_notifications.json() if item["notification_type"] == "APPLICATION_STATUS")
        assert other_invite["read_at"] is not None
        assert other_application_notice["read_at"] is None


@pytest.mark.anyio
async def test_admin_approval_notifies_owning_company() -> None:
    async with client_with_database() as (client, sessions):
        async with sessions() as db:
            company = User(email="approval-company@example.com", password_hash="fake", role=UserRole.COMPANY, is_verified=True)
            admin = User(email="approval-admin@example.com", password_hash="fake", role=UserRole.ADMIN, is_verified=True)
            db.add_all([company, admin])
            await db.flush()
            db.add(CompanyProfile(user_id=company.id, company_name="Example Co", industry="Technology"))
            internship = Internship(
                company_id=company.id,
                title="Data Intern",
                description="Analyze data and develop reporting tools.",
                location="Remote",
                industry="Technology",
                duration_months=3,
                work_mode="REMOTE",
                deadline=date.today() + timedelta(days=30),
                status="PENDING_APPROVAL",
            )
            db.add(internship)
            await db.commit()
            await db.refresh(internship)

        response = await client.post(
            f"/api/v1/admin/internships/{internship.id}/moderate",
            json={"status": "PUBLISHED"},
            headers=access_headers(admin),
        )
        assert response.status_code == 200
        notifications = await client.get("/api/v1/notifications", headers=access_headers(company))
        assert [item["title"] for item in notifications.json()] == ["Internship approved"]


@pytest.mark.anyio
async def test_list_and_ats_match_scores_are_identical() -> None:
    async with client_with_database() as (client, sessions):
        async with sessions() as db:
            student = User(email="score-student@example.com", password_hash="fake", role=UserRole.STUDENT, is_verified=True)
            company = User(email="score-company@example.com", password_hash="fake", role=UserRole.COMPANY, is_verified=True)
            db.add_all([student, company])
            await db.flush()
            db.add(
                StudentProfile(
                    user_id=student.id,
                    full_name="Score Student",
                    university="State University",
                    major="Computer Science",
                    graduation_year=2027,
                    skills="Python, SQL",
                )
            )
            internship = Internship(
                company_id=company.id,
                title="Python Data Intern",
                description="Build data services using Python and SQL.",
                location="Remote",
                industry="Technology",
                duration_months=3,
                work_mode="REMOTE",
                skills="Python, SQL, Analytics",
                deadline=date.today() + timedelta(days=30),
                status="PUBLISHED",
            )
            db.add(internship)
            await db.commit()
            await db.refresh(internship)

        headers = access_headers(student)
        list_response = await client.get("/api/v1/internships", headers=headers)
        ats_response = await client.get(f"/api/v1/ai/internships/{internship.id}/ats-score", headers=headers)
        assert list_response.status_code == 200
        assert ats_response.status_code == 200
        listed_score = next(item["match_score"] for item in list_response.json()["items"] if item["id"] == internship.id)
        assert listed_score == ats_response.json()["score"]


@pytest.mark.anyio
async def test_notify_blocks_mfa_type_and_notifications_hide_codes() -> None:
    async with client_with_database() as (client, sessions):
        async with sessions() as db:
            user = User(email="blocked@example.com", password_hash="fake", role=UserRole.STUDENT, is_verified=True)
            db.add(user)
            await db.commit()
            await db.refresh(user)

            result = await notify(db, user.id, "MFA_CHALLENGE", "Login challenge", "A login code was requested.")
            assert result is None
            notification_count = await db.scalar(
                select(func.count()).select_from(Notification).where(Notification.user_id == user.id)
            )
            assert notification_count == 0
            db.add(
                Notification(
                    user_id=user.id,
                    notification_type="LEGACY",
                    title="Verification",
                    body="Your code is 123456.",
                )
            )
            await db.commit()

        response = await client.get("/api/v1/notifications", headers=access_headers(user))
        assert response.status_code == 200
        assert response.json() == []
