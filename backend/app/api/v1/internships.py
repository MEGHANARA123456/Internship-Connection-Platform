from datetime import date, datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select

from app.api.v1.dependencies import DbSession, get_current_user, get_current_user_optional, require_roles
from app.models import CompanyProfile, Internship, User, UserRole
from app.schemas.internship import InternshipInput, InternshipPage, InternshipResponse

router = APIRouter(prefix="/internships", tags=["internships"])
company_only = Annotated[User, Depends(require_roles(UserRole.COMPANY))]
student_only = Annotated[User, Depends(require_roles(UserRole.STUDENT))]
admin_only = Annotated[User, Depends(require_roles(UserRole.ADMIN))]
optional_user = Annotated[User | None, Depends(get_current_user_optional)]


def output(item: Internship, company_name: str | None = None) -> dict:
    data = {key: getattr(item, key) for key in ("id", "company_id", "title", "description", "location", "industry", "duration_months", "stipend", "work_mode", "deadline", "status", "created_at")}
    data["skills"] = [skill for skill in item.skills.split(",") if skill]
    data["company_name"] = company_name or "Enterprise Partner"
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


@router.get("", response_model=InternshipPage)
async def browse_internships(db: DbSession, user: optional_user, location: str | None = None, industry: str | None = None, duration: int | None = Query(None, ge=1), min_stipend: int | None = Query(None, ge=0), max_stipend: int | None = Query(None, ge=0), work_mode: str | None = None, skills: str | None = None, posted_after: date | None = None, deadline_before: date | None = None, page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100)) -> InternshipPage:
    query = select(Internship).where(Internship.status == "PUBLISHED")
    filters = []
    if location: filters.append(Internship.location.ilike(f"%{location}%"))
    if industry: filters.append(Internship.industry.ilike(f"%{industry}%"))
    if duration: filters.append(Internship.duration_months == duration)
    if min_stipend is not None: filters.append(Internship.stipend >= min_stipend)
    if max_stipend is not None: filters.append(Internship.stipend <= max_stipend)
    if work_mode: filters.append(Internship.work_mode == work_mode.upper())
    if skills: filters.extend(Internship.skills.ilike(f"%{skill.strip()}%") for skill in skills.split(","))
    if posted_after: filters.append(Internship.created_at >= datetime.combine(posted_after, datetime.min.time(), timezone.utc))
    if deadline_before: filters.append(Internship.deadline <= deadline_before)
    if filters: query = query.where(*filters)
    total = await db.scalar(select(func.count()).select_from(query.subquery())) or 0
    items = list(await db.scalars(query.order_by(Internship.created_at.desc()).offset((page - 1) * page_size).limit(page_size)))
    company_ids = {item.company_id for item in items}
    comp_profiles = (await db.scalars(select(CompanyProfile).where(CompanyProfile.user_id.in_(company_ids)))).all() if company_ids else []
    comp_map = {cp.user_id: cp.company_name for cp in comp_profiles if cp.company_name}
    return InternshipPage(items=[output(item, comp_map.get(item.company_id)) for item in items], page=page, page_size=page_size, total=total)


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
    return output(item, cname)


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
    item.status = target; await db.commit(); await db.refresh(item)
    cname = await get_company_name(item.company_id, db)
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
    item.status = target; await db.commit(); await db.refresh(item)
    cname = await get_company_name(item.company_id, db)
    return output(item, cname)


@router.delete("/{internship_id}", status_code=204)
async def delete_internship(internship_id: int, user: company_only, db: DbSession) -> None:
    item = await db.scalar(select(Internship).where(Internship.id == internship_id, Internship.company_id == user.id))
    if item is None: raise HTTPException(404, "Internship not found")
    await db.delete(item); await db.commit()