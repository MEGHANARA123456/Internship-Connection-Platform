"""Student learning library, progress tracking, and rule-based recommendations."""

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    InterviewReport,
    InterviewSession,
    LearningCategory,
    LearningPath,
    LearningPathResource,
    LearningResource,
    InterviewStudioAdminAudit,
    StudentLearningBookmark,
    StudentLearningPreference,
    StudentResourceProgress,
)
from app.models.interview_studio import MockTestCategory
from app.models.user import User
from app.schemas.learning_library import (
    LearningCategoryCreate,
    LearningCategoryUpdate,
    LearningPathCreate,
    LearningPathUpdate,
    LearningResourceCreate,
    LearningResourceUpdate,
    ResourceProgressUpdate,
    StudentLearningPreferenceUpdate,
)
from app.services.interview_studio_admin import _audit


class LearningLibraryError(Exception):
    def __init__(self, status_code: int, code: str):
        super().__init__(code)
        self.status_code = status_code
        self.code = code


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _resource_view(
    resource: LearningResource,
    category: LearningCategory | None,
    *,
    progress: StudentResourceProgress | None = None,
    bookmarked: bool = False,
) -> dict[str, Any]:
    return {
        "id": resource.id,
        "slug": resource.slug,
        "category_id": resource.category_id,
        "category": category.slug if category else None,
        "title": resource.title,
        "description": resource.description,
        "url": resource.url,
        "type": resource.resource_type,
        "level": resource.level,
        "role_tags": resource.role_tags or [],
        "topic_tags": resource.topic_tags or [],
        "verified_at": resource.verified_at,
        "progress": progress.status if progress else None,
        "bookmarked": bookmarked,
    }


def _intersects(items: list[str], expected: str | None) -> bool:
    if not expected:
        return True
    expected = expected.strip().casefold().replace("_", "-").replace(" ", "-")
    return any(
        expected == value.casefold()
        or expected in value.casefold()
        or value.casefold() in expected
        for value in (items or [])
    )


async def list_categories(db: AsyncSession) -> list[dict[str, Any]]:
    rows = (
        await db.execute(
            select(LearningCategory)
            .where(LearningCategory.active.is_(True))
            .order_by(LearningCategory.title)
        )
    ).scalars().all()
    return [
        {"id": row.id, "slug": row.slug, "title": row.title, "description": row.description}
        for row in rows
    ]


async def list_resources(
    db: AsyncSession,
    student_id: int,
    *,
    search: str = "",
    category: str | None = None,
    resource_type: str | None = None,
    level: str | None = None,
    role: str | None = None,
    topic: str | None = None,
    section: str | None = None,
    bookmarked_only: bool = False,
    limit: int = 100,
    offset: int = 0,
) -> dict[str, Any]:
    rows = (
        await db.execute(
            select(LearningResource, LearningCategory)
            .join(LearningCategory, LearningCategory.id == LearningResource.category_id)
            .where(
                LearningResource.active.is_(True),
                LearningResource.verified_at.is_not(None),
                LearningCategory.active.is_(True),
            )
            .order_by(LearningResource.title)
        )
    ).all()
    progress_rows = (
        await db.execute(
            select(StudentResourceProgress).where(
                StudentResourceProgress.student_id == student_id
            )
        )
    ).scalars().all()
    progress_by_id = {row.resource_id: row for row in progress_rows}
    bookmark_ids = set(
        (
            await db.execute(
                select(StudentLearningBookmark.resource_id).where(
                    StudentLearningBookmark.student_id == student_id
                )
            )
        ).scalars().all()
    )
    needle = search.strip().casefold()
    result: list[dict[str, Any]] = []
    for resource, resource_category in rows:
        topics = resource.topic_tags or []
        if category and resource_category.slug != category:
            continue
        if resource_type and resource.resource_type != resource_type:
            continue
        if level and level != "ALL" and resource.level not in {"ALL", level}:
            continue
        if not _intersects(resource.role_tags or [], role):
            continue
        if not _intersects(topics, topic):
            continue
        if section and not _intersects(topics, section):
            continue
        if bookmarked_only and resource.id not in bookmark_ids:
            continue
        if needle and needle not in f"{resource.title} {resource.description} {' '.join(topics)}".casefold():
            continue
        result.append(
            _resource_view(
                resource,
                resource_category,
                progress=progress_by_id.get(resource.id),
                bookmarked=resource.id in bookmark_ids,
            )
        )
    total = len(result)
    return {
        "items": result[offset:offset + min(max(limit, 1), 200)],
        "total": total,
    }


