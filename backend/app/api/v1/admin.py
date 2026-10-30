# -----------------------------------------------------------------------------
# Admin-only endpoints for managing users, reports, and system-wide operations.
# -----------------------------------------------------------------------------

from datetime import datetime, timedelta, timezone
from typing import Annotated, Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request
from fastapi.responses import FileResponse
from sqlalchemy import String, cast, exists, func, or_, select

from app.api.v1.dependencies import DbSession, require_roles
from app.core.config import get_settings
from app.core.security import hash_password_async
from app.models import Application, AuditLog, CompanyDocument, CompanyProfile, Internship, Report, User, UserRole
from app.models.user import StudentProfile
from app.schemas.admin import (
    AdminCreate,
    AdminUserDeletionRequest,
    AuditLogResponse,
    CompanyListItem,
    CompanyPostingItem,
    ModerationStatus,
    PaginatedAuditLogs,
    ReportResponse,
    ReportUpdate,
    UserAdminResponse,
    UserDetailResponse,
    ApplicationBrief,
    StudentProfileBrief,
    CompanyProfileBrief,
)
from app.services.audit import write_audit
from app.services.account_deletion import erase_user
from app.services.email_validation import validate_email_format
from app.services.mail import send_dev_email
from app.services.notify import notify
from app.services.company_documents import company_document_path
from app.services.internship_closing import close_internship as close_internship_service, send_closure_emails

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_roles(UserRole.ADMIN))]) # type: ignore
admin_user = Annotated[User, Depends(require_roles(UserRole.ADMIN))] # type: ignore
REPORT_TRANSITIONS = {"OPEN": {"INVESTIGATING"}, "INVESTIGATING": {"RESOLVED"}, "RESOLVED": set()}


def report_transition_allowed(current: str, target: str) -> bool:
    """Return whether the requested report status is an allowed next state."""
    return target in REPORT_TRANSITIONS.get(current, set())


def _get_ip(request: Request) -> str | None:
    """Extract client IP from request, honouring X-Forwarded-For."""
    xff = request.headers.get("X-Forwarded-For")
    if xff:
        return xff.split(",")[0].strip()
    if request.client:
        return request.client.host
    return None


# ── Dashboard ────────────────────────────────────────────────────────────────

@router.get("/dashboard")
async def dashboard(db: DbSession, user: admin_user) -> dict[str, int]:
    """Count users, internships, applications, pending verification and approval items, and unresolved reports for the admin dashboard."""
    async def count(model, *where):
        """Return the database count for a model constrained by the supplied SQL conditions."""
        return int(await db.scalar(select(func.count()).select_from(model).where(*where)) or 0)
    return {
        "students": await count(User, User.role == UserRole.STUDENT),
        "companies": await count(User, User.role == UserRole.COMPANY),
        "internships": await count(Internship),
        "applications": await count(Application),
        "pending_verifications": await count(CompanyProfile, CompanyProfile.verification_status == "PENDING"),
        "pending_approvals": await count(Internship, Internship.status == "PENDING_APPROVAL"),
        "open_reports": await count(Report, Report.status != "RESOLVED"),
    }


# ── User Management ──────────────────────────────────────────────────────────

@router.get("/users", response_model=list[UserAdminResponse])
async def search_users(
    db: DbSession,
    user: admin_user,
    search: str | None = None,
    role: UserRole | None = None,
    include_suspended: bool = True,
    created: str | None = Query(None, pattern="^this_month$"),
) -> list[User]:
    """List users newest first, optionally filtering by email text, role, current-month creation, and suspended status."""
    query = select(User).order_by(User.id.desc())
    if search:
        query = query.where(User.email.ilike(f"%{search}%"))
    if role:
        query = query.where(User.role == role)
    if created == "this_month":
        now = datetime.now(timezone.utc)
        month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        query = query.where(User.created_at >= month_start)
    if not include_suspended:
        query = query.where(User.suspended_at.is_(None))
    return list(await db.scalars(query))


