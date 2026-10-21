from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.v1.dependencies import get_current_user, get_db
from app.core.security import create_token
from app.main import app
from app.models import (
    Application,
    ApplicationEvent,
    ApplicationStatusEvent,
    AuditLog,
    CompanyProfile,
    Interview,
    Internship,
    Notification,
    StudentProfile,
    User,
    UserRole,
)
from app.models.base import Base


@pytest.mark.anyio
async def test_close_without_rejecting_preserves_all_application_statuses(tmp_path: Path) -> None:
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'keep-review.db'}")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    statuses = [
        "APPLIED",
        "UNDER_REVIEW",
        "SHORTLISTED",
        "INTERVIEW_SCHEDULED",
        "SELECTED",
        "REJECTED",
        "WITHDRAWN",
    ]
    async with sessions() as db:
        company = User(email="keep-review-company@example.com", password_hash="unused", role=UserRole.COMPANY)
        students = [
            User(email=f"keep-review-{index}@example.com", password_hash="unused", role=UserRole.STUDENT)
            for index in range(len(statuses))
        ]
        db.add_all([company, *students])
        await db.flush()
        internship = Internship(
            company_id=company.id,
            title="Keep Reviewing Role",
            description="Existing applications stay active.",
            location="Remote",
            industry="Technology",
            duration_months=3,
            work_mode="REMOTE",
            deadline=date.today() + timedelta(days=10),
            status="PUBLISHED",
        )
        db.add(internship)
        await db.flush()
        applications = [
            Application(internship_id=internship.id, student_id=student.id, status=status)
            for student, status in zip(students, statuses)
        ]
        db.add_all(applications)
        await db.commit()

        from app.services.internship_closing import close_internship

        first_close = await close_internship(db, internship, company)
        assert first_close.internship.status == "CLOSED"
        assert not first_close.was_already_closed
        assert [application.status for application in applications] == statuses

        repeated_close = await close_internship(db, internship, company)
        assert repeated_close.was_already_closed

        notifications = list(
            await db.scalars(
                select(Notification).where(
                    Notification.application_id.in_([application.id for application in applications])
                )
            )
        )
        closure_events = list(
            await db.scalars(
                select(ApplicationEvent).where(
                    ApplicationEvent.event_type == "INTERNSHIP_CLOSED",
                    ApplicationEvent.application_id.in_([application.id for application in applications]),
                )
            )
        )
        assert len(notifications) == 5
        assert len({notification.application_id for notification in notifications}) == 5
        assert len(closure_events) == 5
    await engine.dispose()