async def _path_view(
    db: AsyncSession,
    student_id: int,
    path: LearningPath,
) -> dict[str, Any]:
    category = await db.get(LearningCategory, path.category_id)
    rows = (
        await db.execute(
            select(LearningPathResource, LearningResource, LearningCategory)
            .join(LearningResource, LearningResource.id == LearningPathResource.resource_id)
            .join(LearningCategory, LearningCategory.id == LearningResource.category_id)
            .where(
                LearningPathResource.learning_path_id == path.id,
                LearningResource.active.is_(True),
                LearningResource.verified_at.is_not(None),
                LearningCategory.active.is_(True),
            )
            .order_by(LearningPathResource.position)
        )
    ).all()
    resource_ids = [resource.id for _, resource, _ in rows]
    progress_rows = (
        await db.execute(
            select(StudentResourceProgress).where(
                StudentResourceProgress.student_id == student_id,
                StudentResourceProgress.resource_id.in_(resource_ids or [-1]),
            )
        )
    ).scalars().all()
    progress_by_id = {item.resource_id: item for item in progress_rows}
    bookmarks = set(
        (
            await db.execute(
                select(StudentLearningBookmark.resource_id).where(
                    StudentLearningBookmark.student_id == student_id,
                    StudentLearningBookmark.resource_id.in_(resource_ids or [-1]),
                )
            )
        ).scalars().all()
    )
    resources = []
    for assignment, resource, resource_category in rows:
        resources.append(
            {
                "position": assignment.position,
                **_resource_view(
                    resource,
                    resource_category,
                    progress=progress_by_id.get(resource.id),
                    bookmarked=resource.id in bookmarks,
                ),
            }
        )
    total = len(resources)
    completed = sum(
        1 for resource in resources if resource["progress"] == "COMPLETED"
    )
    return {
        "id": path.id,
        "slug": path.slug,
        "category": category.slug if category else None,
        "title": path.title,
        "description": path.description,
        "role_tags": path.role_tags or [],
        "topic_tags": path.topic_tags or [],
        "resource_count": total,
        "completed_count": completed,
        "progress_percent": round(completed * 100 / total) if total else 0,
        "resources": resources,
    }


async def list_paths(
    db: AsyncSession,
    student_id: int,
    role: str | None = None,
) -> list[dict[str, Any]]:
    paths = (
        await db.execute(
            select(LearningPath)
            .where(
                LearningPath.active.is_(True),
                LearningPath.category_id.in_(
                    select(LearningCategory.id).where(LearningCategory.active.is_(True))
                ),
            )
            .order_by(LearningPath.title)
        )
    ).scalars().all()
    result = []
    for path in paths:
        if role and role not in (path.role_tags or []):
            continue
        result.append(await _path_view(db, student_id, path))
    return result


async def get_path(
    db: AsyncSession,
    student_id: int,
    path_id: int,
) -> dict[str, Any]:
    path = await db.scalar(
        select(LearningPath).where(
            LearningPath.id == path_id,
            LearningPath.active.is_(True),
            LearningPath.category_id.in_(
                select(LearningCategory.id).where(LearningCategory.active.is_(True))
            ),
        )
    )
    if path is None:
        raise LearningLibraryError(404, "learning_path_not_found")
    return await _path_view(db, student_id, path)


