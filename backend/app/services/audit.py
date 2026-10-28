# -----------------------------------------------------------------------------
# Audit logging service for important changes and user activity tracking.
# -----------------------------------------------------------------------------

"""Audit log write helper.

Call ``write_audit`` inside any admin mutation *before* the session commit so
the audit row is persisted atomically with the mutation itself.
"""
from __future__ import annotations
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models import AuditLog, User, UserRole

AUDIT_ACTION_LABELS = {
    "admin_created": "Administrators created",
    "admin_user_deleted": "Admin user deleted",
    "company_rejected": "Companies rejected",
    "company_verified": "Companies verified",
    "gdpr_data_export": "GDPR data exports",
    "gdpr_right_to_erasure_executed": "GDPR erasures",
    "internship_closed": "Internships closed",
    "posting_approved": "Postings approved",
    "posting_removed": "Postings removed",
    "posting_rejected": "Postings rejected",
    "report_resolved": "Reports resolved",
    "report_status_updated": "Report status updated",
    "skill_learning_resource_created": "Learning resources created",
    "skill_learning_resource_deleted": "Learning resources deleted",
    "skill_learning_resource_updated": "Learning resources updated",
    "skill_question_created": "Assessment questions created",
    "skill_question_deleted": "Assessment questions deleted",
    "skill_question_updated": "Assessment questions updated",
    "skill_questions_imported": "Assessment questions imported",
    "user_reinstated": "Users unblocked",
    "user_suspended": "Users blocked",
}


def audit_action_label(action: str) -> str:
    normalized = action.strip().lower().replace(" ", "_")
    if normalized in AUDIT_ACTION_LABELS:
        return AUDIT_ACTION_LABELS[normalized]
    return normalized.replace("_", " ").title() if normalized else "Other admin action"


@dataclass(frozen=True)
class AuditEventSummary:
    action: str
    actor_id: int | None
    actor_role: str | None
    target_type: str | None
    target_id: int | None
    created_at: datetime


async def get_recent_admin_audit_events(
    db: AsyncSession,
    actor: User,
    limit: int = 5,
) -> list[AuditEventSummary]:
    if actor.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    rows = (await db.execute(
        select(AuditLog, User.role)
        .outerjoin(User, AuditLog.actor_id == User.id)
        .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
        .limit(max(1, min(limit, 10)))
    )).all()
    return [
        AuditEventSummary(
            action=audit_log.action,
            actor_id=audit_log.actor_id,
            actor_role=actor_role.value if actor_role is not None else None,
            target_type=audit_log.target_type,
            target_id=audit_log.target_id,
            created_at=audit_log.created_at,
        )
        for audit_log, actor_role in rows
    ]


async def write_audit(
    db: AsyncSession,
    actor: User | None,
    action: str,
    target_type: str | None = None,
    target_id: int | None = None,
    metadata: dict[str, Any] | None = None,
    ip_address: str | None = None,
) -> AuditLog:
    """Create an AuditLog row and add it to *db* without committing.

    The caller is responsible for committing the session so the audit entry
    and the triggering mutation share the same transaction.

    Args:
        db: The active async SQLAlchemy session.
        actor: The admin ``User`` performing the action, or ``None`` for
            system-initiated events.
        action: A short snake_case label, e.g. ``"user_suspended"``.
        target_type: One of ``"user"``, ``"company"``, ``"posting"``,
            ``"application"``, or ``None`` for global actions.
        target_id: Primary key of the affected row, or ``None``.
        metadata: Optional dict of contextual data (e.g. before/after values,
            rejection reason).
        ip_address: IPv4 or IPv6 string from ``request.client.host``, or
            ``None`` when the request object is unavailable.

    Returns:
        The newly created (but not yet committed) :class:`AuditLog` instance.
    """
    entry = AuditLog(
        actor_id=actor.id if actor else None,
        actor_email=actor.email if actor else None,
        action=action,
        target_type=target_type,
        target_id=target_id,
        metadata_=metadata,
        ip_address=ip_address,
    )
    db.add(entry)
    return entry
