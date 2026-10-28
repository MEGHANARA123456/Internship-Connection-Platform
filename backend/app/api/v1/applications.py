# -----------------------------------------------------------------------------
# Endpoints for internship application submission, review, and tracking.
# -----------------------------------------------------------------------------

from typing import Annotated
import logging
import re
from datetime import date, datetime, timedelta, timezone
from html import escape

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from sqlalchemy import extract, func, or_, select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from app.api.v1.dependencies import DbSession, get_current_user, require_roles
from app.models import Application, ApplicationEvent, ApplicationStatusEvent, CompanyProfile, EmailMessage, Interview, Internship, Resume, SkillBadge, StudentProfile, User, UserRole
from app.services.ai import compute_explicit_eligibility_fit, compute_match, get_student_resume_text
from app.services.application_events import record_event, record_status_event, transition_application
from app.services.mail import visible_gmail_url
from app.services.notify import dispatch_notification, notify
from app.services.application_rules import check_eligibility
from app.services.skill_badges import apply_verified_badge_boost, badge_response, get_valid_badges
from app.schemas.application import (
    ApplicationCreate,
    ApplicationDashboard,
    ApplicationResponse,
    ApplicationStatusUpdate,
    OfferAcceptance,
    BulkApplicationStatusResponse,
    BulkApplicationStatusUpdate,
)

router = APIRouter(prefix="/applications", tags=["applications"])
logger = logging.getLogger(__name__)
student_only = Annotated[User, Depends(require_roles(UserRole.STUDENT))]# type: ignore
company_only = Annotated[User, Depends(require_roles(UserRole.COMPANY))]# type: ignore


def _display_internship_title(title: str) -> str:
    return title.replace("_", " ").replace("-", " ").title()


def _status_notification_text(
    status: str,
    company_name: str,
    internship_title: str,
) -> tuple[str, str, str]:
    status_text = status.replace("_", " ").title()
    title = "Offer update" if status == "SELECTED" else "Application status update"
    body = f"Your application for {internship_title} at {company_name} is now {status_text}."
    html = f"""
    <div style="font-family: Arial, sans-serif; max-width: 540px; margin: 0 auto; padding: 24px; background: #f8fafc; color: #0f172a;">
      <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px;">
        <div style="font-size: 12px; letter-spacing: 1.4px; color: #4338ca; font-weight: 700; text-transform: uppercase; margin-bottom: 16px;">InternSphere</div>
        <h2 style="margin: 0 0 12px; font-size: 22px;">{escape(title)}</h2>
        <p style="margin: 0; color: #475569; line-height: 1.6;">{escape(body)}</p>
      </div>
    </div>
    """
    return title, body, html

TRANSITIONS = {
    "APPLIED": {"UNDER_REVIEW", "WITHDRAWN"},
    "UNDER_REVIEW": {"SHORTLISTED", "REJECTED", "WITHDRAWN"},
    "SHORTLISTED": {"INTERVIEW_SCHEDULED", "REJECTED", "WITHDRAWN"},
    "INTERVIEW_SCHEDULED": {"SELECTED", "REJECTED"},
    "SELECTED": {"ACCEPTED"},
    "ACCEPTED": set(),
    "REJECTED": set(),
    "WITHDRAWN": set(),
}


def _response_time_hours(applied_at: datetime, response_at: datetime) -> float:
    if applied_at.tzinfo is None:
        applied_at = applied_at.replace(tzinfo=timezone.utc)
    if response_at.tzinfo is None:
        response_at = response_at.replace(tzinfo=timezone.utc)
    return max(0.0, round((response_at - applied_at).total_seconds() / 3600, 1))


def _application_search_filter(search: str | None):
    tokens = re.findall(r"[a-z0-9]+", (search or "").casefold())
    if not tokens:
        return None
    normalized_title = " " + func.replace(func.lower(Internship.title), "/", " ") + " "
    title_matches = [normalized_title.contains(f" {token} ") for token in tokens]
    company_match = select(CompanyProfile.user_id).where(
        CompanyProfile.user_id == Internship.company_id,
        CompanyProfile.company_name.ilike(f"%{search.strip()}%"),
    ).exists()
    return or_(*title_matches, company_match)


def application_transition_allowed(current: str, target: str) -> bool:
    return target in TRANSITIONS.get(current, set())


def allowed_next_statuses(current: str) -> list[str]:
    return sorted(TRANSITIONS.get(current, set()))


def allowed_actions_for_status(current: str) -> list[str]:
    action_by_status = {
        "UNDER_REVIEW": "MOVE_TO_REVIEW",
        "SHORTLISTED": "SHORTLIST",
        "INTERVIEW_SCHEDULED": "SCHEDULE_INTERVIEW",
        "SELECTED": "SELECT",
        "REJECTED": "REJECT",
    }
    return [
        action
        for status, action in action_by_status.items()
        if application_transition_allowed(current, status)
    ]


def _already_applied_response(application: Application) -> JSONResponse:
    status_label = application.status.replace("_", " ").title()
    blocker = {
        "code": "ALREADY_APPLIED",
        "message": f"You already applied to this internship (status: {status_label}).",
        "action_url": f"/applications?id={application.id}",
        "application_id": application.id,
        "status": application.status,
    }
    return JSONResponse(
        status_code=409,
        content={
            "detail": blocker["message"],
            "code": "ALREADY_APPLIED",
            "blockers": [blocker],
        },
    )


