# -----------------------------------------------------------------------------
# Internship listing, filtering, and management endpoints.
# -----------------------------------------------------------------------------

from datetime import date, datetime, timezone
from typing import Annotated
import logging
import re

from fastapi import APIRouter, BackgroundTasks, Body, Depends, HTTPException, Query
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError

from app.api.v1.dependencies import DbSession, get_current_user, get_current_user_optional, require_roles
from app.models import Application, CompanyProfile, Interview, Internship, SavedInternship, StudentProfile, User, UserRole
from app.schemas.internship import InternshipCloseRequest, InternshipInput, InternshipPage, InternshipResponse
from app.services.ai import compute_explicit_eligibility_fit, compute_match_score_fast, get_student_resume_text
from app.services.audit import write_audit
from app.services.skill_badges import apply_verified_badge_boost, get_valid_badges
from app.services.mail import send_dev_email
from app.services.notify import notify
from app.services.internship_closing import close_internship as close_internship_service, send_closure_emails

router = APIRouter(prefix="/internships", tags=["internships"])
logger = logging.getLogger(__name__)
company_only = Annotated[User, Depends(require_roles(UserRole.COMPANY))]  # type: ignore
student_only = Annotated[User, Depends(require_roles(UserRole.STUDENT))] # type: ignore
admin_only = Annotated[User, Depends(require_roles(UserRole.ADMIN))]  # type: ignore
optional_user = Annotated[User | None, Depends(get_current_user_optional)]


def output(
    item: Internship,
    company_name: str | None = None,
    is_saved: bool | None = None,
    match_score: int | None = None,
    matched_skills: list[str] | None = None,
    match_explanation: str | None = None,
    match: dict | None = None,
) -> dict:
    """Convert an internship record and its related company information into the API response shape."""
    data = {key: getattr(item, key) for key in ("id", "company_id", "title", "description", "location", "industry", "duration_months", "stipend", "work_mode", "deadline", "status", "created_at", "closed_at")}
    data["skills"] = [skill for skill in (item.skills or "").split(",") if skill]
    data["company_name"] = company_name or "Enterprise Partner"
    data["is_saved"] = is_saved
    data["match_score"] = match_score
    data["matched_skills"] = matched_skills
    data["match_explanation"] = match_explanation
    if match is not None:
        data["match"] = {
            key: match.get(key)
            for key in ("score", "matched", "missing", "reason", "confidence", "score_breakdown", "base_match_score", "verified_skill_bonus", "verified_skills")
            if key in match
        }
    else:
        data["match"] = None
    return data


async def get_company_name(company_id: int, db: DbSession) -> str:
    """Return the display name for a company, using a fallback when its profile is unavailable."""
    profile = await db.scalar(select(CompanyProfile).where(CompanyProfile.user_id == company_id))
    return profile.company_name if (profile and profile.company_name) else "Enterprise Partner"


def _search_filter(search: str | None):
    """Add the supported free-text search conditions to an internship query."""
    tokens = re.findall(r"[a-z0-9]+", (search or "").casefold())
    if not tokens:
        return None
    title = (" " + func.replace(func.lower(Internship.title), "/", " ") + " ")
    title_matches = [title.contains(f" {token} ") for token in tokens]
    company_matches = select(CompanyProfile.user_id).where(
        CompanyProfile.user_id == Internship.company_id,
        CompanyProfile.company_name.ilike(f"%{search.strip()}%"),
    ).exists()
    return or_(*title_matches, company_matches)


def transition_allowed(current: str, target: str) -> bool:
    """Return whether an internship may move from its current status to the requested status."""
    return target in {"PENDING_APPROVAL"} if current == "DRAFT" else target == "PUBLISHED" if current == "PENDING_APPROVAL" else target == "CLOSED" if current == "PUBLISHED" else False


