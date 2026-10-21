
# -----------------------------------------------------------------------------
# Main API router that registers all versioned endpoints for the backend.
# -----------------------------------------------------------------------------

from datetime import datetime, timedelta, timezone
from typing import Annotated, Any
from fastapi import APIRouter, Depends
from sqlalchemy import func, select

from app.api.v1.auth import router as auth_router
from app.api.v1.profiles import router as profiles_router
from app.api.v1.company_documents import router as company_documents_router
from app.api.v1.internships import router as internships_router
from app.api.v1.applications import router as applications_router
from app.api.v1.communication import router as communication_router
from app.api.v1.admin import router as admin_router
from app.api.v1.reports import router as reports_router
from app.api.v1.ai import router as ai_router
from app.api.v1.ws import router as ws_router
from app.api.v1.mailbox import router as mailbox_router
from app.api.v1.analytics import router as analytics_router
from app.api.v1.reviews import router as reviews_router
from app.api.v1.privacy import router as privacy_router
from app.api.v1.search import router as search_router
from app.api.v1.insights import router as insights_router
from app.api.v1.dependencies import DbSession, get_current_user, require_roles
from app.models import (
    Application,
    CompanyDocument,
    CompanyProfile,
    Interview,
    Internship,
    Notification,
    SavedInternship,
    StudentProfile,
    User,
    UserRole,
)

api_router = APIRouter()
api_router.include_router(auth_router)
api_router.include_router(profiles_router)
api_router.include_router(company_documents_router)
api_router.include_router(internships_router)
api_router.include_router(applications_router)
api_router.include_router(communication_router)
api_router.include_router(admin_router)
api_router.include_router(reports_router)
api_router.include_router(ai_router)
api_router.include_router(ws_router)
api_router.include_router(mailbox_router)
api_router.include_router(analytics_router)
api_router.include_router(reviews_router)
api_router.include_router(privacy_router)
api_router.include_router(search_router)
api_router.include_router(insights_router)



@api_router.get("/health", tags=["health"])
async def health_check() -> dict[str, str]:
    return {"status": "ok"}


@api_router.get("/navigation/counts", tags=["navigation"])
async def navigation_counts(
    user: Annotated[User, Depends(get_current_user)],
    db: DbSession,
) -> dict[str, int]:
    unread_notifications = await db.scalar(
        select(func.count(Notification.id)).where(
            Notification.user_id == user.id,
            Notification.read_at.is_(None),
        )
    )
    counts = {
        "unread_notifications": int(unread_notifications or 0),
        "invites_new": 0,
        "application_updates": 0,
        "saved": 0,
    }
    if user.role == UserRole.STUDENT:
        student_counts = await student_nav_counts(user, db)
        counts.update(student_counts)
    elif user.role == UserRole.COMPANY:
        now = datetime.now(timezone.utc)
        counts.update(
            {
                "new_applicants": int(
                    await db.scalar(
                        select(func.count(Application.id))
                        .join(Internship, Application.internship_id == Internship.id)
                        .where(
                            Internship.company_id == user.id,
                            Application.status == "APPLIED",
                            Application.created_at >= now - timedelta(days=7),
                        )
                    )
                    or 0
                ),
                "upcoming_interviews": int(
                    await db.scalar(
                        select(func.count(Interview.id))
                        .join(Application, Interview.application_id == Application.id)
                        .join(Internship, Application.internship_id == Internship.id)
                        .where(
                            Internship.company_id == user.id,
                            Interview.status.in_(("SCHEDULED", "RESCHEDULED")),
                            Interview.scheduled_at > now,
                        )
                    )
                    or 0
                ),
            }
        )
    return counts


@api_router.get("/student/me", tags=["student"])
async def student_me(user: Annotated[User, Depends(require_roles(UserRole.STUDENT))], db: DbSession) -> dict[str, Any]:
    student = await db.scalar(select(StudentProfile).where(StudentProfile.user_id == user.id))
    name = student.full_name if student else None
    if not name and user.email:
        local_part = user.email.split("@")[0]
        words = "".join(c if c.isalpha() else " " for c in local_part).split()
        name = " ".join(words).title() if words else local_part.title()
    return {"email": user.email, "role": user.role.value, "name": name, "user_id": user.id}


@api_router.get("/students/me/nav-counts", tags=["student"])
async def student_nav_counts(user: Annotated[User, Depends(require_roles(UserRole.STUDENT))], db: DbSession) -> dict[str, int]:
    invites_new = await db.scalar(
        select(func.count(Notification.id)).where(
            Notification.user_id == user.id,
            Notification.notification_type == "INTERVIEW_INVITE",
            Notification.read_at.is_(None),
        )
    )
    app_update_types = ["APPLICATION_STATUS", "APPLICATION_SUBMITTED", "APPLICATION_NEW"]
    application_updates = await db.scalar(
        select(func.count(Notification.id)).where(
            Notification.user_id == user.id,
            Notification.notification_type.in_(app_update_types),
            Notification.read_at.is_(None),
        )
    )
    saved = await db.scalar(select(func.count(SavedInternship.id)).where(SavedInternship.student_id == user.id))
    return {
        "invites_new": int(invites_new or 0),
        "application_updates": int(application_updates or 0),
        "saved": int(saved or 0),
    }