def _is_application_unique_violation(exc: IntegrityError) -> bool:
    original = exc.orig
    constraint_name = getattr(getattr(original, "diag", None), "constraint_name", None)
    if constraint_name == "uq_application_student_internship":
        return True

    message = str(original).lower()
    if "uq_application_student_internship" in message:
        return True
    prefix = "unique constraint failed:"
    if prefix not in message:
        return False
    columns = {
        column.strip().split(".")[-1].strip('"`[]')
        for column in message.split(prefix, 1)[1].split(",")
    }
    return columns == {"student_id", "internship_id"}


async def serialize(
    application: Application,
    db: DbSession,
    include_match: bool = False,
    include_verified_badges: bool = False,
) -> dict:
    student = await db.scalar(select(StudentProfile).where(StudentProfile.user_id == application.student_id))
    resume = await db.scalar(select(Resume).where(Resume.student_id == application.student_id))
    internship = await db.scalar(select(Internship).where(Internship.id == application.internship_id))
    comp = await db.scalar(select(CompanyProfile).where(CompanyProfile.user_id == internship.company_id)) if (internship and internship.company_id) else None
    latest_event = await db.scalar(
        select(ApplicationEvent)
        .where(ApplicationEvent.application_id == application.id)
        .order_by(ApplicationEvent.created_at.desc())
        .limit(1)
    )
    latest_status_event = await db.scalar(
        select(ApplicationStatusEvent)
        .where(ApplicationStatusEvent.application_id == application.id)
        .order_by(ApplicationStatusEvent.changed_at.desc(), ApplicationStatusEvent.id.desc())
        .limit(1)
    )
    payload = {
        "id": application.id,
        "internship_id": application.internship_id,
        "internship_title": _display_internship_title(internship.title) if internship else None,
        "internship_location": internship.location if internship else None,
        "internship_posted_at": internship.created_at if internship else None,
        "internship_deadline": internship.deadline if internship else None,
        "internship_stipend": internship.stipend if internship else None,
        "internship_status": internship.status if internship else None,
        "internship_closed_at": internship.closed_at if internship else None,
        "company_name": comp.company_name if (comp and comp.company_name) else "Enterprise Partner",
        "company_id": internship.company_id if internship else None,
        "student_id": application.student_id,
        "status": application.status,
        "allowed_next": allowed_next_statuses(application.status),
        "allowed_actions": allowed_actions_for_status(application.status),
        "cover_note": application.cover_note,
        "offer_signed_name": application.offer_signed_name,
        "offer_signature_mode": application.offer_signature_mode,
        "offer_accepted_at": application.offer_accepted_at,
        "created_at": application.created_at,
        "updated_at": application.updated_at,
        "student_name": student.full_name if student else None,
        "student_university": student.university if student else None,
        "student_skills": [skill for skill in (student.skills if student else "").split(",") if skill],
        "resume_id": resume.id if resume else None,
        "has_resume": resume is not None,
        "resume_filename": resume.original_filename if resume else None,
        "resume_size": resume.file_size if resume else None,
    }
    if include_match:
        job_skills = [skill.strip() for skill in (internship.skills if internship else "").split(",") if skill.strip()]
        match_info = compute_match(
            [skill.strip() for skill in (student.skills if student else "").split(",") if skill.strip()],
            await get_student_resume_text(db, application.student_id),
            internship.title if internship else "",
            internship.description if internship else "",
            job_skills,
            eligibility_data=compute_explicit_eligibility_fit(
                internship.description if internship else "",
                student.graduation_year if student else None,
                f"{student.major} {student.university}" if student else "",
            ),
        )
        badges = (
            await get_valid_badges(db, application.student_id)
            if student is not None and student.show_verified_badges
            else []
        )
        match_info = apply_verified_badge_boost(match_info, job_skills, badges)
        payload["match_score"] = match_info["score"]
        payload["match_explanation"] = match_info["match_explanation"]
        payload["match"] = {
            key: match_info.get(key)
            for key in ("score", "matched", "missing", "reason", "confidence", "score_breakdown", "base_match_score", "verified_skill_bonus", "verified_skills")
            if key in match_info
        }
    if include_verified_badges:
        badges = (
            await get_valid_badges(db, application.student_id)
            if student is not None and student.show_verified_badges
            else []
        )
        payload["verified_badges"] = [badge_response(badge) for badge in badges]
    if latest_event is not None:
        payload["latest_event_type"] = latest_event.event_type
        payload["latest_event_at"] = latest_event.created_at
    if latest_status_event is not None:
        payload["latest_status_from"] = latest_status_event.from_status
    return payload


@router.get("/eligibility/{internship_id}")
async def application_eligibility(
    internship_id: int,
    user: student_only,
    db: DbSession,
) -> dict:
    internship = await db.scalar(select(Internship).where(Internship.id == internship_id))
    if internship is None:
        raise HTTPException(404, "Internship not found")
    eligibility = await check_eligibility(db, user, internship)
    return {
        "can_apply": not eligibility["blockers"],
        **eligibility,
    }


