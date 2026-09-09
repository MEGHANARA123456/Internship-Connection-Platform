from typing import Annotated, Any
from fastapi import APIRouter, Depends
from sqlalchemy import select

from app.api.v1.auth import router as auth_router
from app.api.v1.profiles import router as profiles_router
from app.api.v1.internships import router as internships_router
from app.api.v1.applications import router as applications_router
from app.api.v1.communication import router as communication_router
from app.api.v1.admin import router as admin_router
from app.api.v1.reports import router as reports_router
from app.api.v1.ai import router as ai_router
from app.api.v1.ws import router as ws_router
from app.api.v1.institution import router as institution_router
from app.api.v1.mailbox import router as mailbox_router
from app.api.v1.analytics import router as analytics_router
from app.api.v1.dependencies import DbSession, require_roles
from app.models import CompanyProfile, StudentProfile, User, UserRole

api_router = APIRouter()
api_router.include_router(auth_router)
api_router.include_router(profiles_router)
api_router.include_router(internships_router)
api_router.include_router(applications_router)
api_router.include_router(communication_router)
api_router.include_router(admin_router)
api_router.include_router(reports_router)
api_router.include_router(ai_router)
api_router.include_router(ws_router)
api_router.include_router(institution_router)
api_router.include_router(mailbox_router)
api_router.include_router(analytics_router)


@api_router.get("/health", tags=["health"])
async def health_check() -> dict[str, str]:
    return {"status": "ok"}


@api_router.get("/student/me", tags=["student"])
async def student_me(user: Annotated[User, Depends(require_roles(UserRole.STUDENT))], db: DbSession) -> dict[str, Any]:
    student = await db.scalar(select(StudentProfile).where(StudentProfile.user_id == user.id))
    name = student.full_name if student else None
    if not name and user.email:
        local_part = user.email.split("@")[0]
        words = "".join(c if c.isalpha() else " " for c in local_part).split()
        name = " ".join(words).title() if words else local_part.title()
    return {"email": user.email, "role": user.role.value, "name": name, "user_id": user.id}


@api_router.get("/company/dashboard", tags=["company"])
async def company_dashboard(user: Annotated[User, Depends(require_roles(UserRole.COMPANY))], db: DbSession) -> dict[str, Any]:
    company = await db.scalar(select(CompanyProfile).where(CompanyProfile.user_id == user.id))
    name = company.company_name if company else None
    if not name and user.email:
        local_part = user.email.split("@")[0]
        words = "".join(c if c.isalpha() else " " for c in local_part).split()
        name = " ".join(words).title() if words else local_part.title()
    return {"email": user.email, "role": user.role.value, "name": name, "user_id": user.id}


@api_router.get("/admin/dashboard", tags=["admin"])
async def admin_dashboard(user: Annotated[User, Depends(require_roles(UserRole.ADMIN))]) -> dict[str, Any]:
    local_part = user.email.split("@")[0]
    words = "".join(c if c.isalpha() else " " for c in local_part).split()
    name = " ".join(words).title() if words else local_part.title()
    return {"email": user.email, "role": user.role.value, "name": name, "user_id": user.id}