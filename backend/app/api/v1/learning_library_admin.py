"""Admin-only CRUD for verified learning resources and curated paths."""

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.v1.dependencies import DbSession, require_roles
from app.models import User, UserRole
from app.schemas.learning_library import (
    LearningCategoryCreate,
    LearningCategoryUpdate,
    LearningPathCreate,
    LearningPathUpdate,
    LearningResourceCreate,
    LearningResourceUpdate,
)
from app.services.learning_library import (
    LearningLibraryError,
    admin_list_audit_events,
    admin_create_category,
    admin_create_path,
    admin_create_resource,
    admin_list_categories,
    admin_list_paths,
    admin_list_resources,
    admin_update_category,
    admin_update_path,
    admin_update_resource,
    admin_verify_resource,
)

router = APIRouter(
    prefix="/admin/learning",
    tags=["admin-learning-library"],
    dependencies=[Depends(require_roles(UserRole.ADMIN))],
)
admin_user = Annotated[User, Depends(require_roles(UserRole.ADMIN))]


async def _execute(operation: Any) -> Any:
    try:
        return await operation
    except LearningLibraryError as error:
        raise HTTPException(status_code=error.status_code, detail=error.code) from error


@router.get("/categories")
async def get_categories(db: DbSession) -> list[dict[str, Any]]:
    return await admin_list_categories(db)


@router.post("/categories", status_code=201)
async def post_category(
    payload: LearningCategoryCreate,
    db: DbSession,
    actor: admin_user,
) -> dict[str, Any]:
    return await _execute(admin_create_category(db, actor, payload))


@router.patch("/categories/{category_id}")
async def patch_category(
    category_id: int,
    payload: LearningCategoryUpdate,
    db: DbSession,
    actor: admin_user,
) -> dict[str, Any]:
    return await _execute(admin_update_category(db, actor, category_id, payload))


@router.get("/resources")
async def get_resources(db: DbSession) -> list[dict[str, Any]]:
    return await admin_list_resources(db)


@router.post("/resources", status_code=201)
async def post_resource(
    payload: LearningResourceCreate,
    db: DbSession,
    actor: admin_user,
) -> dict[str, Any]:
    return await _execute(admin_create_resource(db, actor, payload))


@router.patch("/resources/{resource_id}")
async def patch_resource(
    resource_id: int,
    payload: LearningResourceUpdate,
    db: DbSession,
    actor: admin_user,
) -> dict[str, Any]:
    return await _execute(admin_update_resource(db, actor, resource_id, payload))


@router.post("/resources/{resource_id}/verify")
async def post_verify_resource(
    resource_id: int,
    db: DbSession,
    actor: admin_user,
) -> dict[str, Any]:
    return await _execute(admin_verify_resource(db, actor, resource_id))


@router.get("/paths")
async def get_paths(db: DbSession) -> list[dict[str, Any]]:
    return await admin_list_paths(db)


@router.get("/audit")
async def get_learning_audit(
    db: DbSession,
    limit: int = Query(default=100, ge=1, le=200),
) -> list[dict[str, Any]]:
    return await admin_list_audit_events(db, limit)


@router.post("/paths", status_code=201)
async def post_path(
    payload: LearningPathCreate,
    db: DbSession,
    actor: admin_user,
) -> dict[str, Any]:
    return await _execute(admin_create_path(db, actor, payload))


@router.put("/paths/{path_id}")
async def put_path(
    path_id: int,
    payload: LearningPathUpdate,
    db: DbSession,
    actor: admin_user,
) -> dict[str, Any]:
    return await _execute(admin_update_path(db, actor, path_id, payload))
