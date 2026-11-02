"""Canonical all-time metrics for a company's internships and applicants."""

from datetime import date, datetime, timedelta, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Application, Interview, Internship

WITHDRAWN_STATUS = "WITHDRAWN"
OFFER_STATUSES = ("SELECTED", "ACCEPTED")
SCHEDULED_INTERVIEW_STATUSES = ("SCHEDULED", "RESCHEDULED")


async def get_company_metrics(
    db: AsyncSession,
    company_id: int,
    internship_id: int | None = None,
) -> dict[str, Any]:
    """Return all-time company counts and per-role current-status counts."""
    role_query = select(Internship.id, Internship.title, Internship.status, Internship.deadline).where(
        Internship.company_id == company_id
    )
    if internship_id is not None:
        role_query = role_query.where(Internship.id == internship_id)
    roles = (await db.execute(role_query.order_by(Internship.id))).all()
    role_ids = [role.id for role in roles]
    today = date.today()
    role_count = len(roles)
    active_roles = sum(
        role.status == "PUBLISHED" and role.deadline >= today
        for role in roles
    )

    status_counts: dict[str, int] = {}
    if role_ids:
        status_rows = (await db.execute(
            select(Application.status, func.count(Application.id))
            .where(Application.internship_id.in_(role_ids))
            .group_by(Application.status)
        )).all()
        status_counts = {str(status): int(count) for status, count in status_rows}

    visible_status_counts = {
        status: count
        for status, count in status_counts.items()
        if status != WITHDRAWN_STATUS
    }
    total_applicants = sum(visible_status_counts.values())
    withdrawn_count = status_counts.get(WITHDRAWN_STATUS, 0)
    shortlisted = visible_status_counts.get("SHORTLISTED", 0)
    offers = sum(visible_status_counts.get(status, 0) for status in OFFER_STATUSES)

    now = datetime.now(timezone.utc)
    interviews_scheduled = 0
    if role_ids:
        interviews_scheduled = int(await db.scalar(
            select(func.count(Interview.id))
            .join(Application, Interview.application_id == Application.id)
            .where(
                Application.internship_id.in_(role_ids),
                Interview.status.in_(SCHEDULED_INTERVIEW_STATUSES),
                Interview.scheduled_at > now,
            )
        ) or 0)
    new_applications_this_week = 0
    if role_ids:
        new_applications_this_week = int(await db.scalar(
            select(func.count(Application.id))
            .where(
                Application.internship_id.in_(role_ids),
                Application.status != WITHDRAWN_STATUS,
                Application.created_at >= now - timedelta(days=7),
            )
        ) or 0)

    per_role_status: dict[int, dict[str, int]] = {}
    if role_ids:
        rows = (await db.execute(
            select(Application.internship_id, Application.status, func.count(Application.id))
            .where(Application.internship_id.in_(role_ids))
            .group_by(Application.internship_id, Application.status)
        )).all()
        for role_id, status, count in rows:
            if status != WITHDRAWN_STATUS:
                per_role_status.setdefault(int(role_id), {})[str(status)] = int(count)

    per_role: list[dict[str, Any]] = []
    for role in roles:
        counts = per_role_status.get(int(role.id), {})
        per_role.append({
            "id": int(role.id),
            "title": role.title,
            "status": role.status,
            "applications": sum(counts.values()),
            "status_counts": counts,
        })

    return {
        "total_roles": role_count,
        "active_roles": int(active_roles),
        "total_applicants": total_applicants,
        "withdrawn_count": withdrawn_count,
        "shortlisted": shortlisted,
        "offers": offers,
        "interviews_scheduled": interviews_scheduled,
        "new_applications_this_week": new_applications_this_week,
        "status_counts": visible_status_counts,
        "all_status_counts": status_counts,
        "applications_by_role": per_role,
    }


def company_metric_cards(metrics: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Serialize canonical company metrics for dashboard KPI cards."""
    total = int(metrics["total_applicants"])
    withdrawn = int(metrics["withdrawn_count"])
    return {
        "total_roles": {
            "value": int(metrics["total_roles"]),
            "sample_size": int(metrics["total_roles"]),
            "definition": "All internships owned by this company, regardless of posting status.",
        },
        "active_roles": {
            "value": int(metrics["active_roles"]),
            "sample_size": int(metrics["total_roles"]),
            "definition": "Published internships with a deadline on or after today.",
        },
        "total_applicants": {
            "value": total,
            "sample_size": total,
            "definition": f"All applications to this company's internships except WITHDRAWN; {withdrawn} withdrawn application(s) excluded.",
        },
        "shortlisted": {
            "value": int(metrics["shortlisted"]),
            "sample_size": total,
            "definition": "Applications whose current status is SHORTLISTED.",
        },
        "interviews_scheduled": {
            "value": int(metrics["interviews_scheduled"]),
            "sample_size": int(metrics["interviews_scheduled"]),
            "definition": "Future interviews with SCHEDULED or RESCHEDULED status.",
        },
        "offers": {
            "value": int(metrics["offers"]),
            "sample_size": total,
            "definition": "Applications whose current status is SELECTED or ACCEPTED.",
        },
        "new_applications_this_week": {
            "value": int(metrics["new_applications_this_week"]),
            "sample_size": int(metrics["new_applications_this_week"]),
            "definition": "Non-withdrawn applications submitted in the last seven days.",
        },
    }