@router.post("/admins", response_model=UserAdminResponse, status_code=201)
async def create_admin(
    data: AdminCreate,
    db: DbSession,
    user: admin_user,
    request: Request,
    background_tasks: BackgroundTasks,
) -> User:
    """Validate and create an active, verified administrator, record the action, and queue an account email."""
    try:
        email = validate_email_format(data.email)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    if await db.scalar(select(User.id).where(User.email == email)):
        raise HTTPException(status_code=409, detail="Email already registered")

    new_admin = User(
        email=email,
        password_hash=await hash_password_async(data.password),
        role=UserRole.ADMIN,
        is_active=True,
        is_verified=True,
    )
    db.add(new_admin)
    await db.flush()
    await write_audit(
        db,
        actor=user,
        action="admin_created",
        target_type="user",
        target_id=new_admin.id,
        metadata={"email": email},
        ip_address=_get_ip(request),
    )
    await db.commit()
    await db.refresh(new_admin)

    frontend_url = (get_settings().frontend_url or "http://localhost:5174").rstrip("/")
    body = (
        f"You were added as an InternSphere administrator by {user.email}. "
        f"Sign in at {frontend_url}/login. Please enable two-factor authentication."
    )
    background_tasks.add_task(send_dev_email, email, "InternSphere administrator account", body)
    return new_admin


@router.get("/users/{user_id}", response_model=UserDetailResponse)
async def view_user_detail(user_id: int, db: DbSession, user: admin_user) -> dict[str, Any]:
    """Return full user profile including student/company data, applications, and recent audit events."""
    found = await db.get(User, user_id)
    if found is None:
        raise HTTPException(404, "User not found")

    # Build base response
    result: dict[str, Any] = {
        "id": found.id,
        "email": found.email,
        "role": found.role,
        "is_active": found.is_active,
        "is_verified": found.is_verified,
        "mfa_enabled": found.mfa_enabled,
        "suspended_at": found.suspended_at,
        "created_at": found.created_at,
        "student_profile": None,
        "company_profile": None,
        "applications": None,
        "recent_audit_events": None,
    }

    if found.role == UserRole.STUDENT:
        sp = await db.scalar(select(StudentProfile).where(StudentProfile.user_id == user_id))
        if sp:
            result["student_profile"] = StudentProfileBrief(
                full_name=sp.full_name,
                university=sp.university,
                major=sp.major,
                graduation_year=sp.graduation_year,
            )
        # Load applications with internship + company info
        apps = list(await db.scalars(
            select(Application).where(Application.student_id == user_id).order_by(Application.created_at.desc()).limit(20)
        ))
        app_briefs = []
        for app in apps:
            internship = await db.get(Internship, app.internship_id)
            company_name = f"Company #{internship.company_id}" if internship else "Unknown"
            if internship:
                cp = await db.scalar(select(CompanyProfile).where(CompanyProfile.user_id == internship.company_id))
                if cp:
                    company_name = cp.company_name
            app_briefs.append(ApplicationBrief(
                id=app.id,
                status=app.status,
                internship_title=internship.title if internship else "Deleted Internship",
                company_name=company_name,
                created_at=app.created_at,
            ))
        result["applications"] = app_briefs

    elif found.role == UserRole.COMPANY:
        cp = await db.scalar(select(CompanyProfile).where(CompanyProfile.user_id == user_id))
        if cp:
            posting_count = int(
                await db.scalar(select(func.count()).select_from(Internship).where(Internship.company_id == user_id)) or 0
            )
            result["company_profile"] = CompanyProfileBrief(
                company_name=cp.company_name,
                industry=cp.industry,
                verification_status=cp.verification_status,
                posting_count=posting_count,
            )

    # Recent audit events targeting this user
    audit_rows = list(await db.scalars(
        select(AuditLog)
        .where(AuditLog.target_type == "user", AuditLog.target_id == user_id)
        .order_by(AuditLog.created_at.desc())
        .limit(10)
    ))
    result["recent_audit_events"] = [
        AuditLogResponse(
            id=a.id,
            actor_id=a.actor_id,
            actor_email=a.actor_email,
            action=a.action,
            target_type=a.target_type,
            target_id=a.target_id,
            metadata=a.metadata_, # type: ignore
            ip_address=a.ip_address,
            created_at=a.created_at,
        )
        for a in audit_rows
    ]

    return result


