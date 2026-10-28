"""Bounded read-only data tools with per-role ownership checks."""

import asyncio
import re
from dataclasses import dataclass
from datetime import date, datetime, timezone
from typing import Any

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Application,
    ApplicationStatusEvent,
    AuditLog,
    CompanyProfile,
    Interview,
    Internship,
    Notification,
    Resume,
    SavedInternship,
    StudentProfile,
    User,
    UserRole,
)
from app.services.audit import get_recent_admin_audit_events
from app.services.audit import audit_action_label

TOOL_ROLES = {
    "student_applications": UserRole.STUDENT,
    "student_interviews": UserRole.STUDENT,
    "student_notifications": UserRole.STUDENT,
    "student_profile_completeness": UserRole.STUDENT,
    "student_saved_internships": UserRole.STUDENT,
    "student_recommended_internships": UserRole.STUDENT,
    "company_applicants": UserRole.COMPANY,
    "company_shortlisted": UserRole.COMPANY,
    "company_pipeline": UserRole.COMPANY,
    "company_internships": UserRole.COMPANY,
    "company_interviews": UserRole.COMPANY,
    "admin_audit_events": UserRole.ADMIN,
    "admin_pending_approvals": UserRole.ADMIN,
    "admin_verification_counts": UserRole.ADMIN,
    "admin_analytics": UserRole.ADMIN,
}
TOOL_TIMEOUT_SECONDS = 4
MAX_ROWS = 10


@dataclass(frozen=True)
class ToolResult:
    name: str
    answer: str
    route: str
    links: tuple[tuple[str, str], ...] = ()


def _validated_args(name: str, args: dict[str, Any]) -> int | None:
    if set(args) - {"internship_id"}:
        raise HTTPException(status_code=422, detail="Unsupported tool arguments.")
    if name not in {"company_applicants", "company_shortlisted", "company_internships"}:
        if args:
            raise HTTPException(status_code=422, detail="This tool does not accept arguments.")
        return None
    value = args.get("internship_id")
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= 2_147_483_647:
        raise HTTPException(status_code=422, detail="Invalid internship identifier.")
    return value


def _when(value) -> str:
    if value is None:
        return "date not recorded"
    if isinstance(value, date) and not isinstance(value, datetime):
        return value.strftime("%b %d, %Y")
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).strftime("%b %d, %Y")


async def _student_applications(db: AsyncSession, user: User) -> ToolResult:
    rows = (await db.execute(
        select(Application, Internship.title, CompanyProfile.company_name)
        .join(Internship, Internship.id == Application.internship_id)
        .outerjoin(CompanyProfile, CompanyProfile.user_id == Internship.company_id)
        .where(Application.student_id == user.id)
        .order_by(Application.updated_at.desc(), Application.id.desc())
        .limit(MAX_ROWS)
    )).all()
    if not rows:
        answer = "You have no application records yet."
    else:
        items = []
        for application, title, company in rows:
            latest_status_change = await db.scalar(
                select(ApplicationStatusEvent.changed_at)
                .where(ApplicationStatusEvent.application_id == application.id)
                .order_by(ApplicationStatusEvent.changed_at.desc(), ApplicationStatusEvent.id.desc())
                .limit(1)
            )
            upcoming_interview = await db.scalar(
                select(Interview.scheduled_at)
                .where(
                    Interview.application_id == application.id,
                    Interview.status == "SCHEDULED",
                    Interview.scheduled_at >= datetime.now(timezone.utc),
                )
                .order_by(Interview.scheduled_at.asc())
                .limit(1)
            )
            details = (
                f"{title} at {company or 'company name unavailable'}: "
                f"{application.status.replace('_', ' ').title()}, applied {_when(application.created_at)}, "
                f"last status change {_when(latest_status_change or application.updated_at)}"
            )
            if upcoming_interview:
                details += f", upcoming interview {_when(upcoming_interview)}"
            items.append(details + ".")
        answer = "Your most recent applications: " + " ".join(items)
    return ToolResult("student_applications", answer, "/applications")


