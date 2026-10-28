# This module provides functionality to close internships and handle the associated application effects. It includes functions to close a published internship, notify applicants, and log relevant events in the database. The module ensures that the closure process is handled atomically, maintaining data integrity and consistency across related entities such as applications, notifications, and audit logs.
from __future__ import annotations
import asyncio
import logging
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models import (
    Application,
    ApplicationEvent,
    AuditLog,
    CompanyProfile,
    Interview,
    Internship,
    Notification,
    User,
    UserRole,
)
from app.services.application_events import transition_application
from app.services.mail import FAKE_EMAIL_DOMAINS, send_dev_email

logger = logging.getLogger(__name__)
CLOSE_NOTIFICATION_STATUSES = {
    "APPLIED",
    "UNDER_REVIEW",
    "SHORTLISTED",
    "INTERVIEW_SCHEDULED",
    "SELECTED",
}
FINAL_INACTIVE_STATUSES = {"REJECTED", "WITHDRAWN"}
REJECTABLE_STATUSES = {"APPLIED", "UNDER_REVIEW"}
SIX_DIGIT_CODE = re.compile(r"\b\d{6}\b")


@dataclass
class InternshipCloseResult:
    internship: Internship
    counts: dict[str, int] = field(default_factory=dict)
    upcoming_interviews: int = 0
    notifications: list[dict[str, Any]] = field(default_factory=list)
    emails: list[dict[str, Any]] = field(default_factory=list)
    was_already_closed: bool = False


def _close_notification_body(
    title: str,
    company_name: str,
    status: str,
    *,
    closed_by_platform: bool,
) -> str:
    prefix = "The platform has closed" if closed_by_platform else f"{company_name} has closed"
    if status == "SELECTED":
        outcome = "your selection is unaffected."
    else:
        outcome = f"Your application stays active at {status.replace('_', ' ').title()}."
    return f"{prefix} {title} to new applications. {outcome}"


