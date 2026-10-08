# -----------------------------------------------------------------------------
# Internship listing, filtering, and management endpoints.
# -----------------------------------------------------------------------------

from datetime import date, datetime, timezone
from typing import Annotated
import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select

from app.api.v1.dependencies import DbSession, get_current_user_optional, require_roles
from app.models import Application, CompanyProfile, Internship, SavedInternship, StudentProfile, User, UserRole
from app.schemas.internship import InternshipInput, InternshipPage, InternshipResponse
from app.services.ai import compute_match_score_fast, get_student_resume_text
from app.services.mail import send_dev_email
from app.services.notify import notify

router = APIRouter(prefix="/internships", tags=["internships"])
logger = logging.getLogger(__name__)
company_only = Annotated[User, Depends(require_roles(UserRole.COMPANY))]
student_only = Annotated[User, Depends(require_roles(UserRole.STUDENT))]
admin_only = Annotated[User, Depends(require_roles(UserRole.ADMIN))]
optional_user = Annotated[User | None, Depends(get_current_user_optional)]


def output(
    item: Internship,
    company_name: str | None = None,
    is_saved: bool | None = None,
    match_score: int | None = None,
    matched_skills: list[str] | None = None,
) -> dict:
    data = {key: getattr(item, key) for key in ("id", "company_id", "title", "description", "location", "industry", "duration_months", "stipend", "work_mode", "deadline", "status", "created_at")}
    data["skills"] = [skill for skill in (item.skills or "").split(",") if skill]
    data["company_name"] = company_name or "Enterprise Partner"
    data["is_saved"] = is_saved
    data["match_score"] = match_score
    data["matched_skills"] = matched_skills
    return data


async def get_company_name(company_id: int, db: DbSession) -> str:
    profile = await db.scalar(select(CompanyProfile).where(CompanyProfile.user_id == company_id))
    return profile.company_name if (profile and profile.company_name) else "Enterprise Partner"


def transition_allowed(current: str, target: str) -> bool:
    return target in {"PENDING_APPROVAL"} if current == "DRAFT" else target == "PUBLISHED" if current == "PENDING_APPROVAL" else target == "CLOSED" if current == "PUBLISHED" else False


@router.post("", response_model=InternshipResponse, status_code=201)
async def create_internship(data: InternshipInput, user: company_only, db: DbSession) -> dict:
    item = Internship(company_id=user.id, status="DRAFT", skills=",".join(data.skills), **data.model_dump(exclude={"skills"}))
    db.add(item); await db.commit(); await db.refresh(item)
    cname = await get_company_name(user.id, db)
    return output(item, cname)


@router.get("/mine", response_model=list[InternshipResponse])
async def list_company_internships(user: company_only, db: DbSession) -> list[dict]:
    result = list(await db.scalars(select(Internship).where(Internship.company_id == user.id).order_by(Internship.created_at.desc())))
    cname = await get_company_name(user.id, db)
    return [output(item, cname) for item in result]


@router.get("/saved", response_model=list[InternshipResponse])
async def list_saved_internships(user: student_only, db: DbSession) -> list[dict]:
    query = (
        select(Internship)
        .join(SavedInternship, SavedInternship.internship_id == Internship.id)
        .where(SavedInternship.student_id == user.id)
        .order_by(SavedInternship.created_at.desc())
    )
    items = list(await db.scalars(query))
    if not items:
        return []

    company_ids = {item.company_id for item in items}
    comp_profiles = (await db.scalars(select(CompanyProfile).where(CompanyProfile.user_id.in_(company_ids)))).all() if company_ids else []
    comp_map = {cp.user_id: cp.company_name for cp in comp_profiles if cp.company_name}

    student_prof = await db.scalar(select(StudentProfile).where(StudentProfile.user_id == user.id))
    student_skills = [s.strip() for s in (student_prof.skills if student_prof else "").split(",") if s.strip()]
    resume_text = await get_student_resume_text(db, user.id)

    results = []
    for item in items:
        job_skills = [s.strip() for s in (item.skills or "").split(",") if s.strip()]
        match_info = compute_match_score_fast(student_skills, job_skills, item.title, resume_text, item.description)
        results.append(
            output(
                item,
                comp_map.get(item.company_id),
                is_saved=True,
                match_score=match_info["score"],
                matched_skills=match_info["matched_skills"],
            )
        )
    return results


@router.post("/{internship_id}/save", status_code=200)
async def save_internship(internship_id: int, user: student_only, db: DbSession) -> dict:
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
        await db.commit()
    return {"is_saved": True, "internship_id": internship_id, "message": "Internship saved"}


@router.delete("/{internship_id}/save", status_code=200)
async def unsave_internship(internship_id: int, user: student_only, db: DbSession) -> dict:
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
    skills: str | None = None,
    posted_after: date | None = None,
    deadline_before: date | None = None,
    sort_by: str | None = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
) -> InternshipPage:
    query = select(Internship).where(Internship.status == "PUBLISHED")
    filters = []
    if location: filters.append(Internship.location.ilike(f"%{location}%"))
    if industry: filters.append(Internship.industry.ilike(f"%{industry}%"))
    if duration is not None: filters.append(Internship.duration_months == duration)
    if min_stipend is not None: filters.append(Internship.stipend >= min_stipend)
    if max_stipend is not None: filters.append(Internship.stipend <= max_stipend)
    if work_mode: filters.append(Internship.work_mode == work_mode.upper())
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
        ) if (user and user.role == UserRole.STUDENT) else {"score": None, "matched_skills": None}
        output_items.append(
            output(
                item,
                comp_map.get(item.company_id),
                is_saved=is_saved,
                match_score=match_info["score"],
                matched_skills=match_info["matched_skills"],
            )
        )

    if sort_by == "match" and user and user.role == UserRole.STUDENT:
        output_items.sort(key=lambda x: x["match_score"] or 0, reverse=True)

    return InternshipPage(items=output_items, page=page, page_size=page_size, total=total)


