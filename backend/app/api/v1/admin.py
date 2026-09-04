from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, select

from app.api.v1.dependencies import DbSession, require_roles
from app.models import Application, CompanyProfile, Internship, Report, User, UserRole
from app.schemas.admin import ModerationStatus, ReportResponse, ReportUpdate, UserAdminResponse

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_roles(UserRole.ADMIN))])
admin_user = Annotated[User, Depends(require_roles(UserRole.ADMIN))]
REPORT_TRANSITIONS = {"OPEN": {"INVESTIGATING"}, "INVESTIGATING": {"RESOLVED"}, "RESOLVED": set()}


def report_transition_allowed(current: str, target: str) -> bool:
    return target in REPORT_TRANSITIONS.get(current, set())


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


@router.get("/users", response_model=list[UserAdminResponse])
async def search_users(db: DbSession, user: admin_user, search: str | None = None, role: UserRole | None = None, include_suspended: bool = True) -> list[User]:
    query = select(User).order_by(User.id.desc())
    if search: query = query.where(User.email.ilike(f"%{search}%"))
    if role: query = query.where(User.role == role)
    if not include_suspended: query = query.where(User.suspended_at.is_(None))
    return list(await db.scalars(query))


@router.get("/users/{user_id}", response_model=UserAdminResponse)
async def view_user(user_id: int, db: DbSession, user: admin_user) -> User:
    found = await db.get(User, user_id)
    if found is None: raise HTTPException(404, "User not found")
    return found


@router.post("/users/{user_id}/suspend", response_model=UserAdminResponse)
async def suspend_user(user_id: int, db: DbSession, user: admin_user) -> User:
    found = await view_user(user_id, db, user); found.is_active = False; found.suspended_at = datetime.now(timezone.utc); await db.commit(); await db.refresh(found); return found


@router.post("/users/{user_id}/reactivate", response_model=UserAdminResponse)
async def reactivate_user(user_id: int, db: DbSession, user: admin_user) -> User:
    found = await view_user(user_id, db, user); found.is_active = True; found.suspended_at = None; await db.commit(); await db.refresh(found); return found


def company_output(profile: CompanyProfile) -> dict:
    return {"id": profile.id, "user_id": profile.user_id, "company_name": profile.company_name, "industry": profile.industry, "website": profile.website, "description": profile.description, "verification_status": profile.verification_status}


@router.get("/verifications")
@router.get("/companies/unverified")
async def pending_verifications(db: DbSession, user: admin_user) -> list[dict]:
    return [company_output(profile) for profile in await db.scalars(select(CompanyProfile).where(CompanyProfile.verification_status == "PENDING"))]


@router.post("/companies/{user_id}/verification")
async def verify_company(user_id: int, data: ModerationStatus, db: DbSession, user: admin_user) -> dict:
    if data.status not in {"VERIFIED", "PUBLISHED", "REJECTED"}: raise HTTPException(400, "Use VERIFIED or REJECTED")
    profile = await db.scalar(select(CompanyProfile).where(CompanyProfile.user_id == user_id))
    if profile is None: raise HTTPException(404, "Company profile not found")
    profile.verification_status = "VERIFIED" if data.status in {"VERIFIED", "PUBLISHED"} else "REJECTED"
    await db.commit(); await db.refresh(profile); return company_output(profile)


@router.get("/internships", response_model=list[dict])
async def moderation_queue(db: DbSession, user: admin_user, status: str | None = None) -> list[dict]:
    query = select(Internship).order_by(Internship.created_at.desc())
    if status: query = query.where(Internship.status == status)
    return [{"id": item.id, "title": item.title, "company_id": item.company_id, "status": item.status} for item in await db.scalars(query)]


@router.post("/internships/{internship_id}/moderate", response_model=dict)
@router.post("/internships/{internship_id}/moderation", response_model=dict)
async def moderate_internship(internship_id: int, data: ModerationStatus, db: DbSession, user: admin_user) -> dict:
    item = await db.get(Internship, internship_id)
    if item is None: raise HTTPException(404, "Internship not found")
    if data.status not in {"PUBLISHED", "REJECTED", "CLOSED"}: raise HTTPException(400, "Invalid moderation status")
    item.status = data.status; await db.commit(); return {"id": item.id, "status": item.status}


@router.get("/reports", response_model=list[ReportResponse])
async def reports(db: DbSession, user: admin_user, status: str | None = None) -> list[Report]:
    query = select(Report).order_by(Report.created_at.desc())
    if status: query = query.where(Report.status == status)
    return list(await db.scalars(query))


@router.patch("/reports/{report_id}", response_model=ReportResponse)
async def update_report(report_id: int, data: ReportUpdate, db: DbSession, user: admin_user) -> Report:
    report = await db.get(Report, report_id)
    if report is None: raise HTTPException(404, "Report not found")
    if not report_transition_allowed(report.status, data.status): raise HTTPException(409, f"Cannot move {report.status} to {data.status}")
    report.status = data.status; report.resolution_notes = data.resolution_notes; await db.commit(); await db.refresh(report); return report