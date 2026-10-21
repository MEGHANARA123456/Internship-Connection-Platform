from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Application, ApplicationEvent


STAGE_EVENT_TYPES = {
    "screened": {"UNDER_REVIEW", "SHORTLISTED", "INTERVIEW_SCHEDULED", "SELECTED", "ACCEPTED", "REJECTED"},
    "shortlisted": {"SHORTLISTED", "INTERVIEW_SCHEDULED", "SELECTED", "ACCEPTED"},
    "interviews": {"SHORTLISTED", "INTERVIEW_SCHEDULED", "SELECTED", "ACCEPTED"},
    "offers": {"SELECTED", "ACCEPTED"},
}


async def cumulative_student_application_counts(
    db: AsyncSession,
    student_id: int,
    application_ids: list[int] | None = None,
) -> dict[str, int]:
    all_event_types = set().union(*STAGE_EVENT_TYPES.values())
    query = (
        select(ApplicationEvent.event_type, ApplicationEvent.application_id)
        .join(Application, Application.id == ApplicationEvent.application_id)
        .where(
            Application.student_id == student_id,
            ApplicationEvent.event_type.in_(all_event_types),
        )
        .distinct()
    )
    if application_ids is not None:
        query = query.where(Application.id.in_(application_ids)) if application_ids else query.where(Application.id == -1)
    rows = (await db.execute(query)).all()
    reached_by_event: dict[str, set[int]] = {}
    for event_type, application_id in rows:
        reached_by_event.setdefault(event_type, set()).add(application_id)
    return {
        stage: len(set().union(*(reached_by_event.get(event_type, set()) for event_type in event_types)))
        for stage, event_types in STAGE_EVENT_TYPES.items()
    }