@router.post("/internships/{internship_id}", response_model=ApplicationResponse, status_code=201)
async def apply(internship_id: int, data: ApplicationCreate, user: student_only, db: DbSession) -> dict | JSONResponse:
    student_id = user.id
    notifications = []
    try:
        internship = await db.scalar(
            select(Internship)
            .where(Internship.id == internship_id)
            .with_for_update(read=True)
            .execution_options(populate_existing=True)
        )
        if internship is None:
            raise HTTPException(404, "Internship not found")
        eligibility = await check_eligibility(db, user, internship)
        if eligibility["blockers"]:
            blocker = eligibility["blockers"][0]
            status_code = 409 if blocker["code"] == "ALREADY_APPLIED" else 422
            return JSONResponse(
                status_code=status_code,
                content={
                    "detail": blocker["message"],
                    "code": blocker["code"],
                    "blockers": eligibility["blockers"],
                },
            )
        application = await db.scalar(
            select(Application).where(
                Application.internship_id == internship_id,
                Application.student_id == student_id,
            )
        )
        is_reapplication = application is not None and application.status == "WITHDRAWN"
        if application is not None and not is_reapplication:
            return _already_applied_response(application)

        now = datetime.now(timezone.utc)
        if is_reapplication:
            application.status = "APPLIED"
            application.cover_note = data.cover_note
            application.created_at = now
            application.updated_at = now
        else:
            application = Application(
                internship_id=internship_id,
                student_id=user.id,
                cover_note=data.cover_note,
            )
            db.add(application)
            await db.flush()

        student_profile = await db.scalar(select(StudentProfile).where(StudentProfile.user_id == user.id))
        student_name = student_profile.full_name if student_profile else user.email
        company_title = (
            f"{student_name} re-applied to {_display_internship_title(internship.title)}"
            if is_reapplication
            else f"New application: {student_name} applied to {_display_internship_title(internship.title)}"
        )
        company_body = (
            f"{student_name} re-applied to {_display_internship_title(internship.title)}."
            if is_reapplication
            else f"{student_name} applied to {_display_internship_title(internship.title)}."
        )
        company_notification = await notify(
            db,
            internship.company_id,
            "APPLICATION_NEW",
            company_title,
            company_body,
            application_id=application.id,
            defer_delivery=True,
        )
        student_notification = await notify(
            db,
            user.id,
            "APPLICATION_SUBMITTED",
            f"Application submitted for {_display_internship_title(internship.title)}",
            f"Your application for {_display_internship_title(internship.title)} was submitted successfully.",
            application_id=application.id,
            defer_delivery=True,
        )
        notifications.extend(
            notification
            for notification in (company_notification, student_notification)
            if notification is not None
        )
        await record_status_event(
            db,
            application.id,
            "WITHDRAWN" if is_reapplication else None,
            "APPLIED",
            user.id,
            note="Re-application" if is_reapplication else "Initial application",
        )
        response_payload = await serialize(application, db)
        await db.commit()
        for notification in notifications:
            try:
                await db.refresh(notification)
                await dispatch_notification(notification)
            except Exception:
                logger.exception(
                    "Could not dispatch application notification %s after commit",
                    notification.id,
                )
        return response_payload
    except HTTPException:
        raise
    except IntegrityError as exc:
        await db.rollback()
        if _is_application_unique_violation(exc):
            try:
                duplicate = await db.scalar(
                    select(Application).where(
                        Application.internship_id == internship_id,
                        Application.student_id == student_id,
                    )
                )
            except SQLAlchemyError:
                await db.rollback()
                logger.exception("Failed to check for a duplicate application after a unique constraint violation")
            else:
                if duplicate is not None:
                    return _already_applied_response(duplicate)
        logger.exception("Could not submit application for internship %s and student %s", internship_id, student_id)
        raise HTTPException(500, "Could not submit your application. Please try again.") from exc
    except SQLAlchemyError as exc:
        await db.rollback()
        logger.exception("Could not submit application for internship %s and student %s", internship_id, student_id)
        raise HTTPException(500, "Could not submit your application. Please try again.") from exc