@router.delete("/users/{user_id}")
async def delete_user_account(
    user_id: int,
    payload: AdminUserDeletionRequest,
    db: DbSession,
    user: admin_user,
) -> dict[str, Any]:
    """Delete the specified user after applying the supplied administrator deletion policy and recording the action."""
    target = await db.get(User, user_id)
    if target is None:
        raise HTTPException(status_code=404, detail="User not found")
    if payload.confirmation_email.strip().casefold() != target.email.strip().casefold():
        raise HTTPException(status_code=400, detail="Confirmation email does not match the target user")
    return await erase_user(
        db,
        target,
        reason=payload.reason,
        actor=user,
        admin_action=True,
    )


@router.post("/users/{user_id}/suspend", response_model=UserAdminResponse)
async def suspend_user(user_id: int, db: DbSession, user: admin_user, request: Request) -> User:
    """Suspend the specified user and record the administrator action."""
    found = await db.get(User, user_id)
    if found is None:
        raise HTTPException(404, "User not found")
    if user_id == user.id:
        raise HTTPException(400, "You cannot suspend your own account")
    if found.role == UserRole.ADMIN and found.is_active:
        active_admin_count = await db.scalar(
            select(func.count()).select_from(User).where(
                User.role == UserRole.ADMIN,
                User.is_active.is_(True),
            )
        ) or 0
        if active_admin_count <= 1:
            raise HTTPException(400, "At least one active administrator is required")
    found.is_active = False
    found.suspended_at = datetime.now(timezone.utc)
    await write_audit(
        db, actor=user, action="user_suspended",
        target_type="user", target_id=user_id,
        metadata={"email": found.email},
        ip_address=_get_ip(request),
    )
    await db.commit()
    await db.refresh(found)
    return found


@router.post("/users/{user_id}/reactivate", response_model=UserAdminResponse)
async def reactivate_user(user_id: int, db: DbSession, user: admin_user, request: Request) -> User:
    """Reactivate a suspended user and record the administrator action."""
    found = await db.get(User, user_id)
    if found is None:
        raise HTTPException(404, "User not found")
    found.is_active = True
    found.suspended_at = None
    await write_audit(
        db, actor=user, action="user_reinstated",
        target_type="user", target_id=user_id,
        metadata={"email": found.email},
        ip_address=_get_ip(request),
    )
    await db.commit()
    await db.refresh(found)
    return found


# ── Company Management ───────────────────────────────────────────────────────

def _company_output(profile: CompanyProfile) -> dict:
    """Build the API representation of a company profile."""
    return {
        "id": profile.id,
        "user_id": profile.user_id,
        "company_name": profile.company_name,
        "industry": profile.industry,
        "website": profile.website,
        "description": profile.description,
        "verification_status": profile.verification_status,
        "verification_note": profile.verification_note,
    }


def _company_document_output(document: CompanyDocument) -> dict:
    """Build the API representation of a company verification document."""
    return {
        "id": document.id,
        "company_id": document.company_id,
        "document_type": document.document_type,
        "original_filename": document.original_filename,
        "content_type": document.content_type,
        "file_size": document.file_size,
        "created_at": document.created_at,
    }