async def _ensure_unique_active_posting(
    db: DbSession,
    company_id: int,
    title: str,
    location: str,
    *,
    exclude_id: int | None = None,
) -> None:
    """Reject another active posting with the same company/title where the uniqueness rule applies."""
    query = select(Internship.id).where(
        Internship.company_id == company_id,
        Internship.status.in_({"DRAFT", "PENDING_APPROVAL", "PUBLISHED"}),
        func.lower(func.trim(Internship.title)) == title.strip().lower(),
        func.lower(func.trim(Internship.location)) == location.strip().lower(),
    )
    if exclude_id is not None:
        query = query.where(Internship.id != exclude_id)
    if await db.scalar(query.limit(1)) is not None:
        raise HTTPException(
            status_code=409,
            detail="You already have an active internship with this title and location",
        )


@router.post("", response_model=InternshipResponse, status_code=201)
async def create_internship(data: InternshipInput, user: company_only, db: DbSession) -> dict:
    """Create a draft internship for the authenticated company from the submitted fields."""
    await _ensure_unique_active_posting(db, user.id, data.title, data.location)
    item = Internship(company_id=user.id, status="DRAFT", skills=",".join(data.skills), **data.model_dump(exclude={"skills"}))
    db.add(item); await db.commit(); await db.refresh(item)
    cname = await get_company_name(user.id, db)
    return output(item, cname)


@router.get("/mine", response_model=list[InternshipResponse])
async def list_company_internships(user: company_only, db: DbSession) -> list[dict]:
    """List internships owned by the authenticated company."""
    result = (
        await db.execute(
            select(Internship, func.count(Application.id))
            .outerjoin(Application, Application.internship_id == Internship.id)
            .where(Internship.company_id == user.id)
            .group_by(Internship.id)
            .order_by(Internship.created_at.desc())
        )
    ).all()
    cname = await get_company_name(user.id, db)
    return [{**output(item, cname), "applicant_count": int(applicant_count)} for item, applicant_count in result]


@router.get("/saved", response_model=list[InternshipResponse])
async def list_saved_internships(
    user: student_only,
    db: DbSession,
    search: str | None = Query(default=None, max_length=100),
    location: str | None = None,
    industry: str | None = None,
    work_mode: str | None = None,
    min_stipend: Annotated[int | None, Query(ge=0)] = None,
    skills: str | None = None,
) -> list[dict]:
    """List internships saved by the authenticated student."""
    query = (
        select(Internship)
        .join(SavedInternship, SavedInternship.internship_id == Internship.id)
        .where(
            SavedInternship.student_id == user.id,
            Internship.status == "PUBLISHED",
            Internship.deadline >= date.today(),
            ~select(Application.id).where(
                Application.internship_id == Internship.id,
                Application.student_id == user.id,
                Application.status != "WITHDRAWN",
            ).exists(),
        )
        .order_by(SavedInternship.created_at.desc())
    )
    filters = []
    if location:
        filters.append(Internship.location.ilike(f"%{location}%"))
    if industry:
        filters.append(Internship.industry.ilike(f"%{industry}%"))
    if work_mode:
        filters.append(Internship.work_mode == work_mode.upper())
    if min_stipend is not None:
        filters.append(Internship.stipend >= min_stipend)
    if skills:
        filters.extend(Internship.skills.ilike(f"%{skill.strip()}%") for skill in skills.split(",") if skill.strip())
    search_filter = _search_filter(search)
    if search_filter is not None:
        filters.append(search_filter)
    if filters:
        query = query.where(*filters)
    items = list(await db.scalars(query))
    if not items:
        return []

    company_ids = {item.company_id for item in items}
    comp_profiles = (await db.scalars(select(CompanyProfile).where(CompanyProfile.user_id.in_(company_ids)))).all() if company_ids else []
    comp_map = {cp.user_id: cp.company_name for cp in comp_profiles if cp.company_name}

    student_prof = await db.scalar(select(StudentProfile).where(StudentProfile.user_id == user.id))
    student_skills = [s.strip() for s in (student_prof.skills if student_prof else "").split(",") if s.strip()]
    resume_text = await get_student_resume_text(db, user.id)
    badges = await get_valid_badges(db, user.id)

    results = []
    for item in items:
        job_skills = [s.strip() for s in (item.skills or "").split(",") if s.strip()]
        match_info = compute_match_score_fast(
            student_skills,
            job_skills,
            item.title,
            resume_text,
            item.description,
            eligibility_data=compute_explicit_eligibility_fit(
                item.description,
                student_prof.graduation_year if student_prof else None,
                f"{student_prof.major} {student_prof.university}" if student_prof else "",
            ),
        )
        match_info = apply_verified_badge_boost(match_info, job_skills, badges)
        results.append(
            output(
                item,
                comp_map.get(item.company_id),
                is_saved=True,
                match_score=match_info["score"],
                matched_skills=match_info["matched_skills"],
                match_explanation=match_info["match_explanation"],
                match=match_info,
            )
        )
    return results