@router.get("/{application_id}/timeline")
async def get_application_timeline(
    application_id: int,
    user: Annotated[User, Depends(get_current_user)],
    db: DbSession,
) -> dict:
    application = await db.scalar(select(Application).where(Application.id == application_id))
    if application is None:
        raise HTTPException(404, "Application not found")

    internship = await db.scalar(select(Internship).where(Internship.id == application.internship_id))
    if internship is None:
        raise HTTPException(404, "Application not found")
    if user.role == UserRole.STUDENT:
        allowed = application.student_id == user.id
    elif user.role == UserRole.COMPANY:
        allowed = internship.company_id == user.id
    else:
        allowed = user.role == UserRole.ADMIN
    if not allowed:
        raise HTTPException(404, "Application not found")

    legacy_events = list(await db.scalars(
        select(ApplicationEvent)
        .where(ApplicationEvent.application_id == application.id)
        .order_by(ApplicationEvent.created_at, ApplicationEvent.id)
    ))
    status_events = list(await db.scalars(
        select(ApplicationStatusEvent)
        .where(ApplicationStatusEvent.application_id == application.id)
        .order_by(ApplicationStatusEvent.changed_at, ApplicationStatusEvent.id)
    ))
    interviews = list(await db.scalars(
        select(Interview)
        .where(Interview.application_id == application.id)
        .order_by(Interview.scheduled_at, Interview.id)
    ))
    email_query = select(EmailMessage).where(EmailMessage.application_id == application.id)
    if user.role != UserRole.ADMIN:
        email_query = email_query.where(EmailMessage.user_id == user.id)
    emails = list(await db.scalars(email_query.order_by(EmailMessage.created_at, EmailMessage.id)))

    history_dates: dict[str, datetime] = {}
    status_dates: dict[str, datetime] = {}
    for event in legacy_events:
        history_dates[event.event_type] = event.created_at
    for event in status_events:
        if event.to_status:
            status_dates[event.to_status] = event.changed_at
    history_order = [
        ("APPLIED", "Applied", "Your application was submitted."),
        ("APPLICATION_VIEWED", "Application viewed", "A recruiter opened your application."),
        ("RESUME_VIEWED", "Resume viewed", "A recruiter viewed or downloaded your resume."),
        ("UNDER_REVIEW", "Under review", "The recruiter is reviewing your application."),
        ("SHORTLISTED", "Shortlisted", "The recruiter added your application to the shortlist."),
        ("INTERVIEW_SCHEDULED", "Interview scheduled", "An interview was arranged for your application."),
        ("SELECTED", "Offer extended", "The company selected you and extended an offer."),
        ("ACCEPTED", "Offer accepted", "You accepted the offer."),
    ]
    status_order = ["APPLIED", "UNDER_REVIEW", "SHORTLISTED", "INTERVIEW_SCHEDULED", "SELECTED", "ACCEPTED"]
    terminal_event = next(
        (event for event in reversed(status_events) if event.to_status == application.status),
        None,
    ) if application.status in {"REJECTED", "WITHDRAWN"} else None
    status_rank = (
        status_order.index(application.status)
        if application.status in status_order
        else status_order.index(terminal_event.from_status)
        if terminal_event and terminal_event.from_status in status_order
        else 0
    )
    current_interview = next((item for item in reversed(interviews) if item.status != "CANCELLED"), None)
    if current_interview is None and interviews:
        current_interview = interviews[-1]

    email_payloads = []
    email_by_key: dict[str, list[dict]] = {}
    for email in emails:
        if email.message_type == "APPLICATION_SUBMITTED":
            key = "APPLIED"
        elif email.message_type == "APPLICATION_STATUS":
            key = application.status
        elif (email.message_type or "").startswith("INTERVIEW_"):
            key = "INTERVIEW_SCHEDULED"
        else:
            continue
        payload = {
            "id": email.id,
            "subject": email.subject,
            "message_type": email.message_type,
            "created_at": email.created_at,
            "gmail_url": visible_gmail_url(email, user.email) if email.user_id == user.id else None,
        }
        email_payloads.append(payload)
        email_by_key.setdefault(key, []).append(payload)

    steps: list[dict] = []
    for key, label, description in history_order:
        if key in {"APPLICATION_VIEWED", "RESUME_VIEWED"}:
            reached = key in history_dates
            state = "done" if reached else "upcoming"
            timestamp = history_dates.get(key)
        else:
            rank = status_order.index(key)
            reached = rank <= status_rank
            state = (
                "done" if rank < status_rank or application.status == "ACCEPTED"
                else "current" if rank == status_rank and application.status not in {"REJECTED", "WITHDRAWN"}
                else "done" if reached else "upcoming"
            )
            timestamp = status_dates.get(key)
            if key == "APPLIED":
                timestamp = timestamp or application.created_at
        step: dict = {
            "key": key,
            "label": label,
            "state": state,
            "timestamp": timestamp,
            "description": description,
            "emails": email_by_key.get(key, []),
        }
        if key == "INTERVIEW_SCHEDULED" and current_interview:
            scheduled_at = current_interview.scheduled_at
            step["interview"] = {
                "id": current_interview.id,
                "date": scheduled_at.date().isoformat(),
                "time": scheduled_at.strftime("%H:%M"),
                "type": current_interview.interview_type,
                "link": current_interview.meeting_link,
                "status": current_interview.status,
            }
        steps.append(step)

    closure_event = next(
        (event for event in reversed(legacy_events) if event.event_type == "INTERNSHIP_CLOSED"),
        None,
    )
    if closure_event:
        closed_at = internship.closed_at or closure_event.created_at
        steps.append(
            {
                "key": "INTERNSHIP_CLOSED",
                "label": "Internship closed",
                "state": "done",
                "timestamp": closed_at,
                "description": f"Internship closed on {closed_at.date().isoformat()}.",
                "emails": [],
            }
        )

    if application.status in {"REJECTED", "WITHDRAWN"}:
        steps.append({
            "key": application.status,
            "label": "Rejected" if application.status == "REJECTED" else "Withdrawn",
            "state": "failed",
            "timestamp": terminal_event.changed_at if terminal_event else application.updated_at,
            "description": (
                "The company decided to move forward with other applicants."
                if application.status == "REJECTED"
                else "You withdrew this application."
            ),
            "emails": email_by_key.get(application.status, []),
        })
    return {
        "summary": {
            "id": application.id,
            "status": application.status,
            "internship_id": internship.id,
            "title": internship.title,
            "company_name": (await db.scalar(
                select(CompanyProfile.company_name).where(CompanyProfile.user_id == internship.company_id)
            )) or "Company",
            "location": internship.location,
            "work_mode": internship.work_mode,
            "stipend": internship.stipend,
            "applied_at": application.created_at,
            "offer_signed_name": application.offer_signed_name,
            "offer_accepted_at": application.offer_accepted_at,
            "internship_status": internship.status,
            "internship_closed_at": internship.closed_at,
        },
        "steps": steps,
        "related_emails": email_payloads,
    }