@router.get("/companies/{user_id}/documents")
async def company_verification_documents(
    user_id: int, db: DbSession, user: admin_user
) -> list[dict]:
    """List the verification documents associated with the selected company profile."""
    profile = await db.scalar(select(CompanyProfile).where(CompanyProfile.user_id == user_id))
    if profile is None:
        raise HTTPException(status_code=404, detail="Company profile not found")
    documents = await db.scalars(
        select(CompanyDocument)
        .where(CompanyDocument.company_id == user_id)
        .order_by(CompanyDocument.created_at.desc(), CompanyDocument.id.desc())
    )
    return [_company_document_output(document) for document in documents]


@router.get("/companies/{user_id}/documents/{document_id}/download")
async def download_company_verification_document(
    user_id: int, document_id: int, db: DbSession, user: admin_user
) -> FileResponse:
    """Return the stored verification document file, or a not-found response when it is unavailable."""
    document = await db.scalar(
        select(CompanyDocument).where(
            CompanyDocument.id == document_id,
            CompanyDocument.company_id == user_id,
        )
    )
    if document is None:
        raise HTTPException(status_code=404, detail="Company document not found")
    path = company_document_path(document.stored_filename)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Company document file not found")
    return FileResponse(path, media_type=document.content_type, filename=document.original_filename)


@router.get("/verifications")
@router.get("/companies/unverified")
async def pending_verifications(db: DbSession, user: admin_user) -> list[dict]:
    """List company profiles awaiting administrator verification."""
    profiles = list(
        (
            await db.execute(
                select(CompanyProfile, User.created_at)
                .join(User, User.id == CompanyProfile.user_id)
                .where(CompanyProfile.verification_status == "PENDING")
                .order_by(CompanyProfile.id)
            )
        ).all()
    )
    company_ids = [profile.user_id for profile, _ in profiles]
    documents_by_company: dict[int, list[dict]] = {}
    if company_ids:
        documents = await db.scalars(
            select(CompanyDocument)
            .where(CompanyDocument.company_id.in_(company_ids))
            .order_by(CompanyDocument.created_at.desc(), CompanyDocument.id.desc())
        )
        for document in documents:
            documents_by_company.setdefault(document.company_id, []).append(
                _company_document_output(document)
            )

    result = []
    for profile, submitted_at in profiles:
        output = _company_output(profile)
        output["submitted_at"] = submitted_at
        output["documents"] = documents_by_company.get(profile.user_id, [])
        result.append(output)
    return result


@router.get("/companies", response_model=list[CompanyListItem])
async def list_all_companies(
    db: DbSession,
    user: admin_user,
    search: str | None = None,
    verification_status: str | None = None,
) -> list[dict]:
    """List all company profiles with posting counts."""
    query = select(CompanyProfile).order_by(CompanyProfile.id.desc())
    if search:
        query = query.where(CompanyProfile.company_name.ilike(f"%{search}%"))
    if verification_status:
        query = query.where(CompanyProfile.verification_status == verification_status)
    profiles = list(await db.scalars(query))

    # Batch fetch posting counts
    company_user_ids = [p.user_id for p in profiles]
    posting_counts: dict[int, int] = {}
    if company_user_ids:
        rows = (await db.execute(
            select(Internship.company_id, func.count(Internship.id))
            .where(Internship.company_id.in_(company_user_ids))
            .group_by(Internship.company_id)
        )).all()
        posting_counts = {r[0]: r[1] for r in rows}

    return [
        CompanyListItem(
            id=p.id,
            user_id=p.user_id,
            company_name=p.company_name,
            industry=p.industry,
            website=p.website,
            verification_status=p.verification_status,
            verification_note=p.verification_note,
            posting_count=posting_counts.get(p.user_id, 0),
        )
        for p in profiles
    ] # type: ignore