async def _student_interviews(db: AsyncSession, user: User) -> ToolResult:
    rows = (await db.execute(
        select(Interview, Internship.title)
        .join(Application, Application.id == Interview.application_id)
        .join(Internship, Internship.id == Application.internship_id)
        .where(
            Application.student_id == user.id,
            Interview.status == "SCHEDULED",
            Interview.scheduled_at >= datetime.now(timezone.utc),
        )
        .order_by(Interview.scheduled_at.asc(), Interview.id.asc())
        .limit(MAX_ROWS)
    )).all()
    answer = (
        "You have no interview records."
        if not rows
        else "Your recent interviews: " + " ".join(
            f"{title}: {interview.status.replace('_', ' ').title()} for "
            f"{_when(interview.scheduled_at)}."
            for interview, title in rows
        )
    )
    return ToolResult("student_interviews", answer, "/interviews")


async def _student_notifications(db: AsyncSession, user: User) -> ToolResult:
    rows = list((await db.scalars(
        select(Notification)
        .where(Notification.user_id == user.id)
        .order_by(Notification.created_at.desc(), Notification.id.desc())
        .limit(MAX_ROWS)
    )).all())
    answer = (
        "You have no notifications."
        if not rows
        else "Your recent notifications: " + " ".join(
            f"{item.title} ({'read' if item.read_at else 'unread'}, {_when(item.created_at)})."
            for item in rows
        )
    )
    return ToolResult("student_notifications", answer, "/notifications")


async def _student_profile(db: AsyncSession, user: User) -> ToolResult:
    profile = await db.scalar(select(StudentProfile).where(StudentProfile.user_id == user.id))
    resume = await db.scalar(select(Resume.id).where(Resume.student_id == user.id))
    if profile is None:
        return ToolResult(
            "student_profile_completeness",
            "Your student profile has not been created yet. Open your profile to complete it.",
            "/profile/student",
        )
    missing = [
        label for value, label in (
            (profile.full_name, "name"),
            (profile.university, "university"),
            (profile.major, "major"),
            (profile.graduation_year, "graduation year"),
            (profile.skills, "skills"),
        ) if not value
    ]
    if not resume:
        missing.append("resume")
    answer = (
        "Your profile has no missing core fields."
        if not missing
        else "Your profile is missing: " + ", ".join(missing) + "."
    )
    return ToolResult("student_profile_completeness", answer, "/profile/student")


async def _student_saved_internships(db: AsyncSession, user: User) -> ToolResult:
    rows = (await db.execute(
        select(Internship.title, Internship.id, CompanyProfile.company_name)
        .join(SavedInternship, SavedInternship.internship_id == Internship.id)
        .outerjoin(CompanyProfile, CompanyProfile.user_id == Internship.company_id)
        .where(
            SavedInternship.student_id == user.id,
        )
        .order_by(SavedInternship.created_at.desc(), SavedInternship.id.desc())
        .limit(MAX_ROWS)
    )).all()
    answer = (
        "You have no saved internships."
        if not rows
        else "Your saved internships: " + " ".join(
            f"{title} at {company or 'company name unavailable'}."
            for title, _, company in rows
        )
    )
    links = tuple((title, f"/opportunities/{internship_id}") for title, internship_id, _ in rows)
    return ToolResult("student_saved_internships", answer, "/saved", links)


async def _student_recommended_internships(db: AsyncSession, user: User) -> ToolResult:
    from app.services.ai import compute_match

    profile = await db.scalar(select(StudentProfile).where(StudentProfile.user_id == user.id))
    if profile is None or not profile.skills.strip():
        return ToolResult(
            "student_recommended_internships",
            "I could not find profile skills to match yet. Add skills to your profile and try again.",
            "/profile/student",
        )

    rows = (await db.execute(
        select(Internship, CompanyProfile.company_name)
        .outerjoin(CompanyProfile, CompanyProfile.user_id == Internship.company_id)
        .where(
            Internship.status == "PUBLISHED",
            Internship.deadline >= date.today(),
        )
        .order_by(Internship.created_at.desc(), Internship.id.desc())
        .limit(100)
    )).all()
    skills = [item.strip() for item in re.split(r"[,;\n]", profile.skills) if item.strip()]
    matches = []
    for internship, company_name in rows:
        match = compute_match(
            skills,
            "",
            internship.title,
            internship.description,
            [item.strip() for item in re.split(r"[,;\n]", internship.skills or "") if item.strip()],
        )
        if match["score"] is not None:
            matches.append((match["score"], internship, company_name, match["matched"]))
    matches.sort(key=lambda item: (-item[0], item[1].id))
    matches = matches[:5]
    answer = (
        "No open internships matched your profile skills."
        if not matches
        else "Top open internships matching your profile: " + " ".join(
            f"{internship.title} at {company_name or 'company name unavailable'} "
            f"({score}% match; skills: {', '.join(matched) if matched else 'no direct skill overlap'})."
            for score, internship, company_name, matched in matches
        )
    )
    links = tuple(
        (internship.title, f"/opportunities/{internship.id}")
        for _, internship, _, _ in matches
    )
    return ToolResult("student_recommended_internships", answer, "/opportunities", links)