@router.get("/mine", response_model=ApplicationDashboard)
@router.get("/student", response_model=ApplicationDashboard)
async def student_dashboard(
    user: student_only,
    db: DbSession,
    status: str | None = Query(default=None),
    search: str | None = Query(default=None, max_length=100),
) -> dict:
    applications_query = select(Application).where(Application.student_id == user.id)
    if status and status.upper() != "ALL":
        applications_query = applications_query.where(Application.status == status.upper())
    search_filter = _application_search_filter(search)
    if search_filter is not None:
        applications_query = applications_query.where(
            Application.internship_id.in_(select(Internship.id).where(search_filter))
        )
    applications = list(await db.scalars(applications_query.order_by(Application.created_at.desc())))
    counts = {name: count for name, count in (await db.execute(select(Application.status, func.count()).where(Application.student_id == user.id).group_by(Application.status))).all()}
    response_rows = (await db.execute(
        select(
            ApplicationEvent.application_id,
            func.min(ApplicationEvent.created_at),
            Application.created_at,
        )
        .join(Application, Application.id == ApplicationEvent.application_id)
        .join(Internship, Internship.id == Application.internship_id)
        .where(
            Application.student_id == user.id,
            ApplicationEvent.event_type != "APPLIED",
            ApplicationEvent.actor_id == Internship.company_id,
        )
        .group_by(ApplicationEvent.application_id, Application.created_at)
    )).all()
    response_times = {
        application_id: _response_time_hours(applied_at, first_response)
        for application_id, first_response, applied_at in response_rows
        if first_response is not None
    }
    items = []
    for application in applications:
        item = await serialize(application, db, include_match=True)
        item["has_company_response"] = application.id in response_times
        item["response_time_hours"] = response_times.get(application.id)
        items.append(item)
    return {"counts": counts, "applications": items, "total": len(items)}


@router.get("/company", response_model=list[ApplicationResponse])
async def list_all_company_applications(user: company_only, db: DbSession) -> list[dict]:
    applications = await db.scalars(
        select(Application)
        .join(Internship, Application.internship_id == Internship.id)
        .where(Internship.company_id == user.id)
        .order_by(Application.created_at.desc())
    )
    return [
        await serialize(application, db, include_match=True, include_verified_badges=True)
        for application in applications
    ]


@router.get("/company/search")
async def search_company_applications(
    user: company_only,
    db: DbSession,
    status: str | None = None,
    internship_id: int | None = Query(default=None, alias="internship"),
    search: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    created: str | None = None,
    skills: str | None = None,
    education: str | None = None,
    verified_skill: bool = False,
    sort: str = "newest",
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
) -> dict:
    query = (
        select(Application)
        .join(Internship, Application.internship_id == Internship.id)
        .outerjoin(StudentProfile, StudentProfile.user_id == Application.student_id)
        .where(Internship.company_id == user.id)
    )
    if status and status.upper() != "ALL":
        query = query.where(Application.status == status.upper())
    if internship_id is not None:
        query = query.where(Internship.id == internship_id)
    if search and search.strip():
        query = query.where(StudentProfile.full_name.ilike(f"%{search.strip()}%"))
    if date_from is not None:
        query = query.where(func.date(Application.created_at) >= date_from.isoformat())
    if date_to is not None:
        query = query.where(func.date(Application.created_at) <= date_to.isoformat())
    if created == "week":
        query = query.where(Application.created_at >= datetime.now(timezone.utc) - timedelta(days=7))
    if skills and skills.strip():
        query = query.where(StudentProfile.skills.ilike(f"%{skills.strip()}%"))
    if education and education.strip():
        query = query.where(
            (StudentProfile.university.ilike(f"%{education.strip()}%"))
            | (StudentProfile.major.ilike(f"%{education.strip()}%"))
        )
    if verified_skill:
        now = datetime.now(timezone.utc)
        query = query.where(
            Application.student_id.in_(
                select(SkillBadge.student_id)
                .join(StudentProfile, StudentProfile.user_id == SkillBadge.student_id)
                .where(
                    SkillBadge.expires_at > now,
                    StudentProfile.show_verified_badges.is_(True),
                )
            )
        )
    count_query = select(func.count()).select_from(query.order_by(None).subquery())
    total = int(await db.scalar(count_query) or 0)
    status_counts_query = (
        select(Application.status, func.count(Application.id))
        .join(Internship, Application.internship_id == Internship.id)
        .where(Internship.company_id == user.id)
        .group_by(Application.status)
    )
    status_counts = {
        status_key: int(count)
        for status_key, count in (await db.execute(status_counts_query)).all()
    }
    if sort == "response_time":
        first_response_at = (
            select(func.min(ApplicationEvent.created_at))
            .where(
                ApplicationEvent.application_id == Application.id,
                ApplicationEvent.event_type != "APPLIED",
                ApplicationEvent.actor_id == Internship.company_id,
            )
            .correlate(Application, Internship)
            .scalar_subquery()
        )
        if db.get_bind().dialect.name == "sqlite":
            response_duration = func.julianday(first_response_at) - func.julianday(Application.created_at)
        else:
            response_duration = extract("epoch", first_response_at - Application.created_at)
        query = query.order_by(response_duration.asc().nullslast(), Application.created_at.desc())
    elif sort == "oldest":
        query = query.order_by(Application.created_at.asc(), Application.id.asc())
    elif sort == "name":
        query = query.order_by(StudentProfile.full_name.asc(), Application.id.asc())
    else:
        query = query.order_by(Application.created_at.desc(), Application.id.desc())
    applications = list(
        (
            await db.scalars(
                query.offset((page - 1) * page_size).limit(page_size)
            )
        ).all()
    )
    return {
        "items": [
            await serialize(application, db, include_match=True, include_verified_badges=True)
            for application in applications
        ],
        "total": total,
        "status_counts": status_counts,
        "page": page,
        "page_size": page_size,
    }