@router.post("/companies/{user_id}/verification")
async def verify_company(
    user_id: int, data: ModerationStatus, db: DbSession, user: admin_user, request: Request
) -> dict:
    """Approve or reject a company verification request and persist the administrator decision."""
    if data.status not in {"VERIFIED", "PUBLISHED", "REJECTED"}:
        raise HTTPException(400, "Use VERIFIED or REJECTED")
    profile = await db.scalar(select(CompanyProfile).where(CompanyProfile.user_id == user_id))
    if profile is None:
        raise HTTPException(404, "Company profile not found")
    new_status = "VERIFIED" if data.status in {"VERIFIED", "PUBLISHED"} else "REJECTED"
    reason = data.reason.strip() if data.reason else ""
    if new_status == "REJECTED" and not reason:
        raise HTTPException(400, "A reason is required to reject company verification.")
    if new_status == "VERIFIED":
        business_registration = await db.scalar(
            select(CompanyDocument.id).where(
                CompanyDocument.company_id == user_id,
                CompanyDocument.document_type == "BUSINESS_REGISTRATION",
            ).limit(1)
        )
        if business_registration is None:
            raise HTTPException(
                400,
                "A BUSINESS_REGISTRATION document must be uploaded before approving this company.",
            )
    action = "company_verified" if new_status == "VERIFIED" else "company_rejected"
    profile.verification_status = new_status
    profile.verification_note = reason if new_status == "REJECTED" else None
    await write_audit(
        db, actor=user, action=action,
        target_type="company", target_id=user_id,
        metadata={"company_name": profile.company_name, "reason": reason or None},
        ip_address=_get_ip(request),
    )
    notification_title = "Company verified" if new_status == "VERIFIED" else "Company verification rejected"
    notification_body = (
        "Your company account has been verified."
        if new_status == "VERIFIED"
        else f"Your company account verification was rejected. Reason: {reason}"
    )
    await notify(db, user_id, "COMPANY_VERIFICATION", notification_title, notification_body)
    company_email = await db.scalar(select(User.email).where(User.id == user_id))
    await db.commit()
    if company_email:
        await send_dev_email(
            company_email,
            notification_title,
            notification_body,
            message_type="COMPANY_VERIFICATION",
            db=db,
        )
    await db.refresh(profile)
    return _company_output(profile)


@router.get("/companies/{company_user_id}/postings", response_model=list[CompanyPostingItem])
async def company_postings(
    company_user_id: int, db: DbSession, user: admin_user, status: str | None = None
) -> list[dict]:
    """List a company's internship postings with applicant counts."""
    query = select(Internship).where(Internship.company_id == company_user_id).order_by(Internship.created_at.desc())
    if status:
        query = query.where(Internship.status == status)
    postings = list(await db.scalars(query))

    posting_ids = [p.id for p in postings]
    applicant_counts: dict[int, int] = {}
    if posting_ids:
        rows = (await db.execute(
            select(Application.internship_id, func.count(Application.id))
            .where(Application.internship_id.in_(posting_ids))
            .group_by(Application.internship_id)
        )).all()
        applicant_counts = {r[0]: r[1] for r in rows}

    return [
        CompanyPostingItem(
            id=p.id,
            title=p.title,
            status=p.status,
            applicant_count=applicant_counts.get(p.id, 0),
            created_at=p.created_at,
        )
        for p in postings
    ] # type: ignore


