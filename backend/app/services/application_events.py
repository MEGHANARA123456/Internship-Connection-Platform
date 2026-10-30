# This module provides functions to record events related to applications in the database. It includes functions to log general events, transition application statuses, and record interview-related events. The events are stored in the ApplicationEvent and ApplicationStatusEvent models, allowing for tracking the history of changes and actions taken on applications over time.
from __future__ import annotations
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Application, ApplicationEvent, ApplicationStatusEvent

# record_event is used to log events related to an application in the database. It checks if the event type is valid and, if the "once" flag is set, ensures that the event is only recorded once for a given application. This function helps maintain a history of events associated with an application, which can be useful for tracking its progress and changes over time.
async def record_event(
    db: AsyncSession,
    application_id: int,
    event_type: str,
    actor_id: int | None = None,
    once: bool = False,
) -> ApplicationEvent | None:
    """Add an application event unless its type is blank or already recorded when ``once`` is set."""
    event_type = (event_type or '').strip()
    if not event_type:
        return None

    if once:
        existing = await db.scalar(
            select(ApplicationEvent.id)
            .where(ApplicationEvent.application_id == application_id, ApplicationEvent.event_type == event_type)
            .limit(1)
        )
        if existing is not None:
            return None

    event = ApplicationEvent(
        application_id=application_id,
        event_type=event_type,
        actor_id=actor_id,
    )
    db.add(event)
    await db.flush()
    return event

# transition_application and record_status_event are used to change the status of an application and log the change in the database. They ensure that the status transition is recorded as an event, which can be useful for auditing and tracking the history of an application's status changes.
async def transition_application(
    db: AsyncSession,
    application: Application,
    target_status: str,
    actor_id: int | None = None,
    *,
    note: str | None = None,
) -> ApplicationStatusEvent | None:
    """Set application status and persist the transition in one shared path."""
    previous_status = application.status
    if previous_status == target_status:
        return None

    application.status = target_status
    return await record_status_event(
        db,
        application.id,
        previous_status,
        target_status,
        actor_id,
        note=note,
    )


async def record_status_event(
    db: AsyncSession,
    application_id: int,
    from_status: str | None,
    to_status: str,
    actor_id: int | None = None,
    *,
    note: str | None = None,
) -> ApplicationStatusEvent:
    """Persist a status-history row and a matching general event, without committing."""
    event = ApplicationStatusEvent(
        application_id=application_id,
        from_status=from_status,
        to_status=to_status,
        changed_by_user_id=actor_id,
        note=note,
    )
    db.add(event)
    await db.flush()
    await record_event(db, application_id, to_status, actor_id)
    return event

async def record_interview_event(
    db: AsyncSession,
    application_id: int,
    event_type: str,
    actor_id: int | None,
    *,
    note: str | None = None,
) -> ApplicationStatusEvent:
    """Record an interview-related event while leaving the application's status unchanged."""
    application = await db.get(Application, application_id)
    current_status = application.status if application else None
    await record_event(db, application_id, event_type, actor_id)
    event = ApplicationStatusEvent(
        application_id=application_id,
        from_status=current_status,
        to_status=current_status,
        changed_by_user_id=actor_id,
        note=f"{event_type}: {note}".strip(": ") if note else event_type,
    )
    db.add(event)
    await db.flush()
    return event