async def close_internship(
    db: AsyncSession,
    internship: Internship,
    actor: User,
    *,
    reject_pending: bool = False,
    note: str | None = None,
) -> InternshipCloseResult:
    """Close a published role and commit all application effects atomically."""
    if note is not None and len(note) > 300:
        raise ValueError("Closure note must be 300 characters or fewer.")

    locked = await db.scalar(
        select(Internship)
        .where(Internship.id == internship.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if locked is None:
        raise LookupError("Internship not found")
    is_admin = actor.role == UserRole.ADMIN
    if not is_admin and (actor.role != UserRole.COMPANY or locked.company_id != actor.id):
        raise PermissionError("Only the owning company or an admin may close this internship.")
    if locked.status == "CLOSED":
        await db.commit()
        return InternshipCloseResult(internship=locked, was_already_closed=True)
    if locked.status != "PUBLISHED":
        raise ValueError(f"Only published internships can be closed; this internship is {locked.status}.")

    applications = list(
        await db.scalars(
            select(Application)
            .where(Application.internship_id == locked.id)
            .order_by(Application.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    )
    counts: dict[str, int] = {}
    for application in applications:
        counts[application.status] = counts.get(application.status, 0) + 1
    upcoming_interviews = int(
        await db.scalar(
            select(func.count(Interview.id))
            .join(Application, Application.id == Interview.application_id)
            .where(
                Application.internship_id == locked.id,
                Interview.status == "SCHEDULED",
                Interview.scheduled_at > datetime.now(timezone.utc),
            )
        )
        or 0
    )
    company_name = await db.scalar(
        select(CompanyProfile.company_name).where(CompanyProfile.user_id == locked.company_id)
    )
    if not company_name:
        company_name = await db.scalar(select(User.email).where(User.id == locked.company_id))
    company_name = company_name or f"Company {locked.company_id}"
    display_title = locked.title.replace("_", " ").replace("-", " ").title()
    now = datetime.now(timezone.utc)
    locked.status = "CLOSED"
    locked.closed_at = now

    notification_rows: list[Notification] = []
    websocket_notifications: list[dict[str, Any]] = []
    closure_events: list[ApplicationEvent] = []
    email_messages: list[dict[str, Any]] = []
    settings = get_settings()
    smtp_configured = bool(settings.mail_server and settings.mail_username and settings.mail_password)
    send_close_email = settings.notify_email_on_role_close and smtp_configured
    applicant_emails: dict[int, str] = {}
    if send_close_email:
        applicant_ids = {
            application.student_id
            for application in applications
            if application.status in CLOSE_NOTIFICATION_STATUSES
        }
        if applicant_ids:
            rows = await db.execute(
                select(User.id, User.email).where(User.id.in_(applicant_ids))
            )
            applicant_emails = {user_id: email for user_id, email in rows.all()}

    for application in applications:
        status_before_close = application.status
        if status_before_close not in FINAL_INACTIVE_STATUSES:
            closure_events.append(
                ApplicationEvent(
                    application_id=application.id,
                    event_type="INTERNSHIP_CLOSED",
                    actor_id=actor.id,
                    created_at=now,
                )
            )

        if reject_pending and status_before_close in REJECTABLE_STATUSES:
            await transition_application(
                db,
                application,
                "REJECTED",
                actor.id,
                note=note,
            )
            notification_type = "APPLICATION_STATUS"
            notification_title = "Application update"
            body = (
                f"After a careful review, {company_name} has decided to move forward with other "
                f"candidates for {display_title}."
            )
            clean_note = SIX_DIGIT_CODE.sub("[redacted]", (note or "").strip())
            if clean_note:
                body = f"{body} Note from {company_name}: {clean_note}"
            should_email_closure = False
        elif status_before_close in CLOSE_NOTIFICATION_STATUSES:
            notification_type = "INTERNSHIP_CLOSED"
            notification_title = "Internship closed"
            body = _close_notification_body(
                display_title,
                company_name,
                status_before_close,
                closed_by_platform=is_admin,
            )
            should_email_closure = send_close_email
        else:
            continue

        notification_rows.append(
            Notification(
                user_id=application.student_id,
                application_id=application.id,
                notification_type=notification_type,
                title=notification_title,
                body=body,
                created_at=now,
            )
        )
        websocket_notifications.append(
            {
                "user_id": application.student_id,
                "application_id": application.id,
                "internship_id": locked.id,
                "status": application.status,
                "title": notification_title,
                "body": body,
                "type": "application_status_updated" if notification_type == "APPLICATION_STATUS" else "internship_closed",
            }
        )
        if should_email_closure:
            email = applicant_emails.get(application.student_id)
            email_domain = (email or "").strip().lower().rpartition("@")[2]
            if email and email_domain not in FAKE_EMAIL_DOMAINS:
                email_messages.append(
                    {
                        "to": email,
                        "subject": notification_title,
                        "body": body,
                        "application_id": application.id,
                    }
                )

    if notification_rows:
        db.add_all(notification_rows)
    if closure_events:
        db.add_all(closure_events)

    audit_metadata = {
        "counts_per_status": counts,
        "reject_pending": reject_pending,
        "upcoming_interviews": upcoming_interviews,
    }
    db.add(
        AuditLog(
            actor_id=actor.id,
            actor_email=actor.email,
            action="INTERNSHIP_CLOSED",
            target_type="internship",
            target_id=locked.id,
            metadata_=audit_metadata,
        )
    )
    if is_admin:
        db.add(
            AuditLog(
                actor_id=actor.id,
                actor_email=actor.email,
                action="posting_removed",
                target_type="posting",
                target_id=locked.id,
                metadata_={"title": locked.title, "company_id": locked.company_id},
            )
        )
        db.add(
            Notification(
                user_id=locked.company_id,
                notification_type="INTERNSHIP_REVIEW",
                title="Internship closed",
                body=f'Your internship "{display_title}" was closed by the platform.'
                + (f" Reason: {note.strip()}" if note and note.strip() else ""),
                created_at=now,
            )
        )

    await db.commit()

    try:
        from app.api.v1.ws import manager

        await asyncio.gather(
            *(
                manager.send_personal_message(item["user_id"], item)
                for item in websocket_notifications
            )
        )
    except Exception:
        logger.exception("Unable to broadcast internship closure notifications for internship %s", locked.id)

    return InternshipCloseResult(
        internship=locked,
        counts=counts,
        upcoming_interviews=upcoming_interviews,
        notifications=websocket_notifications,
        emails=email_messages,
    )


async def send_closure_emails(messages: list[dict[str, Any]], db: AsyncSession) -> None:
    for message in messages:
        await send_dev_email(
            to=message["to"],
            subject=message["subject"],
            body=message["body"],
            message_type="INTERNSHIP_CLOSED",
            application_id=message["application_id"],
            db=db,
        )