async def update_progress(
    db: AsyncSession,
    student_id: int,
    resource_id: int,
    payload: ResourceProgressUpdate,
) -> dict[str, Any]:
    resource = await db.scalar(
        select(LearningResource).where(
            LearningResource.id == resource_id,
            LearningResource.active.is_(True),
            LearningResource.verified_at.is_not(None),
        )
    )
    if resource is None:
        raise LearningLibraryError(404, "learning_resource_not_found")
    progress = await db.scalar(
        select(StudentResourceProgress)
        .where(
            StudentResourceProgress.student_id == student_id,
            StudentResourceProgress.resource_id == resource_id,
        )
        .with_for_update()
    )
    now = _now()
    if progress is None:
        progress = StudentResourceProgress(
            student_id=student_id,
            resource_id=resource_id,
            status=payload.status,
            viewed_at=now,
            completed_at=now if payload.status == "COMPLETED" else None,
        )
        db.add(progress)
        try:
            await db.commit()
        except IntegrityError:
            await db.rollback()
            progress = await db.scalar(
                select(StudentResourceProgress).where(
                    StudentResourceProgress.student_id == student_id,
                    StudentResourceProgress.resource_id == resource_id,
                )
            )
            if progress is None:
                raise
    else:
        progress.viewed_at = now
        if payload.status == "COMPLETED":
            progress.status = "COMPLETED"
            progress.completed_at = progress.completed_at or now
        await db.commit()
    return {
        "resource_id": resource_id,
        "status": progress.status,
        "viewed_at": progress.viewed_at,
        "completed_at": progress.completed_at,
    }


async def set_bookmark(
    db: AsyncSession,
    student_id: int,
    resource_id: int,
    bookmarked: bool,
) -> dict[str, Any]:
    resource = await db.scalar(
        select(LearningResource.id).where(
            LearningResource.id == resource_id,
            LearningResource.active.is_(True),
            LearningResource.verified_at.is_not(None),
        )
    )
    if resource is None:
        raise LearningLibraryError(404, "learning_resource_not_found")
    row = await db.scalar(
        select(StudentLearningBookmark)
        .where(
            StudentLearningBookmark.student_id == student_id,
            StudentLearningBookmark.resource_id == resource_id,
        )
        .with_for_update()
    )
    if bookmarked and row is None:
        db.add(
            StudentLearningBookmark(student_id=student_id, resource_id=resource_id)
        )
        try:
            await db.commit()
        except IntegrityError:
            await db.rollback()
            row = await db.scalar(
                select(StudentLearningBookmark).where(
                    StudentLearningBookmark.student_id == student_id,
                    StudentLearningBookmark.resource_id == resource_id,
                )
            )
            if row is None:
                raise
    elif not bookmarked and row is not None:
        await db.delete(row)
        await db.commit()
    return {"resource_id": resource_id, "bookmarked": bookmarked}


async def get_progress_summary(
    db: AsyncSession,
    student_id: int,
) -> dict[str, Any]:
    rows = (
        await db.execute(
            select(StudentResourceProgress, LearningResource, LearningCategory)
            .join(LearningResource, LearningResource.id == StudentResourceProgress.resource_id)
            .join(LearningCategory, LearningCategory.id == LearningResource.category_id)
            .where(
                StudentResourceProgress.student_id == student_id,
                LearningResource.active.is_(True),
                LearningResource.verified_at.is_not(None),
                LearningCategory.active.is_(True),
            )
            .order_by(StudentResourceProgress.viewed_at.desc())
        )
    ).all()
    resources = [
        {
            **_resource_view(resource, category, progress=progress),
            "viewed_at": progress.viewed_at,
            "completed_at": progress.completed_at,
        }
        for progress, resource, category in rows
    ]
    return {
        "viewed_count": len(resources),
        "completed_count": sum(1 for row in resources if row["progress"] == "COMPLETED"),
        "items": resources,
    }


async def get_preference(db: AsyncSession, student_id: int) -> dict[str, str | None]:
    row = await db.get(StudentLearningPreference, student_id)
    return {"target_role": row.target_role if row else None}


async def update_preference(
    db: AsyncSession,
    student_id: int,
    payload: StudentLearningPreferenceUpdate,
) -> dict[str, str | None]:
    row = await db.get(StudentLearningPreference, student_id, with_for_update=True)
    if row is None:
        row = StudentLearningPreference(
            student_id=student_id,
            target_role=payload.target_role,
            updated_at=_now(),
        )
        db.add(row)
    else:
        row.target_role = payload.target_role
        row.updated_at = _now()
    await db.commit()
    return {"target_role": row.target_role}