@router.get("/internships/{internship_id}", response_model=list[ApplicationResponse])
async def company_applications(internship_id: int, user: company_only, db: DbSession) -> list[dict]:
    internship = await db.scalar(select(Internship).where(Internship.id == internship_id, Internship.company_id == user.id))
    if internship is None: raise HTTPException(404, "Internship not found")
    applications = await db.scalars(select(Application).where(Application.internship_id == internship_id).order_by(Application.created_at.desc()))
    return [
        await serialize(application, db, include_match=True, include_verified_badges=True)
        for application in applications
    ]


@router.post("/{application_id}/viewed")
async def mark_application_viewed(application_id: int, user: company_only, db: DbSession) -> dict:
    application = await db.scalar(
        select(Application)
        .join(Internship, Application.internship_id == Internship.id)
        .where(Application.id == application_id, Internship.company_id == user.id)
    )
    if application is None:
        raise HTTPException(404, "Application not found")
    await record_event(db, application.id, "APPLICATION_VIEWED", user.id, once=True)
    await db.commit()
    return {"application_id": application.id, "status": "viewed"}


@router.get("/{application_id}/tracking")
async def get_application_tracking(application_id: int, user: student_only, db: DbSession) -> dict:
    application = await db.scalar(select(Application).where(Application.id == application_id, Application.student_id == user.id))
    if application is None:
        raise HTTPException(404, "Application not found")

    internship = await db.scalar(select(Internship).where(Internship.id == application.internship_id))
    if internship is None:
        raise HTTPException(404, "Internship not found")

    company_profile = await db.scalar(select(CompanyProfile).where(CompanyProfile.user_id == internship.company_id))
    student_profile = await db.scalar(select(StudentProfile).where(StudentProfile.user_id == user.id))
    resume = await db.scalar(select(Resume).where(Resume.student_id == user.id))

    event_rows = list(await db.scalars(
        select(ApplicationEvent)
        .where(ApplicationEvent.application_id == application.id)
        .order_by(ApplicationEvent.created_at.asc())
    ))
    event_dates = {row.event_type: row.created_at for row in event_rows}

    step_order = [
        ("APPLIED", "Applied"),
        ("APPLICATION_VIEWED", "Application viewed"),
        ("RESUME_VIEWED", "Resume viewed"),
        ("UNDER_REVIEW", "Under review"),
        ("SHORTLISTED", "Shortlisted"),
        ("INTERVIEW_SCHEDULED", "Interview scheduled"),
        ("SELECTED", "Offer extended"),
        ("ACCEPTED", "Offer accepted"),
    ]
    steps = []
    reached_any = False
    for key, label in step_order:
        if key in event_dates:
            reached_any = True
            steps.append({"key": key, "label": label, "state": "done", "date": event_dates[key]})
    if application.status not in {"REJECTED", "WITHDRAWN", "ACCEPTED"} and reached_any:
        steps.append({"key": "AWAITING_RECRUITER_ACTION", "label": "Awaiting recruiter action", "state": "upcoming", "date": None})
    elif application.status == "REJECTED":
        steps.append({"key": "REJECTED", "label": "Not selected", "state": "done", "date": event_dates.get("REJECTED", application.updated_at)})
    elif application.status == "WITHDRAWN":
        steps.append({"key": "WITHDRAWN", "label": "Withdrawn", "state": "done", "date": event_dates.get("WITHDRAWN", application.updated_at)})

    total_applications = await db.scalar(select(func.count()).select_from(Application).where(Application.internship_id == internship.id))
    viewed_by_recruiter = await db.scalar(
        select(func.count(Application.id))
        .select_from(Application)
        .where(
            Application.internship_id == internship.id,
            Application.id.in_(
                select(ApplicationEvent.application_id).where(ApplicationEvent.event_type != "APPLIED").distinct()
            ),
        )
    )

    student_skills = [skill.strip() for skill in (student_profile.skills if student_profile else "").split(",") if skill.strip()]
    job_skills = [skill.strip() for skill in internship.skills.split(",") if skill.strip()] or [skill.strip() for skill in internship.title.split() if skill.strip()]
    resume_text = await get_student_resume_text(db, application.student_id)
    match_summary = compute_match(
        student_skills,
        resume_text,
        internship.title,
        internship.description,
        job_skills,
        eligibility_data=compute_explicit_eligibility_fit(
            internship.description,
            student_profile.graduation_year if student_profile else None,
            f"{student_profile.major} {student_profile.university}" if student_profile else "",
        ),
    )
    required_skill_total = max(len(job_skills), 1)
    matched_skill_total = len(match_summary.get("matched_skills", []))
    early_threshold = max(1, min(10, int(__import__('math').ceil(total_applications * 0.25))) if total_applications else 1)
    applications_for_internship = list(await db.scalars(select(Application).where(Application.internship_id == internship.id).order_by(Application.created_at.asc())))
    application_rank = next((index + 1 for index, item in enumerate(applications_for_internship) if item.id == application.id), total_applications or 0)
    student_location = getattr(student_profile, "location", None) if student_profile is not None else None
    internship_location = (internship.location or "").strip().lower()
    location_ok = True if not student_location else internship_location == "remote" or (student_location and student_location.lower() == internship_location)

    criteria = [
        {
            "label": "Early applicant",
            "ok": application_rank <= early_threshold,
            "detail": f"Applied #{application_rank} of {total_applications}",
        },
        {
            "label": "Key skills",
            "ok": required_skill_total == 0 or (matched_skill_total / required_skill_total) >= 0.60,
            "detail": f"{matched_skill_total} of {required_skill_total} required skills" if required_skill_total else "No required skill list provided",
        },
        {
            "label": "Location",
            "ok": location_ok,
            "detail": "Remote role" if internship_location == "remote" else (f"Student location: {student_location}" if student_location else "No student location provided"),
        },
        {
            "label": "Resume uploaded",
            "ok": bool(resume),
            "detail": "Resume on file" if resume else "No resume uploaded",
        },
    ]

    return {
        "summary": {
            "id": application.id,
            "status": application.status,
            "internship_id": internship.id,
            "title": internship.title,
            "company_name": company_profile.company_name if company_profile else "Company",
            "location": internship.location,
            "work_mode": internship.work_mode,
            "stipend": internship.stipend,
            "applied_at": application.created_at,
            "offer_signed_name": application.offer_signed_name,
            "offer_accepted_at": application.offer_accepted_at,
            "internship_status": internship.status,
            "internship_closed_at": internship.closed_at,
        },
        "steps": steps,
        "activity": {
            "total_applications": int(total_applications or 0),
            "viewed_by_recruiter": int(viewed_by_recruiter or 0),
        },
        "criteria": criteria,
    }


