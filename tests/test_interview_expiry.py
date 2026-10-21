from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.models import Application, CompanyProfile, Interview, Internship, Notification, User, UserRole
from app.models.base import Base
from app.services import interview_expiry


@pytest.mark.anyio
async def test_expiry_boundary_is_idempotent_notifies_once_and_preserves_application_status(monkeypatch) -> None:
    monkeypatch.setattr(
        interview_expiry,
        "get_settings",
        lambda: SimpleNamespace(interview_auto_cancel_grace_minutes=60, notify_email_on_role_close=False),
    )
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    scheduled_at = datetime(2026, 1, 1, 12, tzinfo=timezone.utc)
    deadline = scheduled_at + timedelta(minutes=90)
    try:
        async with sessions() as db:
            company = User(email="expiry-company@example.com", password_hash="unused", role=UserRole.COMPANY)
            student = User(email="expiry-student@example.com", password_hash="unused", role=UserRole.STUDENT)
            db.add_all([company, student])
            await db.flush()
            db.add(CompanyProfile(user_id=company.id, company_name="Expiry Co", industry="Technology"))
            internship = Internship(
                company_id=company.id,
                title="Intern",
                description="Role",
                location="Remote",
                industry="Technology",
                duration_months=3,
                work_mode="REMOTE",
                skills="",
                deadline=(scheduled_at + timedelta(days=30)).date(),
                status="PUBLISHED",
            )
            db.add(internship)
            await db.flush()
            application = Application(
                internship_id=internship.id,
                student_id=student.id,
                status="INTERVIEW_SCHEDULED",
            )
            db.add(application)
            await db.flush()
            interview = Interview(
                application_id=application.id,
                scheduled_by=company.id,
                scheduled_at=scheduled_at,
                interview_type="VIDEO",
                notes="[Duration: 30 min] Please prepare.",
                status="SCHEDULED",
            )
            db.add(interview)
            await db.commit()

            assert await interview_expiry.expire_overdue_interviews(db, deadline - timedelta(seconds=1)) == 0
            assert await interview_expiry.expire_overdue_interviews(db, deadline) == 1
            assert await interview_expiry.expire_overdue_interviews(db, deadline + timedelta(minutes=5)) == 0
            await db.refresh(interview)
            await db.refresh(application)
            assert interview.status == "CANCELLED"
            assert interview.cancel_reason == "TIME_PASSED"
            assert interview.cancelled_at is not None
            assert interview.cancelled_at.replace(tzinfo=timezone.utc) == deadline
            assert application.status == "INTERVIEW_SCHEDULED"

            count = await db.scalar(
                select(func.count(Notification.id)).where(
                    Notification.notification_type == "INTERVIEW_AUTO_CANCELLED"
                )
            )
            assert count == 2
            assert await db.scalar(select(func.count(Notification.id)).where(Notification.user_id == student.id)) == 1
    finally:
        await engine.dispose()


@pytest.mark.anyio
async def test_expiry_respects_duration_embedded_in_legacy_interview_notes(monkeypatch) -> None:
    monkeypatch.setattr(
        interview_expiry,
        "get_settings",
        lambda: SimpleNamespace(interview_auto_cancel_grace_minutes=60, notify_email_on_role_close=False),
    )
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    scheduled_at = datetime(2026, 1, 1, 12, tzinfo=timezone.utc)
    try:
        async with sessions() as db:
            company = User(email="duration-company@example.com", password_hash="unused", role=UserRole.COMPANY)
            student = User(email="duration-student@example.com", password_hash="unused", role=UserRole.STUDENT)
            db.add_all([company, student])
            await db.flush()
            internship = Internship(
                company_id=company.id,
                title="Intern",
                description="Role",
                location="Remote",
                industry="Technology",
                duration_months=3,
                work_mode="REMOTE",
                skills="",
                deadline=(scheduled_at + timedelta(days=30)).date(),
                status="PUBLISHED",
            )
            db.add(internship)
            await db.flush()
            application = Application(internship_id=internship.id, student_id=student.id, status="APPLIED")
            db.add(application)
            await db.flush()
            interview = Interview(
                application_id=application.id,
                scheduled_by=company.id,
                scheduled_at=scheduled_at,
                interview_type="VIDEO",
                notes="Duration: 60 min",
                status="RESCHEDULED",
            )
            db.add(interview)
            await db.commit()

            assert await interview_expiry.expire_overdue_interviews(db, scheduled_at + timedelta(minutes=119)) == 0
            assert await interview_expiry.expire_overdue_interviews(db, scheduled_at + timedelta(minutes=120)) == 1
            await db.refresh(interview)
            assert interview.status == "CANCELLED"
    finally:
        await engine.dispose()