_WEAK_SKILL_TOPIC_MAP = {
    "communication": {"communication", "behavioral-interview", "interview-questions"},
    "structure": {"communication", "interview-questions", "behavioral-interview"},
    "relevance": {"interview-questions", "coding-practice", "data-analysis"},
    "completeness": {"interview-questions", "programming-fundamentals", "data-analysis"},
    "technical-correctness": {"programming-fundamentals", "python", "java", "sql", "machine-learning"},
    "data-quality": {"pandas", "sql", "data-analysis"},
    "algorithms": {"algorithms", "coding-practice", "practice-tests"},
}


async def get_recommendations(
    db: AsyncSession,
    student_id: int,
    target_role: str | None = None,
) -> dict[str, Any]:
    preference = await get_preference(db, student_id)
    role = target_role or preference["target_role"]
    if role and role not in {
        "data-scientist", "data-analyst", "python-developer", "java-developer",
        "frontend-developer", "ml-engineer", "hr-interview", "video-interview",
    }:
        raise LearningLibraryError(422, "invalid_target_role")

    report_row = await db.execute(
        select(InterviewReport)
        .join(InterviewSession, InterviewSession.id == InterviewReport.session_id)
        .where(
            InterviewSession.student_id == student_id,
            InterviewReport.status == "COMPLETED",
            InterviewReport.skill_breakdown.is_not(None),
        )
        .order_by(InterviewReport.completed_at.desc(), InterviewReport.id.desc())
        .limit(1)
    )
    report = report_row.scalar_one_or_none()
    weakest_skill = None
    if report is not None and report.skill_breakdown:
        weakest_skill = min(report.skill_breakdown, key=report.skill_breakdown.get)

    all_paths = (
        await db.execute(
            select(LearningPath).where(
                LearningPath.active.is_(True),
                LearningPath.category_id.in_(
                    select(LearningCategory.id).where(LearningCategory.active.is_(True))
                ),
            )
        )
    ).scalars().all()
    role_paths = [
        path for path in all_paths if role and role in (path.role_tags or [])
    ]
    role_resource_ids: set[int] = set()
    if role:
        role_resources = (
            await db.execute(
                select(LearningResource).where(
                    LearningResource.active.is_(True),
                    LearningResource.verified_at.is_not(None),
                )
            )
        ).scalars().all()
        role_resource_ids = {
            resource.id for resource in role_resources if role in (resource.role_tags or [])
        }

    weak_topics = set()
    if weakest_skill:
        normalized = weakest_skill.casefold().replace("_", "-").replace(" ", "-")
        for key, topics in _WEAK_SKILL_TOPIC_MAP.items():
            if key in normalized or normalized in key:
                weak_topics.update(topics)
        weak_topics.add(normalized)
    rows = (
        await db.execute(
            select(LearningResource, LearningCategory)
            .join(LearningCategory, LearningCategory.id == LearningResource.category_id)
            .where(
                LearningResource.active.is_(True),
                LearningResource.verified_at.is_not(None),
                LearningCategory.active.is_(True),
            )
            .order_by(LearningResource.title)
        )
    ).all()
    candidates: list[tuple[int, LearningResource, LearningCategory]] = []
    for resource, category in rows:
        resource_topics = set(resource.topic_tags or [])
        topic_match = bool(weak_topics.intersection(resource_topics))
        role_match = resource.id in role_resource_ids
        if not role and not weak_topics:
            continue
        if (role_match or topic_match) and (role is None or role_match or topic_match):
            score = int(role_match) + int(topic_match)
            candidates.append((score, resource, category))
    candidates.sort(key=lambda item: (-item[0], item[1].title.casefold()))
    selected = candidates[:8]
    selected_ids = [resource.id for _score, resource, _category in selected]
    progress_by_id = {
        row.resource_id: row
        for row in (
            await db.execute(
                select(StudentResourceProgress).where(
                    StudentResourceProgress.student_id == student_id,
                    StudentResourceProgress.resource_id.in_(selected_ids or [-1]),
                )
            )
        ).scalars().all()
    }
    bookmark_ids = set(
        (
            await db.execute(
                select(StudentLearningBookmark.resource_id).where(
                    StudentLearningBookmark.student_id == student_id,
                    StudentLearningBookmark.resource_id.in_(selected_ids or [-1]),
                )
            )
        ).scalars().all()
    )
    selected_resources = [
        _resource_view(
            resource,
            category,
            progress=progress_by_id.get(resource.id),
            bookmarked=resource.id in bookmark_ids,
        )
        for _score, resource, category in selected
    ]
    paths = sorted(role_paths, key=lambda path: path.title.casefold())
    return {
        "target_role": role,
        "weakest_skill": weakest_skill,
        "resources": selected_resources,
        "paths": [
            {
                "id": path.id,
                "slug": path.slug,
                "title": path.title,
                "description": path.description,
            }
            for path in paths
        ],
    }