async def _company_internships(db: AsyncSession, user: User, internship_id: int | None) -> ToolResult:
    query = (
        select(Internship.title, Internship.status, Internship.deadline, func.count(Application.id))
        .outerjoin(Application, Application.internship_id == Internship.id)
        .where(Internship.company_id == user.id)
        .group_by(Internship.id)
        .order_by(Internship.created_at.desc())
        .limit(MAX_ROWS)
    )
    if internship_id is not None:
        query = query.where(Internship.id == internship_id)
    rows = (await db.execute(query)).all()
    answer = (
        "No matching internship postings were found in your company account."
        if not rows
        else "Your internship postings: " + " ".join(
            f"{title}: {status.replace('_', ' ').title()}, {int(count)} applications, "
            f"deadline {_when(deadline)}."
            for title, status, deadline, count in rows
        )
    )
    return ToolResult("company_internships", answer, "/company/jobs")


async def _company_applicants(
    db: AsyncSession,
    user: User,
    internship_id: int | None,
    shortlisted: bool = False,
) -> ToolResult:
    query = (
        select(
            StudentProfile.full_name,
            StudentProfile.skills,
            Internship.title,
            Internship.description,
            Internship.skills,
            Application.status,
            Application.created_at,
        )
        .join(Internship, Internship.id == Application.internship_id)
        .outerjoin(StudentProfile, StudentProfile.user_id == Application.student_id)
        .where(Internship.company_id == user.id)
        .order_by(Application.created_at.desc(), Application.id.desc())
        .limit(MAX_ROWS)
    )
    if internship_id is not None:
        query = query.where(Internship.id == internship_id)
    if shortlisted:
        query = query.where(Application.status == "SHORTLISTED")
    rows = (await db.execute(query)).all()
    heading = "Shortlisted candidates" if shortlisted else "Applicants"
    answer = (
        f"No {heading.lower()} were found in your company's postings."
        if not rows
        else heading + ": " + " ".join(
            _company_applicant_summary(row)
            for row in rows
        )
    )
    return ToolResult(
        "company_shortlisted" if shortlisted else "company_applicants",
        answer,
        "/company/shortlisted" if shortlisted else "/company/applicants",
    )


def _company_applicant_summary(row: Any) -> str:
    from app.services.ai import compute_match

    name, student_skills, title, description, job_skills, status, created_at = row
    first_name = (name or "Candidate").split()[0]
    match = compute_match(
        [item.strip() for item in re.split(r"[,;\n]", student_skills or "") if item.strip()],
        "",
        title,
        description,
        [item.strip() for item in re.split(r"[,;\n]", job_skills or "") if item.strip()],
    )
    match_text = f"{match['score']}% match" if match["score"] is not None else "match not available"
    return (
        f"{first_name} applied to {title} and is {status.replace('_', ' ').lower()} "
        f"({match_text}; applied {_when(created_at)})."
    )


async def _company_pipeline(db: AsyncSession, user: User) -> ToolResult:
    rows = (await db.execute(
        select(Application.status, func.count(Application.id))
        .join(Internship, Internship.id == Application.internship_id)
        .where(Internship.company_id == user.id)
        .group_by(Application.status)
        .order_by(Application.status)
    )).all()
    answer = (
        "Your hiring pipeline has no applications."
        if not rows
        else "Your hiring pipeline: " + ", ".join(
            f"{str(status).replace('_', ' ').title()}: {int(count)}"
            for status, count in rows
        ) + "."
    )
    return ToolResult("company_pipeline", answer, "/company/pipeline")


async def _company_interviews(db: AsyncSession, user: User) -> ToolResult:
    rows = (await db.execute(
        select(Internship.title, Interview.status, Interview.scheduled_at)
        .join(Application, Application.id == Interview.application_id)
        .join(Internship, Internship.id == Application.internship_id)
        .where(
            Internship.company_id == user.id,
            Interview.status == "SCHEDULED",
            Interview.scheduled_at >= datetime.now(timezone.utc),
        )
        .order_by(Interview.scheduled_at.asc())
        .limit(MAX_ROWS)
    )).all()
    answer = (
        "Your company has no interview records."
        if not rows
        else "Your recent interviews: " + " ".join(
            f"{title}: {status.replace('_', ' ').title()} for {_when(scheduled_at)}."
            for title, status, scheduled_at in rows
        )
    )
    return ToolResult("company_interviews", answer, "/interviews")


