"""Student-only browsing, progress, bookmarks, and recommendations."""

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.v1.dependencies import DbSession, require_roles
from app.models import User, UserRole
from app.schemas.learning_library import (
    ResourceProgressUpdate,
    StudentLearningPreferenceUpdate,
)
from app.services.learning_library import (
    LearningLibraryError,
    get_path,
    get_preference,
    get_progress_summary,
    get_recommendations,
    list_categories,
    list_paths,
    list_resources,
    set_bookmark,
    update_preference,
    update_progress,
)

router = APIRouter(prefix="/learning", tags=["learning-library"])
student_only = Annotated[User, Depends(require_roles(UserRole.STUDENT))]


async def _execute(operation: Any) -> Any:
    try:
        return await operation
    except LearningLibraryError as error:
        raise HTTPException(status_code=error.status_code, detail=error.code) from error


@router.get("/categories")
async def get_learning_categories(
    db: DbSession,
    _user: student_only,
) -> list[dict[str, Any]]:
    return await list_categories(db)


@router.get("/resources")
async def get_learning_resources(
    db: DbSession,
    user: student_only,
    search: str = Query(default="", max_length=200),
    category: str | None = None,
    resource_type: str | None = Query(default=None, alias="type"),
    level: str | None = None,
    role: str | None = None,
    topic: str | None = None,
    section: str | None = None,
    bookmarked: bool = False,
    limit: int = Query(default=100, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> dict[str, Any]:
    return await list_resources(
        db,
        user.id,
        search=search,
        category=category,
        resource_type=resource_type,
        level=level,
        role=role,
        topic=topic,
        section=section,
        bookmarked_only=bookmarked,
        limit=limit,
        offset=offset,
    )


@router.get("/paths")
async def get_learning_paths(
    db: DbSession,
    user: student_only,
    role: str | None = None,
) -> list[dict[str, Any]]:
    return await list_paths(db, user.id, role)


@router.get("/paths/{path_id}")
async def get_learning_path(
    path_id: int,
    db: DbSession,
    user: student_only,
) -> dict[str, Any]:
    return await _execute(get_path(db, user.id, path_id))


@router.get("/progress")
async def get_learning_progress(
    db: DbSession,
    user: student_only,
) -> dict[str, Any]:
    return await get_progress_summary(db, user.id)


@router.get("/preferences")
async def get_learning_preferences(
    db: DbSession,
    user: student_only,
) -> dict[str, str | None]:
    return await get_preference(db, user.id)


@router.patch("/preferences")
async def patch_learning_preferences(
    payload: StudentLearningPreferenceUpdate,
    db: DbSession,
    user: student_only,
) -> dict[str, str | None]:
    return await _execute(update_preference(db, user.id, payload))


@router.put("/resources/{resource_id}/progress")
async def put_learning_progress(
    resource_id: int,
    payload: ResourceProgressUpdate,
    db: DbSession,
    user: student_only,
) -> dict[str, Any]:
    return await _execute(update_progress(db, user.id, resource_id, payload))


@router.put("/resources/{resource_id}/bookmark")
async def put_learning_bookmark(
    resource_id: int,
    db: DbSession,
    user: student_only,
) -> dict[str, Any]:
    return await _execute(set_bookmark(db, user.id, resource_id, True))


@router.delete("/resources/{resource_id}/bookmark")
async def delete_learning_bookmark(
    resource_id: int,
    db: DbSession,
    user: student_only,
) -> dict[str, Any]:
    return await _execute(set_bookmark(db, user.id, resource_id, False))


@router.get("/recommendations")
async def get_learning_recommendations(
    db: DbSession,
    user: student_only,
    target_role: str | None = None,
) -> dict[str, Any]:
    return await _execute(get_recommendations(db, user.id, target_role))
