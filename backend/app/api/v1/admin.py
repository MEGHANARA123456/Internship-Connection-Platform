# -----------------------------------------------------------------------------
# Admin-only endpoints for managing users, reports, and system-wide operations.
# -----------------------------------------------------------------------------

from datetime import datetime, timezone
from typing import Annotated, Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request
from fastapi.responses import FileResponse
from sqlalchemy import func, select

from app.api.v1.dependencies import DbSession, require_roles
from app.core.config import get_settings
from app.core.security import hash_password
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

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_roles(UserRole.ADMIN))]) # type: ignore
admin_user = Annotated[User, Depends(require_roles(UserRole.ADMIN))] # type: ignore
REPORT_TRANSITIONS = {"OPEN": {"INVESTIGATING"}, "INVESTIGATING": {"RESOLVED"}, "RESOLVED": set()}


def report_transition_allowed(current: str, target: str) -> bool:
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
    async def count(model, *where):
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
) -> list[User]:
    query = select(User).order_by(User.id.desc())
    if search:
        query = query.where(User.email.ilike(f"%{search}%"))
    if role:
        query = query.where(User.role == role)
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
    try:
        email = validate_email_format(data.email)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    if await db.scalar(select(User.id).where(User.email == email)):
        raise HTTPException(status_code=409, detail="Email already registered")

    new_admin = User(
        email=email,
        password_hash=hash_password(data.password),
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
) -> dict:
    """Moderate a specific posting belonging to a company."""
    item = await db.get(Internship, internship_id)
    if item is None or item.company_id != company_user_id:
        raise HTTPException(404, "Internship not found for this company")
    if data.status not in {"PUBLISHED", "REJECTED", "CLOSED"}:
        raise HTTPException(400, "Invalid moderation status")
    action_map = {"PUBLISHED": "posting_approved", "REJECTED": "posting_rejected", "CLOSED": "posting_removed"}
    item.status = data.status
    await write_audit(
        db, actor=user, action=action_map[data.status],
        target_type="posting", target_id=internship_id,
        metadata={"title": item.title, "reason": data.reason, "company_user_id": company_user_id},
        ip_address=_get_ip(request),
    )
    action_text = {"PUBLISHED": "approved", "REJECTED": "rejected", "CLOSED": "closed"}[data.status]
    await notify(
        db,
        item.company_id,
        "INTERNSHIP_REVIEW",
        f"Internship {action_text}",
        f"Your internship {item.title} was {action_text}.",
    )
    await db.commit()
    return {"id": item.id, "status": item.status}


# ── Internship Moderation Queue ──────────────────────────────────────────────

@router.get("/internships", response_model=list[dict])
async def moderation_queue(db: DbSession, user: admin_user, status: str | None = None) -> list[dict]:
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
    internship_id: int, data: ModerationStatus, db: DbSession, user: admin_user, request: Request
) -> dict:
    item = await db.get(Internship, internship_id)
    if item is None:
        raise HTTPException(404, "Internship not found")
    if data.status not in {"PUBLISHED", "REJECTED", "CLOSED"}:
        raise HTTPException(400, "Invalid moderation status")
    action_map = {"PUBLISHED": "posting_approved", "REJECTED": "posting_rejected", "CLOSED": "posting_removed"}
    item.status = data.status
    await write_audit(
        db, actor=user, action=action_map[data.status],
        target_type="posting", target_id=internship_id,
        metadata={"title": item.title, "reason": data.reason},
        ip_address=_get_ip(request),
    )
    action_text = {"PUBLISHED": "approved", "REJECTED": "rejected", "CLOSED": "closed"}[data.status]
    await notify(
        db,
        item.company_id,
        "INTERNSHIP_REVIEW",
        f"Internship {action_text}",
        f"Your internship {item.title} was {action_text}.",
    )
    await db.commit()
    return {"id": item.id, "status": item.status}


# ── Reports ──────────────────────────────────────────────────────────────────

@router.get("/reports", response_model=list[ReportResponse])
async def reports(db: DbSession, user: admin_user, status: str | None = None) -> list[Report]:
    query = select(Report).order_by(Report.created_at.desc())
    if status:
        query = query.where(Report.status == status)
    return list(await db.scalars(query))


@router.patch("/reports/{report_id}", response_model=ReportResponse)
async def update_report(
    report_id: int, data: ReportUpdate, db: DbSession, user: admin_user, request: Request
) -> Report:
    report = await db.get(Report, report_id)
    if report is None:
        raise HTTPException(404, "Report not found")
    if not report_transition_allowed(report.status, data.status):
        raise HTTPException(409, f"Cannot move {report.status} to {data.status}")
    report.status = data.status
    report.resolution_notes = data.resolution_notes
    if data.status == "RESOLVED":
        await write_audit(
            db, actor=user, action="report_resolved",
            target_type="user", target_id=report.reported_user_id,
            metadata={"report_id": report_id, "resolution_notes": data.resolution_notes},
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
    date_from: datetime | None = Query(None, description="ISO datetime lower bound"),
    date_to: datetime | None = Query(None, description="ISO datetime upper bound"),
) -> dict[str, Any]:
    """Paginated, filterable audit log listing. Admin-only."""
    base = select(AuditLog)
    count_base = select(func.count()).select_from(AuditLog)

    filters = []
    if actor:
        filters.append(AuditLog.actor_email.ilike(f"%{actor}%"))
    if action:
        filters.append(AuditLog.action == action)
    if target_type:
        filters.append(AuditLog.target_type == target_type)
    if target_id is not None:
        filters.append(AuditLog.target_id == target_id)
    if date_from:
        filters.append(AuditLog.created_at >= date_from)
    if date_to:
        filters.append(AuditLog.created_at <= date_to)

    if filters:
        base = base.where(*filters)
        count_base = count_base.where(*filters)

    total = int(await db.scalar(count_base) or 0)
    rows = list(await db.scalars(
        base.order_by(AuditLog.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ))

    items = [
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
        for a in rows
    ]

    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
    }