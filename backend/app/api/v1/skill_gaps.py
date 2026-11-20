"""Student-only skill gap analysis and private report history."""

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException

from app.api.v1.dependencies import DbSession, require_roles
from app.models import User, UserRole
from app.schemas.skill_gap import SkillGapRunRequest
from app.services.skill_gap import (
    SkillGapError,
    create_report,
    get_options,
    get_report,
    list_reports,
)

router = APIRouter(prefix="/skill-gaps", tags=["skill-gap-analysis"])
student_only = Annotated[User, Depends(require_roles(UserRole.STUDENT))]


async def _execute(operation: Any) -> Any:
    try:
        return await operation
    except SkillGapError as error:
        raise HTTPException(status_code=error.status_code, detail=error.code) from error


@router.get("/options")
async def get_skill_gap_options(
    db: DbSession,
    _user: student_only,
) -> dict[str, Any]:
    return await get_options(db)


@router.post("/reports", status_code=201)
async def post_skill_gap_report(
    payload: SkillGapRunRequest,
    db: DbSession,
    user: student_only,
) -> dict[str, Any]:
    return await _execute(
        create_report(db, user.id, payload.target_role, payload.internship_id)
    )


@router.get("/reports")
async def get_skill_gap_reports(
    db: DbSession,
    user: student_only,
) -> list[dict[str, Any]]:
    return await list_reports(db, user.id)


@router.get("/reports/{report_id}")
async def get_skill_gap_report(
    report_id: int,
    db: DbSession,
    user: student_only,
) -> dict[str, Any]:
    return await _execute(get_report(db, user.id, report_id))
