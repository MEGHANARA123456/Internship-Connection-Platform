# -----------------------------------------------------------------------------
# Admin-only endpoints for managing users, reports, and system-wide operations.
# -----------------------------------------------------------------------------

from datetime import date, datetime, timedelta, timezone
from typing import Annotated, Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request
from fastapi.responses import FileResponse
from sqlalchemy import String, case, cast, exists, func, or_, select
from sqlalchemy.sql import ColumnElement

from app.api.v1.dependencies import DbSession, require_roles
from app.core.config import get_settings
from app.core.security import hash_password_async
from app.models import (
    Application,
    AuditLog,
    CompanyDocument,
    CompanyProfile,
    Internship,
    Interview,
    Report,
    SkillAttempt,
    SkillBadge,
    SkillLearningResource,
    SkillQuestion,
    SkillTopic,
    User,
    UserRole,
)
from app.models.user import StudentProfile
from app.schemas.admin import (
    AdminCompanyDetail,
    AdminCompanyDocument,
    AdminCompanyListItem,
    AdminCompanyMetrics,
    AdminCompanyPosting,
    AdminCompanyProfile,
    AdminDetailAccount,
    AdminPage,
    AdminSkillAttempt,
    AdminSkillBadge,
    AdminStudentApplication,
    AdminStudentDetail,
    AdminStudentInterview,
    AdminStudentListItem,
    AdminStudentProfile,
    AdminVerificationEvent,
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
from app.services.audit import audit_target_id_response, write_audit
from app.services.reporting_ranges import reporting_range_cutoff
from app.services.search_matching import escape_search_term, search_conditions
from app.services.company_metrics import get_company_metrics, get_company_metrics_batch
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


def _metadata_target_label(metadata: dict[str, Any] | None) -> str | None:
    """Build a readable target description from audit metadata when no row is available."""
    if not metadata:
        return None
    for source in (metadata, metadata.get("after"), metadata.get("before")):
        if not isinstance(source, dict):
            continue
        topic_name = source.get("topic_name")
        topic_key = source.get("topic_key") or source.get("topic")
        if topic_name or topic_key:
            topic = str(topic_name or topic_key)
            if topic_key and topic_name and str(topic_name).casefold() != str(topic_key).casefold():
                topic = f"{topic_name} ({topic_key})"
            return f"Skill topic: {topic}"
        title = source.get("title") or source.get("name")
        if title:
            return str(title)
        prompt = source.get("prompt")
        if prompt:
            text = " ".join(str(prompt).split())
            return text[:60] + ("..." if len(text) > 60 else "")
        filename = source.get("file_name") or source.get("filename")
        if filename:
            return f"File: {filename}"
        count = source.get("count") or source.get("imported_count")
        if count is not None:
            return f"{count} records"
        topics = source.get("topics")
        if isinstance(topics, list) and topics:
            return f"Topics: {', '.join(str(topic) for topic in topics[:3])}"
    return None


def _numeric_audit_target_id(target_id: int | str | None) -> int | None:
    if isinstance(target_id, int):
        return target_id
    if isinstance(target_id, str) and target_id.isdecimal():
        return int(target_id)
    return None


def _humanize_target_type(target_type: str) -> str:
    """Convert an unknown target type into a compact display label."""
    label = " ".join(part.lower() for part in target_type.replace("-", "_").split("_"))
    return label[:1].upper() + label[1:]


def _get_ip(request: Request) -> str | None:
    """Extract client IP from request, honouring X-Forwarded-For."""
    xff = request.headers.get("X-Forwarded-For")
    if xff:
        return xff.split(",")[0].strip()
    if request.client:
        return request.client.host
    return None


def _escaped_search_term(term: str) -> str:
    """Escape SQL LIKE metacharacters so admin search treats them literally."""
    return escape_search_term(term)


def _search_words(
    query: str,
    fields: tuple[ColumnElement[Any], ...],
    *,
    postgres: bool = False,
) -> list[ColumnElement[bool]]:
    """Require each normalized word to match a searchable field, including PostgreSQL trigram matches."""
    return search_conditions(query[:100], fields, postgres=postgres)


async def _audit_filter_usage(
    db: Any,
    actor: User,
    action: str,
    filter_names: list[str],
) -> None:
    """Record which filters were used without retaining search text or filter values."""
    await write_audit(
        db,
        actor=actor,
        action=action,
        metadata={"filters": sorted(set(filter_names))},
    )
    await db.commit()


async def _audit_detail_view(
    db: Any,
    actor: User,
    action: str,
    target_type: str,
    target_id: int,
    request: Request,
) -> None:
    """Audit sensitive detail views at most once per admin, target, and five minutes."""
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=5)
    recent = await db.scalar(
        select(AuditLog.id)
        .where(
            AuditLog.actor_id == actor.id,
            AuditLog.action == action,
            AuditLog.target_type == target_type,
            AuditLog.target_id == target_id,
            AuditLog.created_at >= cutoff,
        )
        .limit(1)
    )
    if recent is not None:
        return
    await write_audit(
        db,
        actor=actor,
        action=action,
        target_type=target_type,
        target_id=target_id,
        metadata={"user_id": target_id},
        ip_address=_get_ip(request),
    )
    await db.commit()


