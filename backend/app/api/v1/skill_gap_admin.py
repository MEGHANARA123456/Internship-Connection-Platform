"""Admin-only management of canonical skills and public role requirements."""

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select

from app.api.v1.dependencies import DbSession, require_roles
from app.models import AuditLog, User, UserRole
from app.schemas.skill_gap import RoleSkillMapUpdate, SkillCreate, SkillUpdate
from app.services.skill_gap import (
    SkillGapError,
    admin_create_skill,
    admin_list_roles,
    admin_list_skills,
    admin_update_role,
    admin_update_skill,
)

router = APIRouter(
    prefix="/admin/skill-gaps",
    tags=["admin-skill-gap-catalog"],
    dependencies=[Depends(require_roles(UserRole.ADMIN))],
)
admin_user = Annotated[User, Depends(require_roles(UserRole.ADMIN))]


async def _execute(operation: Any) -> Any:
    try:
        return await operation
    except SkillGapError as error:
        raise HTTPException(status_code=error.status_code, detail=error.code) from error


@router.get("/skills")
async def get_skills(db: DbSession) -> list[dict[str, Any]]:
    return await admin_list_skills(db)


@router.post("/skills", status_code=201)
async def post_skill(
    payload: SkillCreate,
    db: DbSession,
    actor: admin_user,
) -> dict[str, Any]:
    return await _execute(admin_create_skill(db, actor.id, payload))


@router.patch("/skills/{skill_id}")
async def patch_skill(
    skill_id: int,
    payload: SkillUpdate,
    db: DbSession,
    actor: admin_user,
) -> dict[str, Any]:
    return await _execute(admin_update_skill(db, actor.id, skill_id, payload))


@router.get("/roles")
async def get_roles(db: DbSession) -> list[dict[str, Any]]:
    return await admin_list_roles(db)


@router.put("/roles/{role_slug}")
async def put_role(
    role_slug: str,
    payload: RoleSkillMapUpdate,
    db: DbSession,
    actor: admin_user,
) -> dict[str, Any]:
    return await _execute(admin_update_role(db, actor.id, role_slug, payload))


@router.get("/audit")
async def get_skill_gap_audit(
    db: DbSession,
    limit: int = Query(default=100, ge=1, le=200),
) -> list[dict[str, Any]]:
    rows = (
        await db.execute(
            select(AuditLog)
            .where(AuditLog.target_type.in_(("skill", "skill_role")))
            .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
            .limit(limit)
        )
    ).scalars().all()
    return [
        {
            "id": row.id,
            "actor_id": row.actor_id,
            "action": row.action,
            "target_type": row.target_type,
            "target_id": row.target_id,
            "summary": row.metadata_,
            "created_at": row.created_at.isoformat(),
        }
        for row in rows
    ]
