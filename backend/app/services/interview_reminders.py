from datetime import datetime, timedelta, timezone

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Application, Interview, Internship, Notification


async def send_interview_reminders(
    db: AsyncSession,
    now: datetime | None = None,
) -> int:
    current_time = now or datetime.now(timezone.utc)
    reminders_sent = 0
    for hours, sent_field in (
        (24, Interview.reminder_24h_sent_at),
        (1, Interview.reminder_1h_sent_at),
    ):
        window_end = current_time + timedelta(hours=hours)
        window_start = window_end - timedelta(minutes=5)
        rows = (
            await db.execute(
                select(Interview.id, Application.id, Application.student_id, Internship.title)
                .join(Application, Application.id == Interview.application_id)
                .join(Internship, Internship.id == Application.internship_id)
                .where(
                    Interview.status.in_(["SCHEDULED", "RESCHEDULED"]),
                    Interview.scheduled_at > current_time,
                    Interview.scheduled_at > window_start,
                    Interview.scheduled_at <= window_end,
                    sent_field.is_(None),
                )
            )
        ).all()
        for interview_id, application_id, student_id, title in rows:
            result = await db.execute(
                update(Interview)
                .where(Interview.id == interview_id, sent_field.is_(None))
                .values({sent_field.key: current_time})
            )
            if result.rowcount != 1:
                continue
            db.add(
                Notification(
                    user_id=student_id,
                    application_id=application_id,
                    notification_type="INTERVIEW_REMINDER",
                    title=f"Interview in {hours} hours",
                    body=f"Your interview for {title} is scheduled in {hours} hours.",
                    created_at=current_time,
                )
            )
            reminders_sent += 1
    if reminders_sent:
        await db.commit()
    return reminders_sent