@api_router.get("/company/dashboard", tags=["company"])
async def company_dashboard(user: Annotated[User, Depends(require_roles(UserRole.COMPANY))], db: DbSession) -> dict[str, Any]:
    company = await db.scalar(select(CompanyProfile).where(CompanyProfile.user_id == user.id))
    name = company.company_name if company else None
    if not name and user.email:
        local_part = user.email.split("@")[0]
        words = "".join(c if c.isalpha() else " " for c in local_part).split()
        name = " ".join(words).title() if words else local_part.title()
    return {"email": user.email, "role": user.role.value, "name": name, "user_id": user.id}


@api_router.get("/company/overview", tags=["company"])
async def company_overview(
    user: Annotated[User, Depends(require_roles(UserRole.COMPANY))],
    db: DbSession,
) -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    week_start = now - timedelta(days=7)
    review_cutoff = now - timedelta(days=3)
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    async def count(statement: Any) -> int:
        return int(await db.scalar(statement) or 0)

    total_internships = await count(
        select(func.count(Internship.id)).where(Internship.company_id == user.id)
    )
    active_internships = await count(
        select(func.count(Internship.id)).where(
            Internship.company_id == user.id,
            Internship.status == "PUBLISHED",
            Internship.deadline >= now.date(),
        )
    )
    total_applicants = await count(
        select(func.count(Application.id))
        .join(Internship, Application.internship_id == Internship.id)
        .where(Internship.company_id == user.id)
    )
    new_this_week = await count(
        select(func.count(Application.id))
        .join(Internship, Application.internship_id == Internship.id)
        .where(Internship.company_id == user.id, Application.created_at >= week_start)
    )
    shortlisted = await count(
        select(func.count(Application.id))
        .join(Internship, Application.internship_id == Internship.id)
        .where(Internship.company_id == user.id, Application.status == "SHORTLISTED")
    )
    interviews_today = await count(
        select(func.count(Interview.id))
        .join(Application, Interview.application_id == Application.id)
        .join(Internship, Application.internship_id == Internship.id)
        .where(
            Internship.company_id == user.id,
            Interview.scheduled_at >= day_start,
            Interview.scheduled_at < day_start + timedelta(days=1),
            Interview.status.in_(("SCHEDULED", "RESCHEDULED")),
        )
    )
    waiting_review = await count(
        select(func.count(Application.id))
        .join(Internship, Application.internship_id == Internship.id)
        .where(
            Internship.company_id == user.id,
            Application.status.in_(("APPLIED", "UNDER_REVIEW")),
            Application.created_at < review_cutoff,
        )
    )
    drafts = await count(
        select(func.count(Internship.id)).where(
            Internship.company_id == user.id,
            Internship.status == "DRAFT",
        )
    )
    uploaded_types = set(
        (
            await db.scalars(
                select(CompanyDocument.document_type).where(CompanyDocument.company_id == user.id)
            )
        ).all()
    )
    missing_documents = [
        document_type
        for document_type in ("BUSINESS_REGISTRATION", "GST_OR_PAN")
        if document_type not in uploaded_types
    ]
    profile = await db.scalar(select(CompanyProfile).where(CompanyProfile.user_id == user.id))

    recent_rows = (
        await db.execute(
            select(Application, StudentProfile, Internship)
            .join(Internship, Application.internship_id == Internship.id)
            .outerjoin(StudentProfile, StudentProfile.user_id == Application.student_id)
            .where(Internship.company_id == user.id)
            .order_by(Application.created_at.desc(), Application.id.desc())
            .limit(8)
        )
    ).all()
    recent_applications = [
        {
            "id": application.id,
            "student_id": application.student_id,
            "student_name": student.full_name if student else "Student",
            "student_university": student.university if student else None,
            "internship_id": internship.id,
            "internship_title": internship.title,
            "status": application.status,
            "created_at": application.created_at,
        }
        for application, student, internship in recent_rows
    ]
    return {
        "kpis": {
            "active_internships": active_internships,
            "total_internships": total_internships,
            "total_applicants": total_applicants,
            "new_applications_this_week": new_this_week,
            "shortlisted": shortlisted,
            "interviews_scheduled": await count(
                select(func.count(Interview.id))
                .join(Application, Interview.application_id == Application.id)
                .join(Internship, Application.internship_id == Internship.id)
                .where(
                    Internship.company_id == user.id,
                    Interview.status.in_(("SCHEDULED", "RESCHEDULED")),
                    Interview.scheduled_at > now,
                )
            ),
        },
        "pending_actions": {
            "applications_waiting_over_three_days": waiting_review,
            "interviews_today": interviews_today,
            "drafts_not_submitted": drafts,
            "missing_verification_documents": missing_documents,
        },
        "recent_applications": recent_applications,
        "company_name": profile.company_name if profile else None,
        "period_label": "Last 7 days",
    }


@api_router.get("/admin/dashboard", tags=["admin"])
async def admin_dashboard(user: Annotated[User, Depends(require_roles(UserRole.ADMIN))]) -> dict[str, Any]:
    local_part = user.email.split("@")[0]
    words = "".join(c if c.isalpha() else " " for c in local_part).split()
    name = " ".join(words).title() if words else local_part.title()
    return {"email": user.email, "role": user.role.value, "name": name, "user_id": user.id}