@router.post("/companies/{company_user_id}/postings/{internship_id}/moderate", response_model=dict)
async def moderate_company_posting(
    company_user_id: int,
    internship_id: int,
    data: ModerationStatus,
    db: DbSession,
    user: admin_user,
    request: Request,
    background_tasks: BackgroundTasks,
) -> dict:
    """Moderate a specific posting belonging to a company."""
    item = await db.get(Internship, internship_id)
    if item is None or item.company_id != company_user_id:
        raise HTTPException(404, "Internship not found for this company")
    if data.status not in {"PUBLISHED", "REJECTED", "CLOSED"}:
        raise HTTPException(400, "Invalid moderation status")
    if data.status == "CLOSED":
        try:
            result = await close_internship_service(db, item, user)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        if result.emails:
            background_tasks.add_task(send_closure_emails, result.emails, db)
        return {
            "id": result.internship.id,
            "status": result.internship.status,
            "closed_at": result.internship.closed_at,
        }
    action_map = {"PUBLISHED": "posting_approved", "REJECTED": "posting_rejected", "CLOSED": "posting_removed"}
    item.status = data.status
    await write_audit(
        db, actor=user, action=action_map[data.status],
        target_type="posting", target_id=internship_id,
        metadata={"title": item.title, "reason": data.reason, "company_user_id": company_user_id},
        ip_address=_get_ip(request),
    )
    action_text = {"PUBLISHED": "approved", "REJECTED": "rejected", "CLOSED": "closed"}[data.status]
    display_title = item.title.replace("_", " ").replace("-", " ").title()
    notification_body = f'Your internship "{display_title}" was {action_text}.'
    if data.status == "REJECTED" and data.reason:
        notification_body += f" Reason: {data.reason.strip()}"
    await notify(
        db,
        item.company_id,
        "INTERNSHIP_REVIEW",
        f"Internship {action_text}",
        notification_body,
    )
    await db.commit()
    return {"id": item.id, "status": item.status}


# ── Internship Moderation Queue ──────────────────────────────────────────────

@router.get("/internships", response_model=list[dict])
async def moderation_queue(db: DbSession, user: admin_user, status: str | None = None) -> list[dict]:
    """List internships awaiting moderation, with their associated company information."""
    query = select(Internship).order_by(Internship.created_at.desc())
    if status:
        query = query.where(Internship.status == status)
    items = list(await db.scalars(query))
    company_ids = {item.company_id for item in items}
    comp_profiles = (
        (await db.scalars(select(CompanyProfile).where(CompanyProfile.user_id.in_(company_ids)))).all()
        if company_ids else []
    )
    comp_map = {cp.user_id: cp.company_name for cp in comp_profiles if cp.company_name}
    return [
        {
            "id": item.id,
            "title": item.title,
            "company_id": item.company_id,
            "company_name": comp_map.get(item.company_id, f"Company #{item.company_id}"),
            "status": item.status,
            "description": item.description,
            "location": item.location,
            "industry": item.industry,
            "stipend": item.stipend,
            "duration_months": item.duration_months,
            "work_mode": item.work_mode,
        }
        for item in items
    ]


@router.post("/internships/{internship_id}/moderate", response_model=dict)
@router.post("/internships/{internship_id}/moderation", response_model=dict)
async def moderate_internship(
    internship_id: int,
    data: ModerationStatus,
    db: DbSession,
    user: admin_user,
    request: Request,
    background_tasks: BackgroundTasks,
) -> dict:
    """Apply the administrator moderation decision to an internship and record the action."""
    item = await db.get(Internship, internship_id)
    if item is None:
        raise HTTPException(404, "Internship not found")
    if data.status not in {"PUBLISHED", "REJECTED", "CLOSED"}:
        raise HTTPException(400, "Invalid moderation status")
    if data.status == "CLOSED":
        try:
            result = await close_internship_service(db, item, user)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        if result.emails:
            background_tasks.add_task(send_closure_emails, result.emails, db)
        return {
            "id": result.internship.id,
            "status": result.internship.status,
            "closed_at": result.internship.closed_at,
        }
    action_map = {"PUBLISHED": "posting_approved", "REJECTED": "posting_rejected", "CLOSED": "posting_removed"}
    item.status = data.status
    await write_audit(
        db, actor=user, action=action_map[data.status],
        target_type="posting", target_id=internship_id,
        metadata={"title": item.title, "reason": data.reason},
        ip_address=_get_ip(request),
    )
    action_text = {"PUBLISHED": "approved", "REJECTED": "rejected", "CLOSED": "closed"}[data.status]
    display_title = item.title.replace("_", " ").replace("-", " ").title()
    notification_body = f'Your internship "{display_title}" was {action_text}.'
    if data.status == "REJECTED" and data.reason:
        notification_body += f" Reason: {data.reason.strip()}"
    await notify(
        db,
        item.company_id,
        "INTERNSHIP_REVIEW",
        f"Internship {action_text}",
        notification_body,
    )
    await db.commit()
    return {"id": item.id, "status": item.status}