@router.post("/{internship_id}/save", status_code=200)
async def save_internship(internship_id: int, user: student_only, db: DbSession) -> dict:
    """Save an internship for the authenticated student if it is available to save."""
    internship = await db.scalar(select(Internship).where(Internship.id == internship_id, Internship.status == "PUBLISHED"))
    if internship is None:
        raise HTTPException(404, "Internship not found or not published")

    existing = await db.scalar(
        select(SavedInternship).where(
            SavedInternship.student_id == user.id,
            SavedInternship.internship_id == internship_id,
        )
    )
    if existing is None:
        saved = SavedInternship(student_id=user.id, internship_id=internship_id)
        db.add(saved)
        try:
            await db.commit()
        except IntegrityError:
            await db.rollback()
            existing = await db.scalar(
                select(SavedInternship.id).where(
                    SavedInternship.student_id == user.id,
                    SavedInternship.internship_id == internship_id,
                )
            )
            if existing is None:
                raise
            return {"is_saved": True, "internship_id": internship_id, "message": "Internship already saved"}
    return {"is_saved": True, "internship_id": internship_id, "message": "Internship saved"}


@router.delete("/{internship_id}/save", status_code=200)
async def unsave_internship(internship_id: int, user: student_only, db: DbSession) -> dict:
    """Remove an internship from the authenticated student?s saved list."""
    saved = await db.scalar(
        select(SavedInternship).where(
            SavedInternship.student_id == user.id,
            SavedInternship.internship_id == internship_id,
        )
    )
    if saved is not None:
        await db.delete(saved)
        await db.commit()
    return {"is_saved": False, "internship_id": internship_id, "message": "Internship unsaved"}