@pytest.mark.anyio
async def test_close_preview_reject_pending_notifications_and_repeat_are_atomic(tmp_path: Path) -> None:
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{tmp_path / 'role-close.db'}",
        connect_args={"timeout": 30},
    )
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    async def override_db():
        async with sessions() as session:
            yield session

    previous_overrides = app.dependency_overrides.copy()
    app.dependency_overrides[get_db] = override_db
    active_user: dict[str, User] = {}
    app.dependency_overrides[get_current_user] = lambda: active_user["value"]

    async with sessions() as db:
        company = User(email="close-company@example.com", password_hash="unused", role=UserRole.COMPANY)
        admin = User(email="close-admin@example.com", password_hash="unused", role=UserRole.ADMIN)
        db.add_all([company, admin])
        await db.flush()
        db.add(
            CompanyProfile(
                user_id=company.id,
                company_name="Close Company",
                industry="Technology",
                verification_status="VERIFIED",
            )
        )
        internship = Internship(
            company_id=company.id,
            title="Platform Intern",
            description="Help build reliable platforms.",
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
        await db.flush()
        statuses = [
            "APPLIED",
            "UNDER_REVIEW",
            "SHORTLISTED",
            "INTERVIEW_SCHEDULED",
            "SELECTED",
            "REJECTED",
            "WITHDRAWN",
        ]
        students = [
            User(
                email=f"closing-student-{index}@example.com",
                password_hash="unused",
                role=UserRole.STUDENT,
                is_verified=True,
            )
            for index in range(len(statuses))
        ]
        db.add_all(students)
        await db.flush()
        db.add_all([
            StudentProfile(
                user_id=student.id,
                full_name=f"Closing Student {index}",
                university="Example University",
                major="Computer Science",
                graduation_year=2027,
                skills="Python",
            )
            for index, student in enumerate(students)
        ])
        applications = [
            Application(internship_id=internship.id, student_id=student.id, status=status)
            for student, status in zip(students, statuses)
        ]
        db.add_all(applications)
        await db.flush()
        db.add(
            Interview(
                application_id=applications[3].id,
                scheduled_by=company.id,
                scheduled_at=datetime.now(timezone.utc) + timedelta(days=2),
                interview_type="VIDEO",
                status="SCHEDULED",
            )
        )
        await db.commit()
        company_id, admin_id, internship_id = company.id, admin.id, internship.id
        application_ids = [application.id for application in applications]
        active_user["value"] = company

    def headers(user_id: int, role: UserRole) -> dict[str, str]:
        token = create_token(str(user_id), role.value, "access", timedelta(minutes=30))
        return {"Authorization": f"******"}

    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://closing-test") as client:
            company_headers = headers(company_id, UserRole.COMPANY)
            preview = await client.get(
                f"/api/v1/internships/{internship_id}/close-preview",
                headers=company_headers,
            )
            assert preview.status_code == 200
            assert preview.json()["counts"] == {
                "APPLIED": 1,
                "UNDER_REVIEW": 1,
                "SHORTLISTED": 1,
                "INTERVIEW_SCHEDULED": 1,
                "SELECTED": 1,
                "REJECTED": 1,
                "WITHDRAWN": 1,
            }
            assert preview.json()["upcoming_interviews"] == 1

            closed = await client.post(
                f"/api/v1/internships/{internship_id}/close",
                headers=company_headers,
                json={"reject_pending": True, "note": "We are pausing new hiring."},
            )
            assert closed.status_code == 200
            assert closed.json()["status"] == "CLOSED"
            assert closed.json()["closed_at"] is not None

            repeated = await client.post(
                f"/api/v1/internships/{internship_id}/close",
                headers=company_headers,
                json={"reject_pending": True},
            )
            assert repeated.status_code == 200

            active_user["value"] = students[0]
            apply_token = headers(students[0].id, UserRole.STUDENT)
            blocked = await client.post(
                f"/api/v1/applications/internships/{internship_id}",
                headers=apply_token,
                json={"cover_note": "Applying after closure"},
            )
            assert blocked.status_code == 422
            assert blocked.json()["code"] == "INTERNSHIP_NOT_OPEN"
            assert blocked.json()["detail"] == "This internship is not open for applications."

            closed_detail = await client.get(f"/api/v1/internships/{internship_id}")
            assert closed_detail.status_code == 200

            student_applications = await client.get(
                "/api/v1/applications/mine",
                headers=apply_token,
            )
            assert student_applications.status_code == 200
            assert student_applications.json()["applications"][0]["internship_status"] == "CLOSED"
            assert student_applications.json()["applications"][0]["internship_closed_at"] is not None

            timeline = await client.get(
                f"/api/v1/applications/{application_ids[0]}/timeline",
                headers=apply_token,
            )
            assert timeline.status_code == 200
            assert timeline.json()["summary"]["internship_status"] == "CLOSED"
            assert any(
                step["description"].startswith("Internship closed on ")
                for step in timeline.json()["steps"]
            )

            other_company = User(email="other-close-company@example.com", password_hash="unused", role=UserRole.COMPANY)
            async with sessions() as db:
                db.add(other_company)
                await db.commit()
                await db.refresh(other_company)
                other_id = other_company.id
                active_user["value"] = other_company
            denied = await client.post(
                f"/api/v1/internships/{internship_id}/close",
                headers=headers(other_id, UserRole.COMPANY),
                json={},
            )
            assert denied.status_code == 404
            active_user["value"] = students[0]
            student_preview = await client.get(
                f"/api/v1/internships/{internship_id}/close-preview",
                headers=apply_token,
            )
            assert student_preview.status_code == 403

        async with sessions() as db:
            states = list(await db.scalars(select(Application.status).where(Application.id.in_(application_ids)).order_by(Application.id)))
            assert states == ["REJECTED", "REJECTED", "SHORTLISTED", "INTERVIEW_SCHEDULED", "SELECTED", "REJECTED", "WITHDRAWN"]
            notices = list(await db.scalars(select(Notification).where(Notification.application_id.in_(application_ids))))
            assert len(notices) == 5
            assert sorted(notice.notification_type for notice in notices) == [
                "APPLICATION_STATUS",
                "APPLICATION_STATUS",
                "INTERNSHIP_CLOSED",
                "INTERNSHIP_CLOSED",
                "INTERNSHIP_CLOSED",
            ]
            assert len({notice.application_id for notice in notices}) == 5
            status_events = list(
                await db.scalars(
                    select(ApplicationStatusEvent).where(
                        ApplicationStatusEvent.application_id.in_(application_ids)
                    )
                )
            )
            assert sum(event.to_status == "REJECTED" for event in status_events) == 2
            closure_events = list(
                await db.scalars(
                    select(ApplicationEvent).where(
                        ApplicationEvent.application_id.in_(application_ids),
                        ApplicationEvent.event_type == "INTERNSHIP_CLOSED",
                    )
                )
            )
            assert len(closure_events) == 5
            close_audits = list(
                await db.scalars(
                    select(AuditLog).where(
                        AuditLog.target_id == internship_id,
                        AuditLog.action == "INTERNSHIP_CLOSED",
                    )
                )
            )
            assert len(close_audits) == 1
            assert close_audits[0].actor_id == company_id
            assert close_audits[0].metadata_["counts_per_status"]["APPLIED"] == 1
            assert close_audits[0].metadata_["reject_pending"] is True
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(previous_overrides)
        await engine.dispose()


@pytest.mark.anyio
async def test_admin_close_uses_shared_service_and_platform_notification(tmp_path: Path) -> None:
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'admin-close.db'}")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    async def override_db():
        async with sessions() as session:
            yield session

    previous_overrides = app.dependency_overrides.copy()
    app.dependency_overrides[get_db] = override_db
    async with sessions() as db:
        admin = User(email="moderating-admin@example.com", password_hash="unused", role=UserRole.ADMIN)
        company = User(email="moderated-company@example.com", password_hash="unused", role=UserRole.COMPANY)
        student = User(email="moderated-student@example.com", password_hash="unused", role=UserRole.STUDENT)
        db.add_all([admin, company, student])
        await db.flush()
        internship = Internship(
            company_id=company.id,
            title="Admin Closed Role",
            description="A role closed by the platform.",
            location="Remote",
            industry="Technology",
            duration_months=3,
            work_mode="REMOTE",
            deadline=date.today() + timedelta(days=10),
            status="PUBLISHED",
        )
        db.add(internship)
        await db.flush()
        application = Application(internship_id=internship.id, student_id=student.id)
        db.add(application)
        await db.commit()
        admin_id, internship_id, application_id = admin.id, internship.id, application.id
    app.dependency_overrides[get_current_user] = lambda: admin

    admin_token = create_token(str(admin_id), UserRole.ADMIN.value, "access", timedelta(minutes=30))
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://admin-close-test") as client:
            response = await client.post(
                f"/api/v1/admin/internships/{internship_id}/moderate",
                headers={"Authorization": f"******"},
                json={"status": "CLOSED"},
            )
        assert response.status_code == 200
        async with sessions() as db:
            notice = await db.scalar(
                select(Notification).where(
                    Notification.application_id == application_id,
                    Notification.notification_type == "INTERNSHIP_CLOSED",
                )
            )
            audit = await db.scalar(
                select(AuditLog).where(
                    AuditLog.target_id == internship_id,
                    AuditLog.action == "INTERNSHIP_CLOSED",
                )
            )
        assert notice is not None
        assert notice.body.startswith("The platform has closed")
        assert audit is not None
        assert audit.actor_id == admin_id
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(previous_overrides)
        await engine.dispose()


