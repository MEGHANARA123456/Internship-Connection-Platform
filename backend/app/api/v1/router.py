from fastapi import APIRouter
from typing import Annotated
from fastapi import Depends

from app.api.v1.auth import router as auth_router
from app.api.v1.profiles import router as profiles_router
from app.api.v1.internships import router as internships_router
from app.api.v1.applications import router as applications_router
from app.api.v1.communication import router as communication_router
from app.api.v1.admin import router as admin_router
from app.api.v1.reports import router as reports_router
from app.api.v1.dependencies import require_roles
from app.models import User, UserRole

api_router = APIRouter()
api_router.include_router(auth_router)
api_router.include_router(profiles_router)
api_router.include_router(internships_router)
api_router.include_router(applications_router)
api_router.include_router(communication_router)
api_router.include_router(admin_router)
api_router.include_router(reports_router)


@api_router.get("/health", tags=["health"])
async def health_check() -> dict[str, str]:
    return {"status": "ok"}


@api_router.get("/student/me", tags=["student"])
async def student_me(user: Annotated[User, Depends(require_roles(UserRole.STUDENT))]) -> dict[str, str]:
    return {"email": user.email, "role": user.role.value}


@api_router.get("/company/dashboard", tags=["company"])
async def company_dashboard(user: Annotated[User, Depends(require_roles(UserRole.COMPANY))]) -> dict[str, str]:
    return {"email": user.email, "role": user.role.value}


@api_router.get("/admin/dashboard", tags=["admin"])
async def admin_dashboard(user: Annotated[User, Depends(require_roles(UserRole.ADMIN))]) -> dict[str, str]:
    return {"email": user.email, "role": user.role.value}