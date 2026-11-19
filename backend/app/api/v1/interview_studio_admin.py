"""Admin-only Interview Studio management endpoints.

These routes intentionally return no student session, answer, report, or
recording content.
"""

from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends, HTTPException, Query

from app.api.v1.dependencies import DbSession, require_roles
from app.models import User, UserRole
from app.schemas.interview_admin import (
    CategoryCreate,
    InterviewStudioSettingsUpdate,
    LabelUpdate,
    MockTestCreate,
    MockTestUpdate,
    QuestionCreate,
    QuestionUpdate,
)
from app.services.interview_studio_admin import (
    InterviewAdminError,
    approve_question,
    create_category,
    create_question,
    create_test,
    get_analytics,
    get_failure_monitor,
    get_settings_view,
    import_questions_csv,
    list_audit_events,
    list_questions,
    list_taxonomy,
    list_tests,
    retry_failed_evaluations,
    update_category,
    update_difficulty,
    update_question,
    update_settings,
    update_test,
)

router = APIRouter(
    prefix="/admin/interview-studio",
    tags=["admin-interview-studio"],
    dependencies=[Depends(require_roles(UserRole.ADMIN))],
)
admin_user = Annotated[User, Depends(require_roles(UserRole.ADMIN))]


async def _execute(operation: Any) -> Any:
    try:
        return await operation
    except InterviewAdminError as error:
        raise HTTPException(status_code=error.status_code, detail=error.code) from error


@router.get("/questions")
async def get_questions(
    db: DbSession,
    search: str = Query(default="", max_length=200),
    category: str | None = None,
    difficulty: str | None = None,
    review_status: str | None = None,
    active: bool | None = None,
    limit: int = Query(default=100, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> dict[str, Any]:
    return await _execute(
        list_questions(
            db,
            search=search,
            category=category,
            difficulty=difficulty,
            review_status=review_status,
            active=active,
            limit=limit,
            offset=offset,
        )
    )


@router.post("/questions", status_code=201)
async def post_question(
    payload: QuestionCreate,
    db: DbSession,
    actor: admin_user,
) -> dict[str, Any]:
    return await _execute(create_question(db, actor, payload))


@router.patch("/questions/{question_id}")
async def patch_question(
    question_id: int,
    payload: QuestionUpdate,
    db: DbSession,
    actor: admin_user,
) -> dict[str, Any]:
    return await _execute(update_question(db, actor, question_id, payload))


@router.post("/questions/{question_id}/approve")
async def post_approve_question(
    question_id: int,
    db: DbSession,
    actor: admin_user,
) -> dict[str, Any]:
    return await _execute(approve_question(db, actor, question_id))


@router.post("/questions/import")
async def post_import_questions(
    contents: Annotated[str, Body(media_type="text/csv")],
    db: DbSession,
    actor: admin_user,
) -> dict[str, int]:
    return await _execute(import_questions_csv(db, actor, contents))


@router.get("/tests")
async def get_tests(db: DbSession) -> list[dict[str, Any]]:
    return await _execute(list_tests(db))


@router.post("/tests", status_code=201)
async def post_test(
    payload: MockTestCreate,
    db: DbSession,
    actor: admin_user,
) -> dict[str, Any]:
    return await _execute(create_test(db, actor, payload))


@router.put("/tests/{test_id}")
async def put_test(
    test_id: int,
    payload: MockTestUpdate,
    db: DbSession,
    actor: admin_user,
) -> dict[str, Any]:
    return await _execute(update_test(db, actor, test_id, payload))


@router.get("/taxonomy")
async def get_taxonomy(db: DbSession) -> dict[str, list[dict[str, Any]]]:
    return await list_taxonomy(db)


@router.post("/taxonomy/categories", status_code=201)
async def post_category(
    payload: CategoryCreate,
    db: DbSession,
    actor: admin_user,
) -> dict[str, Any]:
    return await _execute(create_category(db, actor, payload))


@router.patch("/taxonomy/categories/{category_id}")
async def patch_category(
    category_id: int,
    payload: LabelUpdate,
    db: DbSession,
    actor: admin_user,
) -> dict[str, Any]:
    return await _execute(
        update_category(db, actor, category_id, payload.label, payload.active)
    )


@router.patch("/taxonomy/difficulties/{code}")
async def patch_difficulty(
    code: str,
    payload: LabelUpdate,
    db: DbSession,
    actor: admin_user,
) -> dict[str, Any]:
    return await _execute(
        update_difficulty(db, actor, code, payload.label, payload.active)
    )


@router.get("/settings")
async def get_interview_settings(db: DbSession) -> dict[str, Any]:
    return await get_settings_view(db)


@router.patch("/settings")
async def patch_interview_settings(
    payload: InterviewStudioSettingsUpdate,
    db: DbSession,
    actor: admin_user,
) -> dict[str, Any]:
    return await _execute(update_settings(db, actor, payload))


@router.get("/analytics")
async def get_interview_analytics(
    db: DbSession,
    days: int = Query(default=30, ge=1, le=90),
) -> dict[str, Any]:
    return await get_analytics(db, days)


@router.get("/failures")
async def get_interview_failures(db: DbSession) -> dict[str, Any]:
    return await get_failure_monitor(db)


@router.post("/failures/retry")
async def post_retry_failed_evaluations(
    db: DbSession,
    actor: admin_user,
    limit: int = Query(default=10, ge=1, le=20),
) -> dict[str, int]:
    return await _execute(retry_failed_evaluations(db, actor, limit))


@router.get("/audit")
async def get_interview_audit(
    db: DbSession,
    limit: int = Query(default=100, ge=1, le=200),
) -> list[dict[str, Any]]:
    return await list_audit_events(db, limit)