@router.get("/{internship_id}", response_model=InternshipResponse)
async def get_internship(internship_id: int, db: DbSession, user: optional_user) -> dict:
    item = await db.scalar(select(Internship).where(Internship.id == internship_id))
    if item is None:
        raise HTTPException(404, "Internship not found")
    if item.status != "PUBLISHED":
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
        )
        match_score = match_info["score"]
        matched_skills = match_info["matched_skills"]

    return output(item, cname, is_saved=is_saved, match_score=match_score, matched_skills=matched_skills)



@router.put("/{internship_id}", response_model=InternshipResponse)
async def edit_internship(internship_id: int, data: InternshipInput, user: company_only, db: DbSession) -> dict:
    item = await db.scalar(select(Internship).where(Internship.id == internship_id, Internship.company_id == user.id))
    if item is None: raise HTTPException(404, "Internship not found")
    for key, value in data.model_dump(exclude={"skills"}).items(): setattr(item, key, value)
    item.skills = ",".join(data.skills); item.status = "DRAFT"
    await db.commit(); await db.refresh(item)
    cname = await get_company_name(item.company_id, db)
    return output(item, cname)


@router.post("/{internship_id}/status", response_model=InternshipResponse)
async def change_status(internship_id: int, target: str, user: company_only, db: DbSession) -> dict:
    item = await db.scalar(select(Internship).where(Internship.id == internship_id, Internship.company_id == user.id))
    if item is None: raise HTTPException(404, "Internship not found")
    if target not in {"PENDING_APPROVAL", "CLOSED"} or not transition_allowed(item.status, target): raise HTTPException(409, f"Cannot move {item.status} to {target}")
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
    cname = await get_company_name(item.company_id, db)
    notifications = []
    if target == "CLOSED":
        applications = list(await db.scalars(
            select(Application).where(
                Application.internship_id == item.id,
                Application.status.not_in(["WITHDRAWN", "REJECTED"]),
            )
        ))
        for application in applications:
            if application.status in {"APPLIED", "UNDER_REVIEW"}:
                body = f"{cname} has closed {item.title}. No further review decisions will be made on this posting."
            elif application.status in {"SHORTLISTED", "INTERVIEW_SCHEDULED"}:
                body = f"{cname} has closed {item.title}. Your application is in progress; please contact the company for next steps."
            else:
                body = f"{cname} has closed {item.title} to new applicants. Your offer is unaffected."
            await notify(
                db,
                application.student_id,
                "INTERNSHIP_CLOSED",
                "Internship closed",
                body,
            )
            notifications.append((application, body))
    elif target == "PENDING_APPROVAL":
        admins = await db.scalars(select(User).where(User.role == UserRole.ADMIN))
        for admin in admins:
            await notify(
                db,
                admin.id,
                "INTERNSHIP_PENDING_APPROVAL",
                f"Internship pending approval: {item.title}",
                f"A company submitted {item.title} for approval.",
            )
    item.status = target
    await db.commit()
    await db.refresh(item)
    for application, body in notifications:
        student = await db.scalar(select(User).where(User.id == application.student_id))
        if student:
            await send_dev_email(
                student.email,
                "Internship closed",
                body,
                message_type="INTERNSHIP_CLOSED",
                db=db,
            )
        try:
            from app.api.v1.ws import manager
            await manager.send_personal_message(
                application.student_id,
                {
                    "type": "internship_closed",
                    "application_id": application.id,
                    "internship_id": item.id,
                    "status": application.status,
                    "title": "Internship closed",
                    "body": body,
                },
            )
        except Exception as exc:
            logger.warning("Could not send internship closure notification for application %s: %s", application.id, exc)
    return output(item, cname)


@router.post("/{internship_id}/submit", response_model=InternshipResponse)
async def submit_internship(internship_id: int, user: company_only, db: DbSession) -> dict:
    return await change_status(internship_id, "PENDING_APPROVAL", user, db)


@router.post("/{internship_id}/close", response_model=InternshipResponse)
async def close_internship(internship_id: int, user: company_only, db: DbSession) -> dict:
    return await change_status(internship_id, "CLOSED", user, db)


@router.post("/{internship_id}/review", response_model=InternshipResponse)
async def review_internship(internship_id: int, target: str, user: admin_only, db: DbSession) -> dict:
    item = await db.scalar(select(Internship).where(Internship.id == internship_id))
    if item is None: raise HTTPException(404, "Internship not found")
    if item.status != "PENDING_APPROVAL" or target not in {"PUBLISHED", "REJECTED"}:
        raise HTTPException(409, f"Cannot review {item.status} as {target}")
    item.status = target
    title = "Internship approved" if target == "PUBLISHED" else "Internship rejected"
    body = f"Your internship {item.title} was {target.lower()}."
    await notify(db, item.company_id, "INTERNSHIP_REVIEW", title, body)
    await db.commit(); await db.refresh(item)
    cname = await get_company_name(item.company_id, db)
    return output(item, cname)


@router.delete("/{internship_id}", status_code=204)
async def delete_internship(internship_id: int, user: company_only, db: DbSession) -> None:
    item = await db.scalar(select(Internship).where(Internship.id == internship_id, Internship.company_id == user.id))
    if item is None: raise HTTPException(404, "Internship not found")
    await db.delete(item); await db.commit()