# ── Reports ──────────────────────────────────────────────────────────────────

@router.get("/reports", response_model=list[ReportResponse])
async def reports(db: DbSession, user: admin_user, status: str | None = None) -> list[Report]:
    """List reports for administrator review, optionally narrowed by status."""
    query = select(Report).order_by(Report.created_at.desc())
    if status:
        query = query.where(Report.status == status)
    return list(await db.scalars(query))


@router.patch("/reports/{report_id}", response_model=ReportResponse)
async def update_report(
    report_id: int, data: ReportUpdate, db: DbSession, user: admin_user, request: Request
) -> Report:
    """Move a report to an allowed review status and record the administrator action."""
    report = await db.get(Report, report_id)
    if report is None:
        raise HTTPException(404, "Report not found")
    if not report_transition_allowed(report.status, data.status):
        raise HTTPException(409, f"Cannot move {report.status} to {data.status}")
    report.status = data.status
    report.resolution_notes = data.resolution_notes
    await write_audit(
        db, actor=user,
        action="report_resolved" if data.status == "RESOLVED" else "report_status_updated",
        target_type="report", target_id=report_id,
        metadata={"reported_user_id": report.reported_user_id, "status": data.status},
        ip_address=_get_ip(request),
    )
    await db.commit()
    await db.refresh(report)
    return report


# ── Audit Logs ───────────────────────────────────────────────────────────────

