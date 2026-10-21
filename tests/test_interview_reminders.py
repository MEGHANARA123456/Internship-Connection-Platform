from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.models import Application, CompanyProfile, Internship, Interview, Notification, User, UserRole
from app.models.base import Base
from app.services.interview_reminders import send_interview_reminders


@pytest.mark.anyio
async def test_interview_reminders_are_idempotent():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    now = datetime.now(timezone.utc)
    async with sessions() as db:
        company = User(email="reminder-company@example.com", password_hash="unused", role=UserRole.COMPANY)
        student = User(email="reminder-student@example.com", password_hash="unused", role=UserRole.STUDENT)
        db.add_all([company, student])
        await db.flush()
        db.add(CompanyProfile(user_id=company.id, company_name="Reminder Co", industry="Technology"))
        internship = Internship(
            company_id=company.id,
            title="Intern",
            description="Role",
            location="Remote",
            industry="Technology",
            duration_months=3,
            work_mode="REMOTE",
            skills="",
            deadline=(now + timedelta(days=30)).date(),
            status="PUBLISHED",
        )
        db.add(internship)
        await db.flush()
        application = Application(internship_id=internship.id, student_id=student.id, status="INTERVIEW_SCHEDULED")
        db.add(application)
        await db.flush()
        db.add(
            Interview(
                application_id=application.id,
                scheduled_by=company.id,
                scheduled_at=now + timedelta(hours=24, minutes=-2),
                interview_type="VIDEO",
                status="SCHEDULED",
            )
        )
        await db.commit()

        assert await send_interview_reminders(db, now) == 1
        assert await send_interview_reminders(db, now) == 0
        notification_count = await db.scalar(
            select(func.count(Notification.id)).where(
                Notification.user_id == student.id,
                Notification.notification_type == "INTERVIEW_REMINDER",
            )
        )
        assert notification_count == 1

    await engine.dispose()