@router.get("", response_model=InternshipPage)
async def browse_internships(
    db: DbSession,
    user: optional_user,
    location: str | None = None,
    industry: str | None = None,
    duration: Annotated[int | None, Query(ge=1)] = None,
    min_stipend: Annotated[int | None, Query(ge=0)] = None,
    max_stipend: Annotated[int | None, Query(ge=0)] = None,
    work_mode: str | None = None,
    search: str | None = Query(default=None, max_length=100),
    skills: str | None = None,
    posted_after: date | None = None,
    deadline_before: date | None = None,
    sort_by: str | None = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
) -> InternshipPage:
    """Browse internships visible to students, applying the requested search and listing filters."""
    query = select(Internship).where(
        Internship.status == "PUBLISHED",
        Internship.deadline >= date.today(),
    )
    filters = []
    if location: filters.append(Internship.location.ilike(f"%{location}%"))
    if industry: filters.append(Internship.industry.ilike(f"%{industry}%"))
    if duration is not None: filters.append(Internship.duration_months == duration)
    if min_stipend is not None: filters.append(Internship.stipend >= min_stipend)
    if max_stipend is not None: filters.append(Internship.stipend <= max_stipend)
    if work_mode: filters.append(Internship.work_mode == work_mode.upper())
    search_filter = _search_filter(search)
    if search_filter is not None: filters.append(search_filter)
    if skills: filters.extend(Internship.skills.ilike(f"%{skill.strip()}%") for skill in skills.split(","))
    if posted_after: filters.append(Internship.created_at >= datetime.combine(posted_after, datetime.min.time(), timezone.utc))
    if deadline_before: filters.append(Internship.deadline <= deadline_before)
    if user and user.role == UserRole.STUDENT:
        filters.append(
            ~select(Application.id).where(
                Application.internship_id == Internship.id,
                Application.student_id == user.id,
                Application.status != "WITHDRAWN",
            ).exists()
        )
    if filters: query = query.where(*filters)
    total = await db.scalar(select(func.count()).select_from(query.subquery())) or 0
    items = list(await db.scalars(query.order_by(Internship.created_at.desc()).offset((page - 1) * page_size).limit(page_size)))
    company_ids = {item.company_id for item in items}
    comp_profiles = (await db.scalars(select(CompanyProfile).where(CompanyProfile.user_id.in_(company_ids)))).all() if company_ids else []
    comp_map = {cp.user_id: cp.company_name for cp in comp_profiles if cp.company_name}

    saved_ids = set()
    student_skills: list[str] = []
    resume_text = ""
    if user and user.role == UserRole.STUDENT:
        saved_ids = set((await db.scalars(select(SavedInternship.internship_id).where(SavedInternship.student_id == user.id))).all())
        student_prof = await db.scalar(select(StudentProfile).where(StudentProfile.user_id == user.id))
        if student_prof and student_prof.skills:
            student_skills = [s.strip() for s in student_prof.skills.split(",") if s.strip()]
        resume_text = await get_student_resume_text(db, user.id)
        badges = await get_valid_badges(db, user.id)
    else:
        badges = []

    output_items = []
    for item in items:
        is_saved = item.id in saved_ids if (user and user.role == UserRole.STUDENT) else None
        job_skills = [s.strip() for s in (item.skills or "").split(",") if s.strip()]
        match_info = compute_match_score_fast(
            student_skills,
            job_skills,
            item.title,
            resume_text,
            item.description,
            eligibility_data=compute_explicit_eligibility_fit(
                item.description,
                student_prof.graduation_year if student_prof else None,
                f"{student_prof.major} {student_prof.university}" if student_prof else "",
            ) if user and user.role == UserRole.STUDENT else None,
        ) if (user and user.role == UserRole.STUDENT) else {"score": None, "matched_skills": None}
        if user and user.role == UserRole.STUDENT:
            match_info = apply_verified_badge_boost(match_info, job_skills, badges)
        output_items.append(
            output(
                item,
                comp_map.get(item.company_id),
                is_saved=is_saved,
                match_score=match_info["score"],
                matched_skills=match_info["matched_skills"],
                match_explanation=match_info.get("match_explanation"),
                match=match_info,
            )
        )

    if sort_by == "match" and user and user.role == UserRole.STUDENT:
        output_items.sort(key=lambda x: x["match_score"] or 0, reverse=True)

    return InternshipPage(items=output_items, page=page, page_size=page_size, total=total)


@router.get("/{internship_id}", response_model=InternshipResponse)
async def get_internship(internship_id: int, db: DbSession, user: optional_user) -> dict:
    """Return an internship visible to the caller, including its associated company information."""
    item = await db.scalar(select(Internship).where(Internship.id == internship_id))
    if item is None:
        raise HTTPException(404, "Internship not found")
    if item.status == "CLOSED":
        pass
    elif item.status != "PUBLISHED":
        if user and user.role == UserRole.COMPANY and item.company_id == user.id:
            pass
        elif user and user.role == UserRole.ADMIN:
            pass
        else:
            raise HTTPException(404, "Internship not found")
    cname = await get_company_name(item.company_id, db)

    is_saved = None
    match_score = None
    matched_skills = None
    match_explanation = None
    match_details = None
    if user and user.role == UserRole.STUDENT:
        saved = await db.scalar(select(SavedInternship.id).where(SavedInternship.student_id == user.id, SavedInternship.internship_id == item.id))
        is_saved = saved is not None
        student_prof = await db.scalar(select(StudentProfile).where(StudentProfile.user_id == user.id))
        student_skills = [s.strip() for s in (student_prof.skills if student_prof else "").split(",") if s.strip()]
        job_skills = [s.strip() for s in (item.skills or "").split(",") if s.strip()]
        resume_text = await get_student_resume_text(db, user.id)
        match_info = compute_match_score_fast(
            student_skills,
            job_skills,
            item.title,
            resume_text,
            item.description,
            eligibility_data=compute_explicit_eligibility_fit(
                item.description,
                student_prof.graduation_year if student_prof else None,
                f"{student_prof.major} {student_prof.university}" if student_prof else "",
            ),
        )
        match_info = apply_verified_badge_boost(
            match_info,
            job_skills,
            await get_valid_badges(db, user.id),
        )
        match_score = match_info["score"]
        matched_skills = match_info["matched_skills"]
        match_explanation = match_info["match_explanation"]
        match_details = match_info

    return output(
        item,
        cname,
        is_saved=is_saved,
        match_score=match_score,
        matched_skills=matched_skills,
        match_explanation=match_explanation,
        match=match_details,
    )