@router.get("/audit-logs", response_model=PaginatedAuditLogs)
async def get_audit_logs(
    db: DbSession,
    user: admin_user,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    actor: str | None = Query(None, description="Filter by actor email (partial match)"),
    action: str | None = Query(None, description="Filter by exact action string"),
    target_type: str | None = Query(None, description="Filter by target_type"),
    target_id: int | None = Query(None, description="Filter by target_id"),
    search_target: str | None = Query(None, description="Search resolved target labels"),
    date_from: datetime | None = Query(None, description="ISO datetime lower bound"),
    date_to: datetime | None = Query(None, description="ISO datetime upper bound"),
    range_value: str | None = Query(None, alias="range", pattern="^14d$"),
) -> dict[str, Any]:
    """Paginated, filterable audit log listing. Admin-only."""
    base = select(AuditLog)
    count_base = select(func.count()).select_from(AuditLog)

    filters = []
    if range_value == "14d":
        filters.append(AuditLog.created_at >= datetime.now(timezone.utc) - timedelta(days=14))
    if actor:
        filters.append(AuditLog.actor_email.ilike(f"%{actor}%"))
    if action:
        filters.append(AuditLog.action == action)
    if target_type:
        if target_type.lower() == "internship":
            filters.append(AuditLog.target_type.ilike("internship") | AuditLog.target_type.ilike("posting"))
        else:
            filters.append(AuditLog.target_type.ilike(target_type))
    if target_id is not None:
        filters.append(AuditLog.target_id == target_id)
    if date_from:
        filters.append(AuditLog.created_at >= date_from)
    if date_to:
        filters.append(AuditLog.created_at <= date_to)
    if search_target and search_target.strip():
        target_pattern = f"%{search_target.strip()}%"
        filters.append(or_(
            exists(select(User.id).where(
                User.id == AuditLog.target_id,
                AuditLog.target_type.ilike("user"),
                User.email.ilike(target_pattern),
            )),
            exists(select(Internship.id).outerjoin(
                CompanyProfile, CompanyProfile.user_id == Internship.company_id
            ).where(
                Internship.id == AuditLog.target_id,
                AuditLog.target_type.ilike("internship") | AuditLog.target_type.ilike("posting"),
                or_(Internship.title.ilike(target_pattern), CompanyProfile.company_name.ilike(target_pattern)),
            )),
            exists(select(CompanyProfile.id).where(
                or_(CompanyProfile.user_id == AuditLog.target_id, CompanyProfile.id == AuditLog.target_id),
                AuditLog.target_type.ilike("company"),
                CompanyProfile.company_name.ilike(target_pattern),
            )),
            (
                (AuditLog.target_type.ilike("report"))
                & (cast(AuditLog.target_id, String).ilike(target_pattern))
            ),
        ))

    if filters:
        base = base.where(*filters)
        count_base = count_base.where(*filters)

    total = int(await db.scalar(count_base) or 0)
    rows = list(await db.scalars(
        base.order_by(AuditLog.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ))

    target_user_ids = {a.target_id for a in rows if a.target_id is not None and (a.target_type or "").lower() == "user"}
    target_internship_ids = {a.target_id for a in rows if a.target_id is not None and (a.target_type or "").lower() in {"internship", "posting"}}
    target_company_ids = {a.target_id for a in rows if a.target_id is not None and (a.target_type or "").lower() == "company"}
    actor_ids = {a.actor_id for a in rows if a.actor_id is not None}

    target_users = {}
    if target_user_ids:
        target_users = {
            target.id: target
            for target in await db.scalars(select(User).where(User.id.in_(target_user_ids)))
        }
    target_internships = {}
    if target_internship_ids:
        target_internships = {
            target_id: (title, company_name, company_id)
            for target_id, title, company_name, company_id in (await db.execute(
                select(Internship.id, Internship.title, CompanyProfile.company_name, Internship.company_id)
                .outerjoin(CompanyProfile, CompanyProfile.user_id == Internship.company_id)
                .where(Internship.id.in_(target_internship_ids))
            )).all()
        }
    target_companies = {}
    if target_company_ids:
        company_rows = await db.scalars(select(CompanyProfile).where(
            or_(CompanyProfile.user_id.in_(target_company_ids), CompanyProfile.id.in_(target_company_ids))
        ))
        for company in company_rows:
            target_companies[company.user_id] = company.company_name
            target_companies[company.id] = company.company_name
    actor_roles = {}
    if actor_ids:
        actor_roles = {
            actor_id: actor_role.value
            for actor_id, actor_role in (await db.execute(
                select(User.id, User.role).where(User.id.in_(actor_ids))
            )).all()
        }

    items = []
    for a in rows:
        target_type_normalized = (a.target_type or "").lower()
        target_label = None
        target_url = None
        if a.target_id is not None:
            if target_type_normalized == "user":
                target_user = target_users.get(a.target_id)
                target_label = (
                    "Deleted user"
                    if target_user is None or (target_user.email or "").endswith("@deleted.local")
                    else target_user.email
                )
                target_url = "/admin/users"
            elif target_type_normalized in {"internship", "posting"}:
                resolved = target_internships.get(a.target_id)
                if resolved:
                    title, company_name, company_id = resolved
                    target_label = f"{title} · {company_name or 'Company'}"
                    target_url = f"/admin/companies/{company_id}/postings"
                else:
                    target_label = "Deleted internship"
            elif target_type_normalized == "company":
                target_label = target_companies.get(a.target_id, "Deleted company")
                target_url = f"/admin/companies/{a.target_id}/postings"
            elif target_type_normalized == "report":
                target_label = f"Report #{a.target_id}"
                target_url = "/admin/reports"
        items.append(AuditLogResponse(
            id=a.id,
            actor_id=a.actor_id,
            actor_email=a.actor_email,
            actor_role=actor_roles.get(a.actor_id),
            action=a.action,
            target_type=a.target_type,
            target_id=a.target_id,
            target_label=target_label,
            target_url=target_url,
            metadata=a.metadata_, # type: ignore
            ip_address=a.ip_address,
            created_at=a.created_at,
        ))

    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
    }