async def _admin_audit(db: AsyncSession, user: User) -> ToolResult:
    events = await get_recent_admin_audit_events(db, user, limit=5)
    if not events:
        answer = "There are no recent audit events to summarize."
    else:
        lines = []
        for event in events:
            actor = f"Admin #{event.actor_id}" if event.actor_id else "System"
            action = audit_action_label(event.action).lower()
            target = (
                f"{event.target_type or 'platform item'} #{event.target_id}"
                if event.target_id is not None
                else "platform settings"
            )
            lines.append(f"{actor} recorded {action} for {target} on {_when(event.created_at)}.")
        answer = "Recent audit events: " + " ".join(lines)
    return ToolResult("admin_audit_events", answer, "/admin/audit-logs")


async def _admin_pending(db: AsyncSession) -> ToolResult:
    count = int(await db.scalar(
        select(func.count(Internship.id)).where(Internship.status == "PENDING_APPROVAL")
    ) or 0)
    return ToolResult(
        "admin_pending_approvals",
        f"There are {count} postings pending approval.",
        "/admin/moderation",
    )


async def _admin_verification_counts(db: AsyncSession) -> ToolResult:
    rows = (await db.execute(
        select(CompanyProfile.verification_status, func.count(CompanyProfile.id))
        .group_by(CompanyProfile.verification_status)
        .order_by(CompanyProfile.verification_status)
    )).all()
    counts = {str(status).lower(): int(count) for status, count in rows}
    return ToolResult(
        "admin_verification_counts",
        "Company verification counts: " + ", ".join(
            f"{status.title()}: {counts.get(status, 0)}"
            for status in ("pending", "verified", "rejected")
        ) + ".",
        "/admin/verifications",
    )


async def _admin_analytics(db: AsyncSession) -> ToolResult:
    users = (await db.execute(
        select(User.role, func.count(User.id)).group_by(User.role)
    )).all()
    role_counts = {role.value: int(count) for role, count in users}
    internship_count = int(await db.scalar(select(func.count(Internship.id)) ) or 0)
    audit_count = int(await db.scalar(select(func.count(AuditLog.id))) or 0)
    answer = (
        "Platform counts: "
        f"{role_counts.get('STUDENT', 0)} students, "
        f"{role_counts.get('COMPANY', 0)} company accounts, "
        f"{role_counts.get('ADMIN', 0)} administrators, "
        f"{internship_count} internships, and {audit_count} audit records."
    )
    return ToolResult("admin_analytics", answer, "/admin")


async def execute_read_tool(
    name: str,
    args: dict[str, Any],
    user: User | None,
    db: AsyncSession,
) -> ToolResult:
    expected_role = TOOL_ROLES.get(name)
    if expected_role is None:
        raise HTTPException(status_code=400, detail="Unsupported chatbot tool.")
    if user is None:
        raise HTTPException(status_code=401, detail="Sign in to view your account data.")
    if user.role != expected_role:
        raise HTTPException(status_code=403, detail="This live-data request is not available for your role.")
    internship_id = _validated_args(name, args)
    actions = {
        "student_applications": lambda: _student_applications(db, user),
        "student_interviews": lambda: _student_interviews(db, user),
        "student_notifications": lambda: _student_notifications(db, user),
        "student_profile_completeness": lambda: _student_profile(db, user),
        "student_saved_internships": lambda: _student_saved_internships(db, user),
        "student_recommended_internships": lambda: _student_recommended_internships(db, user),
        "company_applicants": lambda: _company_applicants(db, user, internship_id),
        "company_shortlisted": lambda: _company_applicants(db, user, internship_id, True),
        "company_pipeline": lambda: _company_pipeline(db, user),
        "company_internships": lambda: _company_internships(db, user, internship_id),
        "company_interviews": lambda: _company_interviews(db, user),
        "admin_audit_events": lambda: _admin_audit(db, user),
        "admin_pending_approvals": lambda: _admin_pending(db),
        "admin_verification_counts": lambda: _admin_verification_counts(db),
        "admin_analytics": lambda: _admin_analytics(db),
    }
    return await asyncio.wait_for(actions[name](), timeout=TOOL_TIMEOUT_SECONDS)