@pytest.mark.anyio
async def test_role_close_email_is_opt_in_smtp_only_and_skips_fake_domains(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.services import internship_closing

    captured: list[dict] = []

    async def record_email(**kwargs):
        captured.append(kwargs)

    monkeypatch.setattr(internship_closing, "send_dev_email", record_email)
    monkeypatch.setattr(
        internship_closing,
        "get_settings",
        lambda: SimpleNamespace(
            notify_email_on_role_close=True,
            mail_server="smtp.example",
            mail_username="mailer",
            mail_password="password",
        ),
    )
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with sessions() as db:
        company = User(email="email-company@example.com", password_hash="unused", role=UserRole.COMPANY)
        real_student = User(email="real-student@gmail.com", password_hash="unused", role=UserRole.STUDENT)
        fake_student = User(email="fake-student@example.com", password_hash="unused", role=UserRole.STUDENT)
        db.add_all([company, real_student, fake_student])
        await db.flush()
        internship = Internship(
            company_id=company.id,
            title="Email Role",
            description="An email opt-in test.",
            location="Remote",
            industry="Technology",
            duration_months=3,
            work_mode="REMOTE",
            deadline=date.today() + timedelta(days=10),
            status="PUBLISHED",
        )
        db.add(internship)
        await db.flush()
        db.add_all(
            [
                Application(internship_id=internship.id, student_id=real_student.id),
                Application(internship_id=internship.id, student_id=fake_student.id),
            ]
        )
        await db.flush()
        from app.services.internship_closing import close_internship

        result = await close_internship(db, internship, company)
        assert [email["to"] for email in result.emails] == ["real-student@gmail.com"]
        assert result.emails[0]["application_id"] is not None
    await engine.dispose()