@router.post("/bulk-status", response_model=BulkApplicationStatusResponse)
async def bulk_update_status(
    data: BulkApplicationStatusUpdate,
    background_tasks: BackgroundTasks,
    user: company_only,
    db: DbSession,
) -> dict:
    if not data.application_ids:
        return {"updated_count": 0, "success_ids": [], "failed_ids": []}

    target_status = data.status
    if target_status not in {"UNDER_REVIEW", "SHORTLISTED", "INTERVIEW_SCHEDULED", "SELECTED", "REJECTED"}:
        raise HTTPException(400, f"Invalid target status for company: {target_status}")

    success_ids = []
    failed_ids = []

    for app_id in data.application_ids:
        app = await db.scalar(select(Application).where(Application.id == app_id))
        if app is None:
            failed_ids.append(app_id)
            continue
        internship = await db.scalar(select(Internship).where(Internship.id == app.internship_id))
        if internship is None or internship.company_id != user.id:
            failed_ids.append(app_id)
            continue
        if not application_transition_allowed(app.status, target_status):
            failed_ids.append(app_id)
            continue

        await transition_application(db, app, target_status, user.id)
        success_ids.append(app_id)

        company_profile = await db.scalar(select(CompanyProfile).where(CompanyProfile.user_id == internship.company_id))
        company_user = await db.scalar(select(User).where(User.id == internship.company_id))
        company_name = (company_profile.company_name if company_profile else None) or (company_user.email if company_user else f"Company {internship.company_id}")
        title, body, html = _status_notification_text(target_status, company_name, _display_internship_title(internship.title))
        await notify(
            db, app.student_id, "APPLICATION_STATUS", title, body,
            email=True, html=html, application_id=app.id,
        )
        try:
            from app.api.v1.ws import manager
            await manager.send_personal_message(
                app.student_id,
                {
                    "type": "application_status_updated",
                    "application_id": app.id,
                    "status": target_status,
                    "internship_id": app.internship_id,
                    "title": title,
                    "body": body,
                },
            )
        except Exception as exc:
            logger.warning("Could not send application status notification for application %s: %s", app.id, exc)
            pass

    await db.commit()
    return {
        "updated_count": len(success_ids),
        "success_ids": success_ids,
        "failed_ids": failed_ids,
    }


