from datetime import datetime, timedelta, timezone
import re

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models import Application, Interview, Internship
from app.services.application_events import record_interview_event
from app.services.notify import notify


def _duration_minutes(notes: str | None) -> int:
    """Read a ``Duration: N min`` note value, defaulting to 30 outside the supported range."""
    match = re.search(r"(?:\[)?Duration:\s*(\d+)\s*min", notes or "", re.IGNORECASE)
    if match is None:
        return 30
    minutes = int(match.group(1))
    return minutes if 1 <= minutes <= 240 else 30


async def expire_overdue_interviews(
    db: AsyncSession,
    now: datetime | None = None,
) -> int:
    """Cancel scheduled interviews past their duration and grace period, notify participants, and commit changes."""
    current_time = now or datetime.now(timezone.utc)
    if current_time.tzinfo is None:
        current_time = current_time.replace(tzinfo=timezone.utc)
    else:
        current_time = current_time.astimezone(timezone.utc)
    cutoff = current_time - timedelta(minutes=get_settings().interview_auto_cancel_grace_minutes)
    interviews = list(
        (
            await db.scalars(
                select(Interview)
                .where(
                    Interview.status.in_(("SCHEDULED", "RESCHEDULED")),
                    Interview.scheduled_at <= cutoff,
                )
                .order_by(Interview.id)
                .with_for_update(skip_locked=True)
            )
        ).all()
    )
    expired = 0
    for interview in interviews:
        scheduled_at = interview.scheduled_at
        if scheduled_at.tzinfo is None:
            scheduled_at = scheduled_at.replace(tzinfo=timezone.utc)
        expiry_at = scheduled_at + timedelta(
            minutes=_duration_minutes(interview.notes)
            + get_settings().interview_auto_cancel_grace_minutes
        )
        if expiry_at > current_time:
            continue
        claimed = await db.execute(
            update(Interview)
            .where(
                Interview.id == interview.id,
                Interview.status.in_(("SCHEDULED", "RESCHEDULED")),
            )
            .values(
                status="CANCELLED",
                cancel_reason="TIME_PASSED",
                cancelled_at=current_time,
            )
        )
        if claimed.rowcount != 1:
            continue

        application = await db.get(Application, interview.application_id)
        internship = (
            await db.get(Internship, application.internship_id)
            if application is not None
            else None
        )
        if application is None:
            continue

        formatted_date = scheduled_at.astimezone(timezone.utc).strftime(
            "%A, %b %d, %Y %I:%M %p UTC"
        )
        body = (
            f"Your interview on {formatted_date} was cancelled automatically "
            "because the scheduled time passed. The company can reschedule."
        )
        await notify(
            db,
            application.student_id,
            "INTERVIEW_AUTO_CANCELLED",
            "Interview automatically cancelled",
            body,
            email=get_settings().notify_email_on_role_close,
            application_id=application.id,
        )
        if internship is not None:
            await notify(
                db,
                internship.company_id,
                "INTERVIEW_AUTO_CANCELLED",
                "Interview automatically cancelled",
                body,
                email=get_settings().notify_email_on_role_close,
                application_id=application.id,
            )
        await record_interview_event(
            db,
            application.id,
            "INTERVIEW_AUTO_CANCELLED",
            None,
            note="TIME_PASSED",
        )
        expired += 1
    if expired:
        await db.commit()
    return expired