@router.put("/{internship_id}", response_model=InternshipResponse)
async def edit_internship(internship_id: int, data: InternshipInput, user: company_only, db: DbSession) -> dict:
    """Update an internship owned by the authenticated company using the supplied fields."""
    item = await db.scalar(select(Internship).where(Internship.id == internship_id, Internship.company_id == user.id))
    if item is None: raise HTTPException(404, "Internship not found")
    await _ensure_unique_active_posting(
        db,
        user.id,
        data.title,
        data.location,
        exclude_id=item.id,
    )
    for key, value in data.model_dump(exclude={"skills"}).items(): setattr(item, key, value)
    item.skills = ",".join(data.skills); item.status = "DRAFT"
    await db.commit(); await db.refresh(item)
    cname = await get_company_name(item.company_id, db)
    return output(item, cname)


@router.post("/{internship_id}/duplicate", response_model=InternshipResponse, status_code=201)
async def duplicate_internship(internship_id: int, user: company_only, db: DbSession) -> dict:
    """Create a new company-owned internship by copying the selected internship?s posting details."""
    source = await db.scalar(
        select(Internship).where(Internship.id == internship_id, Internship.company_id == user.id)
    )
    if source is None:
        raise HTTPException(404, "Internship not found")
    copy = Internship(
        company_id=user.id,
        title=f"{source.title} (copy)",
        description=source.description,
        location=source.location,
        industry=source.industry,
        duration_months=source.duration_months,
        stipend=source.stipend,
        work_mode=source.work_mode,
        skills=source.skills,
        deadline=source.deadline,
        status="DRAFT",
    )
    db.add(copy)
    await db.commit()
    await db.refresh(copy)
    return output(copy, await get_company_name(user.id, db))