def _resource_admin_view(
    resource: LearningResource,
    category: LearningCategory | None,
) -> dict[str, Any]:
    return {
        "id": resource.id,
        "slug": resource.slug,
        "category_id": resource.category_id,
        "category": category.slug if category else None,
        "title": resource.title,
        "description": resource.description,
        "url": resource.url,
        "type": resource.resource_type,
        "level": resource.level,
        "role_tags": resource.role_tags or [],
        "topic_tags": resource.topic_tags or [],
        "active": resource.active,
        "verified_at": resource.verified_at,
    }


async def admin_list_categories(db: AsyncSession) -> list[dict[str, Any]]:
    rows = (await db.execute(select(LearningCategory).order_by(LearningCategory.title))).scalars().all()
    return [
        {
            "id": row.id, "slug": row.slug, "title": row.title,
            "description": row.description, "active": row.active,
        }
        for row in rows
    ]


async def admin_create_category(
    db: AsyncSession,
    actor: User,
    payload: LearningCategoryCreate,
) -> dict[str, Any]:
    row = LearningCategory(
        slug=payload.slug,
        title=payload.title.strip(),
        description=payload.description.strip(),
        active=payload.active,
    )
    db.add(row)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise LearningLibraryError(409, "learning_category_slug_exists") from None
    await _audit(
        db, actor, "learning_category_created", "learning_category", row.id,
        {"before": None, "after": {"slug": row.slug, "title": row.title, "active": row.active}},
    )
    await db.commit()
    return {
        "id": row.id, "slug": row.slug, "title": row.title,
        "description": row.description, "active": row.active,
    }


async def admin_update_category(
    db: AsyncSession,
    actor: User,
    category_id: int,
    payload: LearningCategoryUpdate,
) -> dict[str, Any]:
    row = await db.get(LearningCategory, category_id, with_for_update=True)
    if row is None:
        raise LearningLibraryError(404, "learning_category_not_found")
    changes = payload.model_dump(exclude_unset=True, exclude_none=True)
    if not changes:
        raise LearningLibraryError(422, "no_learning_category_changes")
    before = {"title": row.title, "description": row.description, "active": row.active}
    for field, value in changes.items():
        setattr(row, field, value.strip() if isinstance(value, str) else value)
    await _audit(
        db, actor, "learning_category_updated", "learning_category", row.id,
        {
            "changed_fields": sorted(changes),
            "before": before,
            "after": {"title": row.title, "description": row.description, "active": row.active},
        },
    )
    await db.commit()
    return {
        "id": row.id, "slug": row.slug, "title": row.title,
        "description": row.description, "active": row.active,
    }


async def admin_list_resources(db: AsyncSession) -> list[dict[str, Any]]:
    rows = (
        await db.execute(
            select(LearningResource, LearningCategory)
            .join(LearningCategory, LearningCategory.id == LearningResource.category_id)
            .order_by(LearningResource.title)
        )
    ).all()
    return [_resource_admin_view(resource, category) for resource, category in rows]


async def _validate_admin_resource_category(
    db: AsyncSession,
    category_id: int,
    active: bool,
) -> LearningCategory:
    category = await db.get(LearningCategory, category_id)
    if category is None:
        raise LearningLibraryError(422, "learning_category_not_found")
    if active and not category.active:
        raise LearningLibraryError(422, "learning_category_inactive")
    return category