@router.patch("/{application_id}/status", response_model=ApplicationResponse)
async def update_status(application_id: int, data: ApplicationStatusUpdate, background_tasks: BackgroundTasks, user: Annotated[User, Depends(get_current_user)], db: DbSession) -> dict:
    application = await db.scalar(select(Application).where(Application.id == application_id))
    if application is None: raise HTTPException(404, "Application not found")
    internship = await db.scalar(select(Internship).where(Internship.id == application.internship_id))
    if internship is None: raise HTTPException(404, "Internship not found")
    if user.role == UserRole.STUDENT:
        if application.student_id != user.id or data.status != "WITHDRAWN": raise HTTPException(403, "Students may only withdraw their own applications")
    elif user.role == UserRole.COMPANY:
        if internship.company_id != user.id or data.status not in {"UNDER_REVIEW", "SHORTLISTED", "INTERVIEW_SCHEDULED", "SELECTED", "REJECTED"}: raise HTTPException(403, "Company cannot update this application")
    else: raise HTTPException(403, "Insufficient permissions")
    if not application_transition_allowed(application.status, data.status): raise HTTPException(409, f"Cannot move {application.status} to {data.status}")
    await transition_application(
        db,
        application,
        data.status,
        user.id,
        note=data.reason.strip() if user.role == UserRole.STUDENT and data.reason and data.reason.strip() else None,
    )
    company_profile = await db.scalar(select(CompanyProfile).where(CompanyProfile.user_id == internship.company_id))
    company_user = await db.scalar(select(User).where(User.id == internship.company_id))
    company_name = (company_profile.company_name if company_profile else None) or (company_user.email if company_user else f"Company {internship.company_id}")
    student_profile = await db.scalar(select(StudentProfile).where(StudentProfile.user_id == application.student_id))
    student_name = student_profile.full_name if student_profile and student_profile.full_name else "A student"
    if user.role == UserRole.STUDENT:
        company_title = "Application withdrawn"
        company_body = f"{student_name} withdrew their application for {_display_internship_title(internship.title)}"
        await notify(
            db, internship.company_id, "APPLICATION_WITHDRAWN", company_title, company_body,
            email=True, application_id=application.id,
        )
        await notify(
            db, application.student_id, "APPLICATION_WITHDRAWN",
            "Application withdrawn",
            f"You withdrew your application for {_display_internship_title(internship.title)} at {company_name}",
            application_id=application.id,
        )
    else:
        title, body, html = _status_notification_text(data.status, company_name, _display_internship_title(internship.title))
        await notify(
            db, application.student_id, "APPLICATION_STATUS", title, body,
            email=True, html=html, application_id=application.id,
        )
        recipient = await db.scalar(select(User).where(User.id == application.student_id))
        if recipient:
            try:
                from app.api.v1.ws import manager
                await manager.send_personal_message(
                    recipient.id,
                    {
                        "type": "application_status_updated",
                        "application_id": application.id,
                        "status": data.status,
                        "internship_id": application.internship_id,
                        "title": title,
                        "body": body,
                    },
                )
            except Exception as exc:
                logger.warning("Could not send application status notification for application %s: %s", application.id, exc)
    await db.commit(); await db.refresh(application)
    return await serialize(application, db)


@router.patch("/{application_id}/review", response_model=ApplicationResponse)
async def mark_under_review(application_id: int, background_tasks: BackgroundTasks, user: Annotated[User, Depends(get_current_user)], db: DbSession) -> dict:
    return await update_status(application_id, ApplicationStatusUpdate(status="UNDER_REVIEW"), background_tasks, user, db)


@router.patch("/{application_id}/shortlist", response_model=ApplicationResponse)
async def mark_shortlist(application_id: int, background_tasks: BackgroundTasks, user: Annotated[User, Depends(get_current_user)], db: DbSession) -> dict:
    return await update_status(application_id, ApplicationStatusUpdate(status="SHORTLISTED"), background_tasks, user, db)


@router.patch("/{application_id}/select", response_model=ApplicationResponse)
async def mark_select(application_id: int, background_tasks: BackgroundTasks, user: Annotated[User, Depends(get_current_user)], db: DbSession) -> dict:
    return await update_status(application_id, ApplicationStatusUpdate(status="SELECTED"), background_tasks, user, db)


@router.patch("/{application_id}/reject", response_model=ApplicationResponse)
async def mark_reject(application_id: int, background_tasks: BackgroundTasks, user: Annotated[User, Depends(get_current_user)], db: DbSession) -> dict:
    return await update_status(application_id, ApplicationStatusUpdate(status="REJECTED"), background_tasks, user, db)


@router.patch("/{application_id}/withdraw", response_model=ApplicationResponse)
async def mark_withdraw(application_id: int, background_tasks: BackgroundTasks, user: Annotated[User, Depends(get_current_user)], db: DbSession) -> dict:
    return await update_status(application_id, ApplicationStatusUpdate(status="WITHDRAWN"), background_tasks, user, db)


@router.post("/{application_id}/accept-offer", response_model=ApplicationResponse)
async def accept_offer(application_id: int, data: OfferAcceptance, user: student_only, db: DbSession) -> dict:
    application = await db.scalar(select(Application).where(Application.id == application_id))
    if application is None or application.student_id != user.id:
        raise HTTPException(404, "Application not found")
    if application.status == "ACCEPTED":
        return await serialize(application, db)
    if application.status != "SELECTED":
        raise HTTPException(409, f"Cannot accept an offer while application is {application.status}")

    internship = await db.scalar(select(Internship).where(Internship.id == application.internship_id))
    if internship is None:
        raise HTTPException(404, "Internship not found")
    student_profile = await db.scalar(select(StudentProfile).where(StudentProfile.user_id == user.id))
    company = await db.scalar(select(User).where(User.id == internship.company_id))
    student_name = student_profile.full_name if student_profile else user.email
    internship_title = _display_internship_title(internship.title)
    notification_title = "Offer accepted"
    notification_body = f"{student_name} accepted the offer for {internship_title}"

    await transition_application(db, application, "ACCEPTED", user.id)
    application.offer_signed_name = data.signature_name.strip()
    application.offer_signature_mode = data.signature_mode
    application.offer_accepted_at = datetime.now(timezone.utc)
    await notify(
        db,
        internship.company_id,
        "APPLICATION_STATUS",
        notification_title,
        notification_body,
        email=True,
        application_id=application.id,
    )
    await db.commit()
    await db.refresh(application)

    if company:
        try:
            from app.api.v1.ws import manager
            await manager.send_personal_message(
                company.id,
                {
                    "type": "application_status_updated",
                    "application_id": application.id,
                    "status": "ACCEPTED",
                    "internship_id": application.internship_id,
                    "title": notification_title,
                    "body": notification_body,
                },
            )
        except Exception as exc:
            logger.warning("Could not send offer acceptance notification for application %s: %s", application.id, exc)
    return await serialize(application, db)