def _admin_account(user: User) -> AdminDetailAccount:
    """Return only the account fields allowed in admin detail views."""
    return AdminDetailAccount(
        user_id=user.id,
        email=user.email,
        is_active=user.is_active,
        is_verified=user.is_verified,
        mfa_enabled=user.mfa_enabled,
        suspended_at=user.suspended_at,
        created_at=user.created_at,
    )


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
        escaped = _escaped_search_term(search.strip()[:100])
        query = query.where(User.email.ilike(f"%{escaped}%", escape="\\"))
    if role:
        query = query.where(User.role == role)
    if created == "this_month":
        now = datetime.now(timezone.utc)
        month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        query = query.where(User.created_at >= month_start)
    if not include_suspended:
        query = query.where(User.suspended_at.is_(None))
    return list(await db.scalars(query))


@router.get("/students", response_model=AdminPage[AdminStudentListItem])
async def list_admin_students(
    db: DbSession,
    user: admin_user,
    request: Request,
    q: str | None = Query(None, max_length=100),
    verified: bool | None = None,
    suspended: bool | None = None,
    graduation_year: int | None = None,
    university: str | None = Query(None, max_length=100),
    created: str | None = Query(None, pattern="^this_month$"),
    sort: str = "created_at",
    order: str = Query("desc", pattern="^(asc|desc)$"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
) -> AdminPage[AdminStudentListItem]:
    """Return paginated students; counts are aggregated by grouped subqueries to avoid N+1 queries."""
    app_counts = (
        select(Application.student_id.label("student_id"), func.count(Application.id).label("count"))
        .group_by(Application.student_id)
        .subquery()
    )
    badge_counts = (
        select(SkillBadge.student_id.label("student_id"), func.count(SkillBadge.id).label("count"))
        .where(SkillBadge.expires_at > datetime.now(timezone.utc))
        .group_by(SkillBadge.student_id)
        .subquery()
    )
    query = (
        select(
            User,
            StudentProfile,
            func.coalesce(app_counts.c.count, 0).label("applications_count"),
            func.coalesce(badge_counts.c.count, 0).label("badges_count"),
        )
        .outerjoin(StudentProfile, StudentProfile.user_id == User.id)
        .outerjoin(app_counts, app_counts.c.student_id == User.id)
        .outerjoin(badge_counts, badge_counts.c.student_id == User.id)
        .where(User.role == UserRole.STUDENT)
    )
    count_query = (
        select(func.count(User.id))
        .outerjoin(StudentProfile, StudentProfile.user_id == User.id)
        .where(User.role == UserRole.STUDENT)
    )
    if q and q.strip():
        conditions = _search_words(
            q,
            (StudentProfile.full_name, User.email, StudentProfile.university, StudentProfile.major, StudentProfile.skills),
            postgres=db.get_bind().dialect.name == "postgresql",
        )
        query = query.where(*conditions)
        count_query = count_query.where(*conditions)
    if verified is not None:
        query = query.where(User.is_verified.is_(verified))
        count_query = count_query.where(User.is_verified.is_(verified))
    if suspended is not None:
        condition = User.suspended_at.is_not(None) if suspended else User.suspended_at.is_(None)
        query = query.where(condition)
        count_query = count_query.where(condition)
    if graduation_year is not None:
        query = query.where(StudentProfile.graduation_year == graduation_year)
        count_query = count_query.where(StudentProfile.graduation_year == graduation_year)
    if university and university.strip():
        university_condition = StudentProfile.university.ilike(
            f"%{_escaped_search_term(university.strip()[:100])}%", escape="\\"
        )
        query = query.where(university_condition)
        count_query = count_query.where(university_condition)
    if created == "this_month":
        now = datetime.now(timezone.utc)
        month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        query = query.where(User.created_at >= month_start)
        count_query = count_query.where(User.created_at >= month_start)

    sort_fields: dict[str, ColumnElement[Any]] = {
        "created_at": User.created_at,
        "full_name": StudentProfile.full_name,
        "email": User.email,
        "university": StudentProfile.university,
        "major": StudentProfile.major,
        "graduation_year": StudentProfile.graduation_year,
        "applications_count": func.coalesce(app_counts.c.count, 0),
        "badges_count": func.coalesce(badge_counts.c.count, 0),
    }
    if sort not in sort_fields:
        raise HTTPException(422, detail="Unsupported student sort field")
    sort_column = sort_fields[sort]
    query = query.order_by(
        (sort_column.asc() if order == "asc" else sort_column.desc()),
        User.id.asc(),
    ).offset((page - 1) * page_size).limit(page_size)
    rows = (await db.execute(query)).all()
    total = int(await db.scalar(count_query) or 0)
    filter_names = [
        key for key, value in {
            "q": q,
            "verified": verified,
            "suspended": suspended,
            "graduation_year": graduation_year,
            "university": university,
            "created": created,
        }.items() if value is not None and value != ""
    ]
    await _audit_filter_usage(db, user, "admin_listed_students", filter_names)
    items = [
        AdminStudentListItem(
            user_id=account.id,
            full_name=profile.full_name if profile else None,
            email=account.email,
            university=profile.university if profile else None,
            major=profile.major if profile else None,
            graduation_year=profile.graduation_year if profile else None,
            skills=[skill.strip() for skill in (profile.skills or "").split(",") if skill.strip()][:3] if profile else [],
            is_verified=account.is_verified,
            suspended_at=account.suspended_at,
            created_at=account.created_at,
            applications_count=int(applications_count),
            badges_count=int(badges_count),
            avatar_url=profile.avatar_url if profile else None,
        )
        for account, profile, applications_count, badges_count in rows
    ]
    return AdminPage(items=items, total=total, page=page, page_size=page_size)


@router.get("/students/{user_id}", response_model=AdminStudentDetail)
async def get_admin_student_detail(
    user_id: int,
    db: DbSession,
    user: admin_user,
    request: Request,
) -> AdminStudentDetail:
    """Return a student detail view without credentials, assessment answers, or question snapshots."""
    student = await db.get(User, user_id)
    if student is None or student.role != UserRole.STUDENT:
        raise HTTPException(404, detail="Student not found")
    await _audit_detail_view(db, user, "admin_viewed_student", "user", user_id, request)
    profile = await db.scalar(select(StudentProfile).where(StudentProfile.user_id == user_id))

    applications_total = int(await db.scalar(
        select(func.count(Application.id)).where(Application.student_id == user_id)
    ) or 0)
    application_rows = (await db.execute(
        select(
            Application.id,
            Application.status,
            Internship.title,
            Internship.company_id,
            CompanyProfile.company_name,
            Application.created_at,
        )
        .join(Internship, Internship.id == Application.internship_id)
        .outerjoin(CompanyProfile, CompanyProfile.user_id == Internship.company_id)
        .where(Application.student_id == user_id)
        .order_by(Application.created_at.desc(), Application.id.desc())
        .limit(50)
    )).all()
    interviews = (await db.execute(
        select(
            Interview.scheduled_at,
            Interview.status,
            Internship.title,
            CompanyProfile.company_name,
        )
        .join(Application, Application.id == Interview.application_id)
        .join(Internship, Internship.id == Application.internship_id)
        .outerjoin(CompanyProfile, CompanyProfile.user_id == Internship.company_id)
        .where(Application.student_id == user_id)
        .order_by(Interview.scheduled_at.desc(), Interview.id.desc())
    )).all()
    attempts = list(await db.scalars(
        select(SkillAttempt)
        .where(SkillAttempt.student_id == user_id, SkillAttempt.submitted_at.is_not(None))
        .order_by(SkillAttempt.submitted_at.desc(), SkillAttempt.id.desc())
        .limit(20)
    ))
    badges = list(await db.scalars(
        select(SkillBadge)
        .where(SkillBadge.student_id == user_id)
        .order_by(SkillBadge.earned_at.desc(), SkillBadge.id.desc())
    ))
    audit_rows = list(await db.scalars(
        select(AuditLog)
        .where(AuditLog.target_type == "user", cast(User.id, String) == AuditLog.target_id)
        .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
        .limit(10)
    ))
    now = datetime.now(timezone.utc)
    return AdminStudentDetail(
        account=_admin_account(student),
        profile=AdminStudentProfile(
            full_name=profile.full_name,
            university=profile.university,
            major=profile.major,
            graduation_year=profile.graduation_year,
            bio=profile.bio,
            skills=profile.skills,
            institution_email=profile.institution_email,
            avatar_url=profile.avatar_url,
            show_verified_badges=profile.show_verified_badges,
        ) if profile else None,
        applications=[
            AdminStudentApplication(
                id=row.id,
                internship_title=row.title,
                company_name=row.company_name or f"Company #{row.company_id}",
                status=row.status,
                created_at=row.created_at,
            ) for row in application_rows
        ],
        applications_total=applications_total,
        interviews=[
            AdminStudentInterview(
                date=row.scheduled_at,
                status=row.status,
                internship_title=row.title,
                company_name=row.company_name or "Company",
            ) for row in interviews
        ],
        assessment_attempts=[
            AdminSkillAttempt(
                topic=attempt.topic,
                score=attempt.weighted_percentage if attempt.weighted_percentage is not None else attempt.score,
                passed=attempt.passed,
                submitted_at=attempt.submitted_at,
            ) for attempt in attempts if attempt.submitted_at is not None
        ],
        badges=[
            AdminSkillBadge(
                topic=badge.topic,
                title=badge.title,
                level=badge.level,
                score=badge.score,
                issued_at=badge.earned_at,
                expires_at=badge.expires_at,
                valid=badge.expires_at > now,
            ) for badge in badges
        ],
        recent_audit_events=[AuditLogResponse.model_validate(row) for row in audit_rows],
    )


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
            target_id=audit_target_id_response(a.target_id),
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
    user_id: int, document_id: int, db: DbSession, user: admin_user, request: Request
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
    await write_audit(
        db,
        actor=user,
        action="admin_downloaded_company_document",
        target_type="company",
        target_id=user_id,
        metadata={"company_user_id": user_id, "document_id": document_id},
        ip_address=_get_ip(request),
    )
    await db.commit()
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


@router.get(
    "/companies",
    response_model=AdminPage[AdminCompanyListItem] | list[CompanyListItem],
)
async def list_all_companies(
    db: DbSession,
    user: admin_user,
    q: str | None = Query(None, max_length=100),
    search: str | None = Query(None, max_length=100),
    verification_status: str | None = Query(None, pattern="^(PENDING|VERIFIED|REJECTED)$"),
    created: str | None = Query(None, pattern="^this_month$"),
    sort: str = "created_at",
    order: str = Query("desc", pattern="^(asc|desc)$"),
    page: int | None = Query(None, ge=1),
    page_size: int | None = Query(None, ge=1, le=100),
) -> AdminPage[AdminCompanyListItem] | list[CompanyListItem]:
    """Return paginated company rows with grouped role/applicant counts and a legacy array fallback."""
    query_text = q if q is not None else search
    role_counts = (
        select(
            Internship.company_id.label("company_id"),
            func.count(Internship.id).label("posting_count"),
            func.sum(case(
                (
                    (Internship.status == "PUBLISHED") & (Internship.deadline >= date.today()),
                    1,
                ),
                else_=0,
            )).label("active_roles"),
        )
        .group_by(Internship.company_id)
        .subquery()
    )
    applicant_counts = (
        select(
            Internship.company_id.label("company_id"),
            func.count(Application.id).label("total_applicants"),
        )
        .join(Application, Application.internship_id == Internship.id)
        .where(Application.status != "WITHDRAWN")
        .group_by(Internship.company_id)
        .subquery()
    )
    query = (
        select(
            CompanyProfile,
            User,
            func.coalesce(role_counts.c.posting_count, 0).label("posting_count"),
            func.coalesce(role_counts.c.active_roles, 0).label("active_roles"),
            func.coalesce(applicant_counts.c.total_applicants, 0).label("total_applicants"),
        )
        .join(User, User.id == CompanyProfile.user_id)
        .outerjoin(role_counts, role_counts.c.company_id == CompanyProfile.user_id)
        .outerjoin(applicant_counts, applicant_counts.c.company_id == CompanyProfile.user_id)
        .where(User.role == UserRole.COMPANY)
    )
    count_query = (
        select(func.count(CompanyProfile.id))
        .join(User, User.id == CompanyProfile.user_id)
        .where(User.role == UserRole.COMPANY)
    )
    if query_text and query_text.strip():
        conditions = _search_words(
            query_text,
            (
                CompanyProfile.company_name,
                CompanyProfile.industry,
                CompanyProfile.location,
                CompanyProfile.recruiter_contact_name,
                CompanyProfile.recruiter_contact_email,
            ),
            postgres=db.get_bind().dialect.name == "postgresql",
        )
        query = query.where(*conditions)
        count_query = count_query.where(*conditions)
    if verification_status:
        query = query.where(CompanyProfile.verification_status == verification_status)
        count_query = count_query.where(CompanyProfile.verification_status == verification_status)
    if created == "this_month":
        now = datetime.now(timezone.utc)
        month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        query = query.where(User.created_at >= month_start)
        count_query = count_query.where(User.created_at >= month_start)

    sort_fields: dict[str, ColumnElement[Any]] = {
        "created_at": User.created_at,
        "company_name": CompanyProfile.company_name,
        "industry": CompanyProfile.industry,
        "location": CompanyProfile.location,
        "verification_status": CompanyProfile.verification_status,
        "posting_count": func.coalesce(role_counts.c.posting_count, 0),
        "active_roles": func.coalesce(role_counts.c.active_roles, 0),
        "total_applicants": func.coalesce(applicant_counts.c.total_applicants, 0),
    }
    if sort not in sort_fields:
        raise HTTPException(422, detail="Unsupported company sort field")
    sort_column = sort_fields[sort]
    query = query.order_by(
        (sort_column.asc() if order == "asc" else sort_column.desc()),
        CompanyProfile.user_id.asc(),
    )
    total = int(await db.scalar(count_query) or 0)
    legacy_response = page is None and page_size is None
    effective_page = page or 1
    effective_page_size = page_size or 20
    if not legacy_response:
        query = query.offset((effective_page - 1) * effective_page_size).limit(effective_page_size)
    company_rows = list(await db.execute(query))

    user_ids = [profile.user_id for profile, _, _, _, _ in company_rows]
    metrics_by_company = await get_company_metrics_batch(db, user_ids)
    filter_names = [
        key for key, value in {
            "q": query_text,
            "verification_status": verification_status,
            "created": created,
        }.items() if value is not None and value != ""
    ]
    await _audit_filter_usage(db, user, "admin_listed_companies", filter_names)
    if legacy_response:
        return [
            CompanyListItem(
                id=profile.id,
                user_id=profile.user_id,
                company_name=profile.company_name,
                industry=profile.industry,
                website=profile.website,
                verification_status=profile.verification_status,
                verification_note=profile.verification_note,
                posting_count=int(postings),
            )
            for profile, _, postings, _, _ in company_rows
        ]
    return AdminPage(
        items=[
            AdminCompanyListItem(
                user_id=profile.user_id,
                company_name=profile.company_name,
                industry=profile.industry,
                location=profile.location,
                company_size=profile.company_size,
                verification_status=profile.verification_status,
                posting_count=int(postings),
                active_roles=metrics_by_company.get(profile.user_id, {}).get("active_roles", 0),
                total_applicants=metrics_by_company.get(profile.user_id, {}).get("total_applicants", 0),
                created_at=account.created_at,
                suspended_at=account.suspended_at,
            )
            for profile, account, postings, active_roles, applicants in company_rows
        ],
        total=total,
        page=effective_page,
        page_size=effective_page_size,
    )


@router.get("/companies/{user_id}", response_model=AdminCompanyDetail)
async def get_admin_company_detail(
    user_id: int,
    db: DbSession,
    user: admin_user,
    request: Request,
) -> AdminCompanyDetail:
    """Return company profile, canonical metrics, moderation history, documents, and postings."""
    account = await db.get(User, user_id)
    if account is None or account.role != UserRole.COMPANY:
        raise HTTPException(404, detail="Company not found")
    profile = await db.scalar(
        select(CompanyProfile).where(CompanyProfile.user_id == user_id)
    )
    if profile is None:
        raise HTTPException(404, detail="Company profile not found")
    await _audit_detail_view(db, user, "admin_viewed_company", "company", user_id, request)

    documents = list(await db.scalars(
        select(CompanyDocument)
        .where(CompanyDocument.company_id == user_id)
        .order_by(CompanyDocument.created_at.desc(), CompanyDocument.id.desc())
    ))
    postings_total = int(await db.scalar(
        select(func.count(Internship.id)).where(Internship.company_id == user_id)
    ) or 0)
    postings_rows = (await db.execute(
        select(
            Internship,
            func.count(case((Application.status != "WITHDRAWN", Application.id))).label("applicant_count"),
        )
        .outerjoin(Application, Application.internship_id == Internship.id)
        .where(Internship.company_id == user_id)
        .group_by(Internship.id)
        .order_by(Internship.created_at.desc(), Internship.id.desc())
        .limit(50)
    )).all()
    metric_values = await get_company_metrics(db, user_id)
    verification_rows = list(await db.scalars(
        select(AuditLog)
        .where(
            AuditLog.target_type == "company",
            AuditLog.target_id == user_id,
            AuditLog.action.in_(("company_verified", "company_rejected")),
        )
        .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
    ))
    recent_audit_rows = list(await db.scalars(
        select(AuditLog)
        .where(
            AuditLog.target_id == user_id,
            AuditLog.target_type.in_(("company", "user")),
        )
        .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
        .limit(10)
    ))
    return AdminCompanyDetail(
        account=_admin_account(account),
        profile=AdminCompanyProfile(
            company_name=profile.company_name,
            industry=profile.industry,
            website=profile.website,
            description=profile.description,
            company_size=profile.company_size,
            location=profile.location,
            recruiter_contact_name=profile.recruiter_contact_name,
            recruiter_contact_phone=profile.recruiter_contact_phone,
            recruiter_contact_email=profile.recruiter_contact_email,
            verification_status=profile.verification_status,
            verification_note=profile.verification_note,
        ),
        documents=[
            AdminCompanyDocument(
                id=document.id,
                document_type=document.document_type,
                original_filename=document.original_filename,
                file_size=document.file_size,
                uploaded_at=document.created_at,
            ) for document in documents
        ],
        postings=[
            AdminCompanyPosting(
                id=posting.id,
                title=posting.title,
                status=posting.status,
                deadline=posting.deadline,
                applicant_count=int(applicant_count),
                created_at=posting.created_at,
            ) for posting, applicant_count in postings_rows
        ],
        postings_total=postings_total,
        metrics=AdminCompanyMetrics(
            active_roles=metric_values["active_roles"],
            total_internships=metric_values["total_roles"],
            total_applicants=metric_values["total_applicants"],
            shortlisted=metric_values["shortlisted"],
            interviews_scheduled=metric_values["interviews_scheduled"],
            offers=metric_values["offers"],
        ),
        verification_history=[
            AdminVerificationEvent(
                action=event.action,
                actor_email=event.actor_email,
                date=event.created_at,
                reason=(event.metadata_ or {}).get("reason"),
            ) for event in verification_rows
        ],
        recent_audit_events=[AuditLogResponse.model_validate(row) for row in recent_audit_rows],
    )


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
    target_id: str | None = Query(None, description="Filter by target_id"),
    search_target: str | None = Query(None, description="Search resolved target labels"),
    date_from: datetime | None = Query(None, description="ISO datetime lower bound"),
    date_to: datetime | None = Query(None, description="ISO datetime upper bound"),
    range_value: str | None = Query(
        None, alias="range", pattern="^(7d|14d|30d|90d|all|7|30|90)$"
    ),
) -> dict[str, Any]:
    """Paginated, filterable audit log listing. Admin-only."""
    base = select(AuditLog)
    count_base = select(func.count()).select_from(AuditLog)

    filters = []
    range_cutoff = reporting_range_cutoff(range_value)
    if range_cutoff is not None:
        filters.append(AuditLog.created_at >= range_cutoff)
    if actor:
        escaped_actor = _escaped_search_term(actor.strip()[:100])
        filters.append(AuditLog.actor_email.ilike(f"%{escaped_actor}%", escape="\\"))
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
        target_pattern = f"%{_escaped_search_term(search_target.strip()[:100])}%"
        filters.append(or_(
            exists(select(User.id).where(
                cast(User.id, String) == AuditLog.target_id,
                AuditLog.target_type.ilike("user"),
                User.email.ilike(target_pattern, escape="\\"),
            )),
            exists(select(Internship.id).outerjoin(
                CompanyProfile, CompanyProfile.user_id == Internship.company_id
            ).where(
                cast(Internship.id, String) == AuditLog.target_id,
                AuditLog.target_type.ilike("internship") | AuditLog.target_type.ilike("posting"),
                or_(
                    Internship.title.ilike(target_pattern, escape="\\"),
                    CompanyProfile.company_name.ilike(target_pattern, escape="\\"),
                ),
            )),
            exists(select(CompanyProfile.id).where(
                or_(
                    cast(CompanyProfile.user_id, String) == AuditLog.target_id,
                    cast(CompanyProfile.id, String) == AuditLog.target_id,
                ),
                AuditLog.target_type.ilike("company"),
                CompanyProfile.company_name.ilike(target_pattern, escape="\\"),
            )),
            (
                (AuditLog.target_type.ilike("report"))
                & (cast(AuditLog.target_id, String).ilike(target_pattern, escape="\\"))
            ),
            cast(AuditLog.metadata_, String).ilike(target_pattern, escape="\\"),
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

    target_user_ids = {
        target_id for a in rows
        if (a.target_type or "").lower() == "user"
        and (target_id := _numeric_audit_target_id(a.target_id)) is not None
    }
    target_internship_ids = {
        target_id for a in rows
        if (a.target_type or "").lower() in {"internship", "posting"}
        and (target_id := _numeric_audit_target_id(a.target_id)) is not None
    }
    target_company_ids = {
        target_id for a in rows
        if (a.target_type or "").lower() == "company"
        and (target_id := _numeric_audit_target_id(a.target_id)) is not None
    }
    target_question_ids = {
        target_id for a in rows
        if (a.target_type or "").lower() == "skill_question"
        and (target_id := _numeric_audit_target_id(a.target_id)) is not None
    }
    target_resource_ids = {
        target_id for a in rows
        if (a.target_type or "").lower() == "skill_learning_resource"
        and (target_id := _numeric_audit_target_id(a.target_id)) is not None
    }
    target_topic_keys = {
        str(key)
        for a in rows
        if (a.target_type or "").lower() == "skill_topic"
        for key in (a.target_id, *((a.metadata_ or {}).get("topic_key"), (a.metadata_ or {}).get("topic")))
        if key
    }
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
    target_questions = {}
    if target_question_ids:
        target_questions = {
            question.id: (question.topic, question.prompt)
            for question in await db.scalars(
                select(SkillQuestion).where(SkillQuestion.id.in_(target_question_ids))
            )
        }
    target_resources = {}
    if target_resource_ids:
        target_resources = {
            resource.id: resource.title
            for resource in await db.scalars(
                select(SkillLearningResource).where(
                    SkillLearningResource.id.in_(target_resource_ids)
                )
            )
        }
    target_topics = {}
    if target_topic_keys:
        target_topics = {
            topic.slug: topic.name
            for topic in await db.scalars(
                select(SkillTopic).where(SkillTopic.slug.in_(target_topic_keys))
            )
        }
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
        metadata_label = _metadata_target_label(a.metadata_)
        if a.target_id is not None:
            numeric_target_id = _numeric_audit_target_id(a.target_id)
            if target_type_normalized == "user":
                target_user = target_users.get(numeric_target_id)
                target_label = (
                    "Deleted user"
                    if target_user is None or (target_user.email or "").endswith("@deleted.local")
                    else target_user.email
                )
                target_url = "/admin/users"
            elif target_type_normalized in {"internship", "posting"}:
                resolved = target_internships.get(numeric_target_id)
                if resolved:
                    title, company_name, company_id = resolved
                    target_label = f"{title} · {company_name or 'Company'}"
                    target_url = f"/admin/companies/{company_id}/postings"
                else:
                    target_label = "Deleted internship"
            elif target_type_normalized == "company":
                target_label = target_companies.get(numeric_target_id, "Deleted company")
                target_url = f"/admin/companies/{numeric_target_id}/postings"
            elif target_type_normalized == "report":
                target_label = f"Report #{a.target_id}"
                target_url = "/admin/reports"
            elif target_type_normalized == "skill_topic":
                topic_key = (
                    (a.metadata_ or {}).get("topic_key")
                    or (a.metadata_ or {}).get("topic")
                )
                if topic_key:
                    topic_name = target_topics.get(str(topic_key))
                    target_label = f"Skill topic: {topic_name or topic_key}"
                else:
                    target_label = f"Skill topic #{a.target_id}"
            elif target_type_normalized == "skill_question":
                question = target_questions.get(numeric_target_id)
                if question:
                    topic, prompt = question
                    prompt_preview = " ".join(prompt.split())[:60]
                    if len(" ".join(prompt.split())) > 60:
                        prompt_preview += "..."
                    target_label = f"{topic}: {prompt_preview}"
                else:
                    target_label = "Deleted question"
            elif target_type_normalized == "skill_learning_resource":
                target_label = target_resources.get(numeric_target_id, "Deleted resource")
            else:
                target_label = metadata_label or (
                    f"{_humanize_target_type(target_type_normalized)} #{a.target_id}"
                )
        elif target_type_normalized == "skill_topic" and metadata_label:
            target_label = metadata_label
        elif target_type_normalized == "skill_question":
            metadata = a.metadata_ or {}
            question_context = metadata.get("after", metadata)
            prompt = question_context.get("prompt") if isinstance(question_context, dict) else None
            topic = question_context.get("topic") if isinstance(question_context, dict) else None
            if prompt:
                prompt_text = " ".join(str(prompt).split())
                prompt_preview = prompt_text[:60] + ("..." if len(prompt_text) > 60 else "")
                target_label = f"{topic}: {prompt_preview}" if topic else prompt_preview
            else:
                target_label = metadata_label or "Deleted question"
        elif target_type_normalized == "skill_learning_resource":
            metadata = a.metadata_ or {}
            resource_context = metadata.get("after", metadata)
            resource_title = (
                resource_context.get("title")
                if isinstance(resource_context, dict)
                else None
            )
            target_label = resource_title or metadata_label or "Deleted resource"
        elif target_type_normalized:
            target_label = metadata_label or _humanize_target_type(target_type_normalized)
        else:
            target_label = metadata_label or "System-wide"
        items.append(AuditLogResponse(
            id=a.id,
            actor_id=a.actor_id,
            actor_email=a.actor_email,
            actor_role=actor_roles.get(a.actor_id),
            action=a.action,
            target_type=a.target_type,
            target_id=audit_target_id_response(a.target_id),
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