async def admin_create_resource(
    db: AsyncSession,
    actor: User,
    payload: LearningResourceCreate,
) -> dict[str, Any]:
    category = await _validate_admin_resource_category(
        db, payload.category_id, payload.active
    )
    resource = LearningResource(
        slug=payload.slug,
        category_id=category.id,
        title=payload.title.strip(),
        description=payload.description.strip(),
        url=payload.url,
        resource_type=payload.resource_type,
        level=payload.level,
        role_tags=payload.role_tags,
        topic_tags=payload.topic_tags,
        active=payload.active,
        verified_at=None,
        created_by=actor.id,
        updated_at=_now(),
    )
    db.add(resource)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise LearningLibraryError(409, "learning_resource_slug_exists") from None
    await _audit(
        db, actor, "learning_resource_created", "learning_resource", resource.id,
        {"before": None, "after": {"slug": resource.slug, "category_id": category.id, "active": resource.active, "verified": False}},
    )
    await db.commit()
    return _resource_admin_view(resource, category)


async def admin_update_resource(
    db: AsyncSession,
    actor: User,
    resource_id: int,
    payload: LearningResourceUpdate,
) -> dict[str, Any]:
    resource = await db.get(LearningResource, resource_id, with_for_update=True)
    if resource is None:
        raise LearningLibraryError(404, "learning_resource_not_found")
    changes = payload.model_dump(exclude_unset=True, exclude_none=True)
    if not changes:
        raise LearningLibraryError(422, "no_learning_resource_changes")
    if "category_id" in changes:
        await _validate_admin_resource_category(
            db, changes["category_id"], changes.get("active", resource.active)
        )
    elif changes.get("active") is True:
        await _validate_admin_resource_category(db, resource.category_id, True)
    before = {
        "title": resource.title,
        "url": resource.url,
        "active": resource.active,
        "verified": resource.verified_at is not None,
    }
    if "url" in changes and changes["url"] != resource.url:
        resource.verified_at = None
    for field, value in changes.items():
        setattr(resource, field, value.strip() if isinstance(value, str) else value)
    resource.updated_at = _now()
    category = await db.get(LearningCategory, resource.category_id)
    await _audit(
        db, actor, "learning_resource_updated", "learning_resource", resource.id,
        {
            "changed_fields": sorted(changes),
            "before": before,
            "after": {
                "title": resource.title,
                "url": resource.url,
                "active": resource.active,
                "verified": resource.verified_at is not None,
            },
        },
    )
    await db.commit()
    return _resource_admin_view(resource, category)


async def admin_verify_resource(
    db: AsyncSession,
    actor: User,
    resource_id: int,
) -> dict[str, Any]:
    resource = await db.get(LearningResource, resource_id, with_for_update=True)
    if resource is None:
        raise LearningLibraryError(404, "learning_resource_not_found")
    from app.schemas.learning_library import validate_https_url

    try:
        validate_https_url(resource.url)
    except ValueError:
        raise LearningLibraryError(422, "learning_resource_url_invalid") from None
    category = await _validate_admin_resource_category(db, resource.category_id, resource.active)
    before = {"verified": resource.verified_at is not None}
    resource.verified_at = _now()
    resource.updated_at = _now()
    await _audit(
        db, actor, "learning_resource_verified", "learning_resource", resource.id,
        {"before": before, "after": {"verified": True}},
    )
    await db.commit()
    return _resource_admin_view(resource, category)


async def _path_admin_view(db: AsyncSession, path: LearningPath) -> dict[str, Any]:
    rows = (
        await db.execute(
            select(LearningPathResource, LearningResource)
            .join(LearningResource, LearningResource.id == LearningPathResource.resource_id)
            .where(LearningPathResource.learning_path_id == path.id)
            .order_by(LearningPathResource.position)
        )
    ).all()
    return {
        "id": path.id,
        "slug": path.slug,
        "category_id": path.category_id,
        "title": path.title,
        "description": path.description,
        "role_tags": path.role_tags or [],
        "topic_tags": path.topic_tags or [],
        "active": path.active,
        "resources": [
            {"resource_id": assignment.resource_id, "position": assignment.position,
             "title": resource.title, "active": resource.active,
             "verified": resource.verified_at is not None}
            for assignment, resource in rows
        ],
    }


