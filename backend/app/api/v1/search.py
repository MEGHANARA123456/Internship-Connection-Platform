"""Role-scoped global search for authenticated platform users."""

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy import String, cast, or_, select

from app.api.v1.dependencies import DbSession, get_current_user
from app.models import (
    Application,
    AuditLog,
    CompanyProfile,
    Conversation,
    Interview,
    Internship,
    Report,
    SavedInternship,
    StudentProfile,
    User,
    UserRole,
)

router = APIRouter(tags=["search"])


def _contains(value: str) -> str:
    escaped = value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def _item(item_id: int, title: str, subtitle: str, badge: str, url: str) -> dict[str, Any]:
    return {"id": item_id, "title": title, "subtitle": subtitle, "badge": badge, "url": url}


def _group(group_type: str, label: str, items: list[dict[str, Any]]) -> dict[str, Any] | None:
    return {"type": group_type, "label": label, "items": items} if items else None


@router.get("/search")
async def global_search(
    db: DbSession,
    user: Annotated[User, Depends(get_current_user)],
    q: str = Query(""),
    limit: int = Query(5, ge=1, le=20),
) -> dict[str, list[dict[str, Any]]]:
    """Search only records visible to the authenticated user's role."""
    if len(q.strip()) < 2:
        return {"groups": []}
    pattern = _contains(q.strip())
    groups: list[dict[str, Any]] = []

    if user.role == UserRole.STUDENT:
        roles = (await db.execute(
            select(Internship.id, Internship.title, CompanyProfile.company_name, Internship.skills)
            .join(CompanyProfile, CompanyProfile.user_id == Internship.company_id)
            .where(
                Internship.status == "PUBLISHED",
                CompanyProfile.verification_status == "VERIFIED",
                or_(
                    Internship.title.ilike(pattern, escape="\\"),
                    CompanyProfile.company_name.ilike(pattern, escape="\\"),
                    Internship.skills.ilike(pattern, escape="\\"),
                ),
            )
            .order_by(Internship.created_at.desc())
            .limit(limit)
        )).all()
        groups.append(_group("internships", "Internships", [
            _item(row.id, row.title, f"{row.company_name} · {row.skills or 'Skills not listed'}", "Internship", f"/opportunities/{row.id}")
            for row in roles
        ]))

        applications = (await db.execute(
            select(Application.id, Internship.title, Application.status)
            .join(Internship, Internship.id == Application.internship_id)
            .where(
                Application.student_id == user.id,
                or_(Internship.title.ilike(pattern, escape="\\"), Application.status.ilike(pattern, escape="\\")),
            )
            .order_by(Application.created_at.desc())
            .limit(limit)
        )).all()
        groups.append(_group("applications", "Applications", [
            _item(row.id, row.title, f"Application · {row.status.replace('_', ' ').title()}", row.status, f"/applications/{row.id}")
            for row in applications
        ]))

        saved = (await db.execute(
            select(SavedInternship.id, Internship.id.label("internship_id"), Internship.title, CompanyProfile.company_name)
            .join(Internship, Internship.id == SavedInternship.internship_id)
            .join(CompanyProfile, CompanyProfile.user_id == Internship.company_id)
            .where(
                SavedInternship.student_id == user.id,
                or_(Internship.title.ilike(pattern, escape="\\"), CompanyProfile.company_name.ilike(pattern, escape="\\")),
            )
            .order_by(SavedInternship.created_at.desc())
            .limit(limit)
        )).all()
        groups.append(_group("saved_roles", "Saved roles", [
            _item(row.id, row.title, row.company_name, "Saved", "/saved")
            for row in saved
        ]))

        interviews = (await db.execute(
            select(Interview.id, Internship.title, Interview.status, Interview.scheduled_at)
            .join(Application, Application.id == Interview.application_id)
            .join(Internship, Internship.id == Application.internship_id)
            .where(
                Application.student_id == user.id,
                or_(Internship.title.ilike(pattern, escape="\\"), Interview.status.ilike(pattern, escape="\\")),
            )
            .order_by(Interview.scheduled_at.desc())
            .limit(limit)
        )).all()
        groups.append(_group("interviews", "Interviews", [
            _item(row.id, row.title, f"{row.status.title()} · {row.scheduled_at:%b %d, %Y}", "Interview", f"/interviews?tab=upcoming&highlight={row.id}")
            for row in interviews
        ]))

    elif user.role == UserRole.COMPANY:
        roles = (await db.execute(
            select(Internship.id, Internship.title, Internship.status)
            .where(
                Internship.company_id == user.id,
                or_(Internship.title.ilike(pattern, escape="\\"), Internship.status.ilike(pattern, escape="\\")),
            )
            .order_by(Internship.created_at.desc())
            .limit(limit)
        )).all()
        groups.append(_group("internships", "My roles", [
            _item(row.id, row.title, row.status.replace("_", " ").title(), "Role", f"/company/internships/{row.id}/edit")
            for row in roles
        ]))

        applicants = (await db.execute(
            select(Application.id, StudentProfile.full_name, Internship.id.label("internship_id"), Internship.title)
            .join(Internship, Internship.id == Application.internship_id)
            .join(StudentProfile, StudentProfile.user_id == Application.student_id)
            .where(
                Internship.company_id == user.id,
                StudentProfile.full_name.ilike(pattern, escape="\\"),
            )
            .order_by(Application.created_at.desc())
            .limit(limit)
        )).all()
        groups.append(_group("applicants", "Applicants", [
            _item(row.id, row.full_name, row.title, "Applicant", f"/company/jobs/{row.internship_id}/applicants")
            for row in applicants
        ]))

        interviews = (await db.execute(
            select(Interview.id, StudentProfile.full_name, Internship.title, Interview.status, Interview.scheduled_at)
            .join(Application, Application.id == Interview.application_id)
            .join(Internship, Internship.id == Application.internship_id)
            .join(StudentProfile, StudentProfile.user_id == Application.student_id)
            .where(
                Internship.company_id == user.id,
                or_(StudentProfile.full_name.ilike(pattern, escape="\\"), Internship.title.ilike(pattern, escape="\\")),
            )
            .order_by(Interview.scheduled_at.desc())
            .limit(limit)
        )).all()
        groups.append(_group("interviews", "Interviews", [
            _item(row.id, row.full_name, f"{row.title} · {row.status.title()}", "Interview", f"/interviews?tab=upcoming&highlight={row.id}")
            for row in interviews
        ]))

        contacts = (await db.execute(
            select(Conversation.id, StudentProfile.full_name)
            .join(StudentProfile, StudentProfile.user_id == Conversation.student_id)
            .where(Conversation.company_id == user.id, StudentProfile.full_name.ilike(pattern, escape="\\"))
            .order_by(Conversation.created_at.desc())
            .limit(limit)
        )).all()
        groups.append(_group("contacts", "Conversation contacts", [
            _item(row.id, row.full_name, "Conversation", "Contact", f"/messages?conversation={row.id}")
            for row in contacts
        ]))

    else:
        users = (await db.execute(
            select(User.id, User.email, User.role, StudentProfile.full_name, CompanyProfile.company_name)
            .outerjoin(StudentProfile, StudentProfile.user_id == User.id)
            .outerjoin(CompanyProfile, CompanyProfile.user_id == User.id)
            .where(or_(
                User.email.ilike(pattern, escape="\\"),
                cast(User.role, String).ilike(pattern, escape="\\"),
                StudentProfile.full_name.ilike(pattern, escape="\\"),
                CompanyProfile.company_name.ilike(pattern, escape="\\"),
            ))
            .order_by(User.id.desc())
            .limit(limit)
        )).all()
        groups.append(_group("users", "Users", [
            _item(row.id, row.full_name or row.company_name or row.email, f"{row.email} · {row.role.value}", "User", f"/admin/users")
            for row in users
        ]))

        companies = (await db.execute(
            select(CompanyProfile.user_id, CompanyProfile.company_name, CompanyProfile.verification_status)
            .where(or_(
                CompanyProfile.company_name.ilike(pattern, escape="\\"),
                CompanyProfile.verification_status.ilike(pattern, escape="\\"),
            ))
            .order_by(CompanyProfile.company_name)
            .limit(limit)
        )).all()
        groups.append(_group("companies", "Companies", [
            _item(row.user_id, row.company_name, f"Verification · {row.verification_status.title()}", row.verification_status, f"/admin/companies/{row.user_id}/postings")
            for row in companies
        ]))

        roles = (await db.execute(
            select(Internship.id, Internship.title, Internship.status, CompanyProfile.company_name)
            .outerjoin(CompanyProfile, CompanyProfile.user_id == Internship.company_id)
            .where(or_(
                Internship.title.ilike(pattern, escape="\\"),
                Internship.status.ilike(pattern, escape="\\"),
                CompanyProfile.company_name.ilike(pattern, escape="\\"),
            ))
            .order_by(Internship.created_at.desc())
            .limit(limit)
        )).all()
        groups.append(_group("internships", "Internships / postings", [
            _item(row.id, row.title, f"{row.company_name or 'Company'} · {row.status.replace('_', ' ').title()}", "Posting", "/admin/moderation")
            for row in roles
        ]))

        reports = (await db.execute(
            select(Report.id, Report.reason, Report.status)
            .where(or_(Report.reason.ilike(pattern, escape="\\"), Report.status.ilike(pattern, escape="\\")))
            .order_by(Report.created_at.desc())
            .limit(limit)
        )).all()
        groups.append(_group("reports", "Reports", [
            _item(row.id, f"Report #{row.id}", row.reason[:160], row.status, "/admin/reports")
            for row in reports
        ]))

        audit_logs = (await db.execute(
            select(AuditLog.id, AuditLog.action, AuditLog.actor_email)
            .where(or_(
                AuditLog.action.ilike(pattern, escape="\\"),
                AuditLog.actor_email.ilike(pattern, escape="\\"),
            ))
            .order_by(AuditLog.created_at.desc())
            .limit(limit)
        )).all()
        groups.append(_group("audit_logs", "Audit logs", [
            _item(row.id, row.action.replace("_", " ").title(), row.actor_email or "System", "Audit log", "/admin/audit-logs")
            for row in audit_logs
        ]))

    return {"groups": [group for group in groups if group is not None]}
