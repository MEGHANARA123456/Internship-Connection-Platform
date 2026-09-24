"""Audit log write helper.

Call ``write_audit`` inside any admin mutation *before* the session commit so
the audit row is persisted atomically with the mutation itself.
"""
from __future__ import annotations

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AuditLog, User


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