async def admin_list_paths(db: AsyncSession) -> list[dict[str, Any]]:
    paths = (await db.execute(select(LearningPath).order_by(LearningPath.title))).scalars().all()
    return [await _path_admin_view(db, path) for path in paths]


async def admin_list_audit_events(
    db: AsyncSession,
    limit: int = 100,
) -> list[dict[str, Any]]:
    rows = (
        await db.execute(
            select(InterviewStudioAdminAudit)
            .where(InterviewStudioAdminAudit.action.like("learning_%"))
            .order_by(
                InterviewStudioAdminAudit.created_at.desc(),
                InterviewStudioAdminAudit.id.desc(),
            )
            .limit(min(max(limit, 1), 200))
        )
    ).scalars().all()
    return [
        {
            "id": row.id,
            "actor_id": row.actor_id,
            "action": row.action,
            "entity_type": row.entity_type,
            "entity_id": row.entity_id,
            "summary": row.summary,
            "created_at": row.created_at,
        }
        for row in rows
    ]


async def _validate_path_resources(
    db: AsyncSession,
    payload: LearningPathCreate | LearningPathUpdate,
) -> LearningCategory:
    category = await db.get(LearningCategory, payload.category_id)
    if category is None:
        raise LearningLibraryError(422, "learning_category_not_found")
    if payload.active and not category.active:
        raise LearningLibraryError(422, "learning_category_inactive")
    ids = [row.resource_id for row in payload.resources]
    resources = (
        await db.execute(
            select(LearningResource).where(LearningResource.id.in_(ids))
        )
    ).scalars().all()
    if len(resources) != len(ids):
        raise LearningLibraryError(422, "learning_path_resource_not_found")
    if payload.active and any(
        not resource.active or resource.verified_at is None for resource in resources
    ):
        raise LearningLibraryError(422, "learning_path_resources_must_be_verified_active")
    return category


async def admin_create_path(
    db: AsyncSession,
    actor: User,
    payload: LearningPathCreate,
) -> dict[str, Any]:
    await _validate_path_resources(db, payload)
    path = LearningPath(
        slug=payload.slug,
        category_id=payload.category_id,
        title=payload.title.strip(),
        description=payload.description.strip(),
        role_tags=payload.role_tags,
        topic_tags=payload.topic_tags,
        active=payload.active,
    )
    db.add(path)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise LearningLibraryError(409, "learning_path_slug_exists") from None
    for position, assignment in enumerate(payload.resources, start=1):
        db.add(
            LearningPathResource(
                learning_path_id=path.id,
                resource_id=assignment.resource_id,
                position=position,
            )
        )
    await _audit(
        db, actor, "learning_path_created", "learning_path", path.id,
        {"before": None, "after": {"slug": path.slug, "active": path.active, "resource_count": len(payload.resources)}},
    )
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise LearningLibraryError(409, "learning_path_slug_exists") from None
    return await _path_admin_view(db, path)


async def admin_update_path(
    db: AsyncSession,
    actor: User,
    path_id: int,
    payload: LearningPathUpdate,
) -> dict[str, Any]:
    path = await db.get(LearningPath, path_id, with_for_update=True)
    if path is None:
        raise LearningLibraryError(404, "learning_path_not_found")
    await _validate_path_resources(db, payload)
    before = {"title": path.title, "active": path.active}
    existing = (
        await db.execute(
            select(LearningPathResource).where(
                LearningPathResource.learning_path_id == path.id
            )
        )
    ).scalars().all()
    for assignment in existing:
        await db.delete(assignment)
    await db.flush()
    path.category_id = payload.category_id
    path.title = payload.title.strip()
    path.description = payload.description.strip()
    path.role_tags = payload.role_tags
    path.topic_tags = payload.topic_tags
    path.active = payload.active
    for position, assignment in enumerate(payload.resources, start=1):
        db.add(
            LearningPathResource(
                learning_path_id=path.id,
                resource_id=assignment.resource_id,
                position=position,
            )
        )
    await _audit(
        db, actor, "learning_path_updated", "learning_path", path.id,
        {
            "before": before,
            "after": {"title": path.title, "active": path.active, "resource_count": len(payload.resources)},
        },
    )
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise LearningLibraryError(409, "learning_path_update_conflict") from None
    return await _path_admin_view(db, path)