@router.post("/{internship_id}/status", response_model=InternshipResponse)
async def change_status(internship_id: int, target: str, user: company_only, db: DbSession) -> dict:
    """Change an internship?s status when the requested transition is permitted for its owner."""
    if target == "CLOSED":
        item = await db.scalar(select(Internship).where(Internship.id == internship_id))
        if item is None:
            raise HTTPException(404, "Internship not found")
        try:
            result = await close_internship_service(db, item, user)
        except PermissionError as exc:
            raise HTTPException(403, str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        return output(result.internship, await get_company_name(item.company_id, db))
    item = await db.scalar(select(Internship).where(Internship.id == internship_id, Internship.company_id == user.id))
    if item is None: raise HTTPException(404, "Internship not found")
    if target != "PENDING_APPROVAL" or not transition_allowed(item.status, target): raise HTTPException(409, f"Cannot move {item.status} to {target}")
    if target == "PENDING_APPROVAL":
        profile = await db.scalar(
            select(CompanyProfile).where(CompanyProfile.user_id == user.id)
        )
        if profile is None or profile.verification_status != "VERIFIED":
            raise HTTPException(
                status_code=400,
                detail=(
                    "Company verification is required before submitting an internship "
                    "for approval. Upload your verification documents and wait for an admin decision."
                ),
            )
        await _ensure_unique_active_posting(
            db,
            user.id,
            item.title,
            item.location,
            exclude_id=item.id,
        )
    cname = await get_company_name(item.company_id, db)
    admins = await db.scalars(select(User).where(User.role == UserRole.ADMIN))
    display_title = item.title.replace("_", " ").replace("-", " ").title()
    for admin in admins:
        await notify(
            db,
            admin.id,
            "INTERNSHIP_PENDING_APPROVAL",
            f"Internship pending approval: {display_title}",
            f"{cname} submitted \"{display_title}\" for approval.",
        )
    item.status = target
    await db.commit()
    await db.refresh(item)
    return output(item, cname)


@router.post("/{internship_id}/submit", response_model=InternshipResponse)
async def submit_internship(internship_id: int, user: company_only, db: DbSession) -> dict:
    """Submit a company internship for administrator approval."""
    return await change_status(internship_id, "PENDING_APPROVAL", user, db)


@router.get("/{internship_id}/close-preview")
async def close_preview(
    internship_id: int,
    user: Annotated[User, Depends(get_current_user)],
    db: DbSession,
) -> dict:
    """Close the preview state for an internship owned by the authenticated company."""
    item = await db.get(Internship, internship_id)
    if item is None:
        raise HTTPException(404, "Internship not found")
    if user.role != UserRole.ADMIN and (user.role != UserRole.COMPANY or item.company_id != user.id):
        raise HTTPException(403, "Only the owning company or an admin may close this internship.")
    rows = await db.execute(
        select(Application.status, func.count(Application.id))
        .where(Application.internship_id == item.id)
        .group_by(Application.status)
    )
    counts = {status: int(count) for status, count in rows.all()}
    upcoming_interviews = int(
        await db.scalar(
            select(func.count(Interview.id))
            .join(Application, Application.id == Interview.application_id)
            .where(
                Application.internship_id == item.id,
                Interview.status == "SCHEDULED",
                Interview.scheduled_at > datetime.now(timezone.utc),
            )
        )
        or 0
    )
    return {"counts": counts, "upcoming_interviews": upcoming_interviews}


@router.post("/{internship_id}/close", response_model=InternshipResponse)
async def close_internship_endpoint(
    internship_id: int,
    background_tasks: BackgroundTasks,
    user: company_only,
    db: DbSession,
    data: InternshipCloseRequest = Body(default=InternshipCloseRequest()),
) -> dict:
    """Close an internship and persist its closed status for the owning company."""
    item = await db.get(Internship, internship_id)
    if item is None or item.company_id != user.id:
        raise HTTPException(404, "Internship not found")
    try:
        result = await close_internship_service(
            db,
            item,
            user,
            reject_pending=data.reject_pending,
            note=data.note,
        )
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    if result.emails:
        background_tasks.add_task(send_closure_emails, result.emails, db)
    return output(result.internship, await get_company_name(item.company_id, db))


@router.post("/{internship_id}/review", response_model=InternshipResponse)
async def review_internship(
    internship_id: int,
    target: str,
    user: admin_only,
    db: DbSession,
    reason: str | None = Query(default=None, max_length=300),
) -> dict:
    """Apply an administrator?s approval or rejection decision to a submitted internship."""
    item = await db.scalar(select(Internship).where(Internship.id == internship_id))
    if item is None: raise HTTPException(404, "Internship not found")
    if item.status != "PENDING_APPROVAL" or target not in {"PUBLISHED", "REJECTED"}:
        raise HTTPException(409, f"Cannot review {item.status} as {target}")
    item.status = target
    title = "Internship approved" if target == "PUBLISHED" else "Internship rejected"
    display_title = item.title.replace("_", " ").replace("-", " ").title()
    body = f'Your internship "{display_title}" was {target.lower()}.'
    if target == "REJECTED" and reason and reason.strip():
        body += f" Reason: {reason.strip()}"
    await write_audit(
        db,
        actor=user,
        action="posting_approved" if target == "PUBLISHED" else "posting_rejected",
        target_type="posting",
        target_id=item.id,
        metadata={"title": display_title, "reason": reason.strip() if reason else None},
    )
    await notify(db, item.company_id, "INTERNSHIP_REVIEW", title, body)
    await db.commit(); await db.refresh(item)
    cname = await get_company_name(item.company_id, db)
    return output(item, cname)


@router.delete("/{internship_id}", status_code=204)
async def delete_internship(internship_id: int, user: company_only, db: DbSession) -> None:
    """Delete an internship owned by the authenticated company when the posting can be removed."""
    item = await db.scalar(select(Internship).where(Internship.id == internship_id, Internship.company_id == user.id))
    if item is None: raise HTTPException(404, "Internship not found")
    if item.status != "DRAFT":
        raise HTTPException(409, "Only draft internships can be deleted.")
    await db.delete(item); await db.commit()