"""Time-derived interview and application display state."""

from datetime import datetime, timedelta, timezone
import re
from collections.abc import Iterable
from typing import Literal, Protocol

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Application, Interview

InterviewState = Literal["upcoming", "in_progress", "completed"]


class InterviewTiming(Protocol):
    scheduled_at: datetime
    notes: str | None


_DURATION_PATTERN = re.compile(r"(?:\[)?Duration:\s*(\d+)\s*min", re.IGNORECASE)
_VALID_INTERVIEW_STATUSES = {"SCHEDULED", "RESCHEDULED", "COMPLETED"}


def interview_duration_minutes(interview: InterviewTiming) -> int:
    """Return the recorded duration, defaulting to 60 minutes when it is absent or invalid."""
    match = _DURATION_PATTERN.search(interview.notes or "")
    if match is None:
        return 60
    duration = int(match.group(1))
    return duration if 1 <= duration <= 240 else 60


def interview_interval(interview: InterviewTiming) -> tuple[datetime, datetime]:
    """Return the interview's UTC start and scheduled end times."""
    start = interview.scheduled_at
    if start.tzinfo is None:
        start = start.replace(tzinfo=timezone.utc)
    else:
        start = start.astimezone(timezone.utc)
    return start, start + timedelta(minutes=interview_duration_minutes(interview))


def get_interview_state(
    interview: InterviewTiming,
    now: datetime | None = None,
) -> InterviewState:
    """Classify an interview by its scheduled interval, independent of status-change time."""
    current_time = now or datetime.now(timezone.utc)
    if current_time.tzinfo is None:
        current_time = current_time.replace(tzinfo=timezone.utc)
    else:
        current_time = current_time.astimezone(timezone.utc)
    start, end = interview_interval(interview)
    if current_time < start:
        return "upcoming"
    if current_time < end:
        return "in_progress"
    return "completed"


def derive_application_display_status(
    status: str,
    interviews: Iterable[Interview],
    now: datetime | None = None,
) -> str:
    """Derive EXPIRED only for a scheduled application whose latest valid interview has ended."""
    if status != "INTERVIEW_SCHEDULED":
        return status
    latest = max(
        interviews,
        key=lambda interview: (interview.scheduled_at, interview.id or 0),
        default=None,
    )
    if latest is not None and latest.status not in _VALID_INTERVIEW_STATUSES:
        if latest.status != "CANCELLED" or latest.cancel_reason != "TIME_PASSED":
            return status
    if latest is not None and get_interview_state(latest, now) == "completed":
        return "EXPIRED"
    return status


async def get_application_display_status(
    db: AsyncSession,
    application: Application,
    now: datetime | None = None,
) -> str:
    """Load an application's interview records and derive its display-only status."""
    if application.status != "INTERVIEW_SCHEDULED":
        return application.status
    interviews = list(
        await db.scalars(
            select(Interview).where(Interview.application_id == application.id)
        )
    )
    return derive_application_display_status(application.status, interviews, now)
