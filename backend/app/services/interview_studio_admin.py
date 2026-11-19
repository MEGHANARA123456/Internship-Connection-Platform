"""Admin-only Interview Studio curation and anonymized operations reporting."""

import csv
import io
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import case, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import ValidationError

from app.core.config import get_settings
from app.models import (
    InterviewEvaluation,
    InterviewAnswer,
    InterviewQuestionBank,
    InterviewQuestion,
    InterviewRecording,
    InterviewReport,
    InterviewSession,
    InterviewStudioAdminAudit,
    InterviewStudioDifficulty,
    InterviewStudioSetting,
    InterviewStudioUsageEvent,
    MockTest,
    MockTestCategory,
    MockTestQuestion,
    User,
)
from app.schemas.interview_admin import (
    CategoryCreate,
    InterviewStudioSettingsUpdate,
    MockTestCreate,
    MockTestUpdate,
    QuestionCreate,
    QuestionUpdate,
)
from app.services.interview_studio import InterviewStudioError
from app.schemas.interview import InterviewAnswerView

_QUESTION_CSV_COLUMNS = {
    "seed_key",
    "category",
    "difficulty",
    "prompt",
    "hint",
    "rubric",
}
_QUESTION_CATEGORIES = {"HR", "TECHNICAL", "DATA_SCIENCE", "BEHAVIORAL"}
_DIFFICULTIES = {"BEGINNER", "INTERMEDIATE", "ADVANCED"}
_SETTINGS_RANGES = {
    "retention_days": (1, 365),
    "sessions_per_day": (1, 50),
}


class InterviewAdminError(Exception):
    def __init__(self, status_code: int, code: str):
        super().__init__(code)
        self.status_code = status_code
        self.code = code


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def _audit(
    db: AsyncSession,
    actor: User,
    action: str,
    entity_type: str,
    entity_id: int | str | None,
    summary: dict[str, Any],
) -> None:
    db.add(
        InterviewStudioAdminAudit(
            actor_id=actor.id,
            action=action,
            entity_type=entity_type,
            entity_id=str(entity_id) if entity_id is not None else None,
            summary=summary,
        )
    )


def _question_view(question: InterviewQuestionBank) -> dict[str, Any]:
    metadata = question.source_metadata or {}
    return {
        "id": question.id,
        "seed_key": question.seed_key,
        "category": question.category,
        "difficulty": question.difficulty,
        "prompt": question.prompt,
        "hint": question.hint,
        "rubric": question.rubric,
        "active": question.active,
        "review_status": metadata.get("status", "DRAFT-for-review"),
        "created_at": question.created_at,
    }


async def list_questions(
    db: AsyncSession,
    *,
    search: str = "",
    category: str | None = None,
    difficulty: str | None = None,
    review_status: str | None = None,
    active: bool | None = None,
    limit: int = 100,
    offset: int = 0,
) -> dict[str, Any]:
    statement = select(InterviewQuestionBank)
    if category:
        statement = statement.where(InterviewQuestionBank.category == category)
    if difficulty:
        statement = statement.where(InterviewQuestionBank.difficulty == difficulty)
    if active is not None:
        statement = statement.where(InterviewQuestionBank.active.is_(active))
    if search.strip():
        term = f"%{search.strip()}%"
        statement = statement.where(
            InterviewQuestionBank.prompt.ilike(term)
            | InterviewQuestionBank.seed_key.ilike(term)
        )
    rows = (await db.execute(statement.order_by(InterviewQuestionBank.id.desc()))).scalars().all()
    if review_status:
        rows = [
            row for row in rows
            if (row.source_metadata or {}).get("status", "DRAFT-for-review")
            == review_status
        ]
    total = len(rows)
    page = rows[offset:offset + min(max(limit, 1), 200)]
    return {"items": [_question_view(row) for row in page], "total": total}


async def create_question(
    db: AsyncSession,
    actor: User,
    payload: QuestionCreate,
) -> dict[str, Any]:
    if payload.category not in _QUESTION_CATEGORIES:
        raise InterviewAdminError(422, "invalid_question_category")
    if payload.difficulty not in _DIFFICULTIES:
        raise InterviewAdminError(422, "invalid_question_difficulty")
    question = InterviewQuestionBank(
        seed_key=payload.seed_key,
        category=payload.category,
        difficulty=payload.difficulty,
        prompt=payload.prompt.strip(),
        hint=payload.hint.strip(),
        rubric=payload.rubric.strip(),
        active=True,
        source_metadata={"status": "DRAFT-for-review", "source": "admin"},
    )
    db.add(question)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise InterviewAdminError(409, "question_seed_key_exists") from None
    await _audit(
        db, actor, "question_created", "question", question.id,
        {
            "before": None,
            "after": {
                "category": question.category,
                "difficulty": question.difficulty,
                "active": question.active,
                "review_status": "DRAFT-for-review",
            },
        },
    )
    await db.commit()
    return _question_view(question)


async def _bump_tests_using_question(
    db: AsyncSession,
    question_id: int,
) -> int:
    rows = await db.execute(
        select(MockTest, MockTestQuestion)
        .join(
            MockTestQuestion,
            (MockTestQuestion.mock_test_id == MockTest.id)
            & (MockTestQuestion.version == MockTest.version),
        )
        .where(
            MockTestQuestion.question_bank_id == question_id,
            MockTest.active.is_(True),
        )
    )
    tests_by_id: dict[int, tuple[MockTest, list[MockTestQuestion]]] = {}
    for test, assignment in rows:
        tests_by_id.setdefault(test.id, (test, []))[1].append(assignment)
    for test, assignments in tests_by_id.values():
        new_version = test.version + 1
        all_assignments = (
            await db.execute(
                select(MockTestQuestion).where(
                    MockTestQuestion.mock_test_id == test.id,
                    MockTestQuestion.version == test.version,
                )
            )
        ).scalars().all()
        test.version = new_version
        for assignment in all_assignments:
            db.add(
                MockTestQuestion(
                    mock_test_id=test.id,
                    version=new_version,
                    question_bank_id=assignment.question_bank_id,
                    position=assignment.position,
                    skill_tags=assignment.skill_tags,
                )
            )
    return len(tests_by_id)


async def update_question(
    db: AsyncSession,
    actor: User,
    question_id: int,
    payload: QuestionUpdate,
) -> dict[str, Any]:
    question = await db.get(InterviewQuestionBank, question_id, with_for_update=True)
    if question is None:
        raise InterviewAdminError(404, "question_not_found")
    changes = payload.model_dump(exclude_unset=True, exclude_none=True)
    if not changes:
        raise InterviewAdminError(422, "no_question_changes")
    content_changed = any(
        field in changes and getattr(question, field) != changes[field]
        for field in ("category", "difficulty", "prompt", "hint", "rubric")
    )
    before_summary = {
        "category": question.category,
        "difficulty": question.difficulty,
        "active": question.active,
        "review_status": (question.source_metadata or {}).get(
            "status", "DRAFT-for-review"
        ),
    }
    metadata = dict(question.source_metadata or {})
    if content_changed:
        metadata["status"] = "DRAFT-for-review"
        question.source_metadata = metadata
    for field, value in changes.items():
        if field in {"prompt", "hint", "rubric"}:
            value = value.strip()
        setattr(question, field, value)
    invalidated_tests = 0
    if changes.get("active") is False:
        test_ids = (
            await db.execute(
                select(MockTest.id)
                .join(
                    MockTestQuestion,
                    (MockTestQuestion.mock_test_id == MockTest.id)
                    & (MockTestQuestion.version == MockTest.version),
                )
                .where(
                    MockTestQuestion.question_bank_id == question.id,
                    MockTest.active.is_(True),
                )
            )
        ).scalars().all()
        if test_ids:
            tests = (
                await db.execute(
                    select(MockTest).where(MockTest.id.in_(test_ids))
                )
            ).scalars().all()
            for test in tests:
                test.active = False
            invalidated_tests = len(tests)
    elif content_changed:
        invalidated_tests = await _bump_tests_using_question(db, question.id)
    await _audit(
        db, actor, "question_updated", "question", question.id,
        {
            "changed_fields": sorted(changes),
            "before": before_summary,
            "after": {
                "category": question.category,
                "difficulty": question.difficulty,
                "active": question.active,
                "review_status": metadata.get("status", "DRAFT-for-review"),
            },
            "affected_tests": invalidated_tests,
        },
    )
    await db.commit()
    return _question_view(question)


async def approve_question(
    db: AsyncSession,
    actor: User,
    question_id: int,
) -> dict[str, Any]:
    question = await db.get(InterviewQuestionBank, question_id, with_for_update=True)
    if question is None:
        raise InterviewAdminError(404, "question_not_found")
    metadata = dict(question.source_metadata or {})
    previous_status = metadata.get("status", "DRAFT-for-review")
    metadata["status"] = "APPROVED"
    question.source_metadata = metadata
    await _audit(
        db, actor, "question_approved", "question", question.id,
        {"before": {"review_status": previous_status},
         "after": {"review_status": "APPROVED"}},
    )
    await db.commit()
    return _question_view(question)


async def import_questions_csv(
    db: AsyncSession,
    actor: User,
    contents: str,
) -> dict[str, int]:
    if len(contents.encode("utf-8")) > 1_000_000:
        raise InterviewAdminError(413, "csv_too_large")
    reader = csv.DictReader(io.StringIO(contents))
    if reader.fieldnames is None or set(reader.fieldnames) != _QUESTION_CSV_COLUMNS:
        raise InterviewAdminError(422, "invalid_csv_columns")
    parsed: list[dict[str, str]] = []
    seen_keys: set[str] = set()
    for line_number, row in enumerate(reader, start=2):
        if len(parsed) >= 500:
            raise InterviewAdminError(422, "csv_row_limit_exceeded")
        if None in row:
            raise InterviewAdminError(422, f"invalid_csv_row_{line_number}")
        values = {key: (row.get(key) or "").strip() for key in _QUESTION_CSV_COLUMNS}
        if any(not value for value in values.values()):
            raise InterviewAdminError(422, f"invalid_csv_row_{line_number}")
        if values["category"] not in _QUESTION_CATEGORIES:
            raise InterviewAdminError(422, f"invalid_csv_category_row_{line_number}")
        if values["difficulty"] not in _DIFFICULTIES:
            raise InterviewAdminError(422, f"invalid_csv_difficulty_row_{line_number}")
        if values["seed_key"] in seen_keys:
            raise InterviewAdminError(422, f"duplicate_csv_seed_key_row_{line_number}")
        seen_keys.add(values["seed_key"])
        try:
            parsed.append(QuestionCreate.model_validate(values).model_dump())
        except ValidationError:
            raise InterviewAdminError(422, f"invalid_csv_row_{line_number}") from None
    if not parsed:
        raise InterviewAdminError(422, "csv_has_no_questions")
    existing = (
        await db.execute(
            select(InterviewQuestionBank.seed_key).where(
                InterviewQuestionBank.seed_key.in_(seen_keys)
            )
        )
    ).scalars().all()
    if existing:
        raise InterviewAdminError(409, "question_seed_key_exists")
    for values in parsed:
        db.add(
            InterviewQuestionBank(
                **values,
                active=True,
                source_metadata={"status": "DRAFT-for-review", "source": "admin_csv"},
            )
        )
    await _audit(
        db, actor, "questions_imported", "question_bank", None,
        {
            "before": None,
            "after": {
                "imported_count": len(parsed),
                "review_status": "DRAFT-for-review",
            },
        },
    )
    await db.commit()
    return {"imported": len(parsed)}


async def _validate_test_questions(
    db: AsyncSession,
    payload: MockTestCreate | MockTestUpdate,
) -> list[InterviewQuestionBank]:
    category = await db.get(MockTestCategory, payload.category_id)
    if category is None:
        raise InterviewAdminError(422, "invalid_test_category")
    if payload.active and not category.active:
        raise InterviewAdminError(422, "test_category_inactive")
    question_ids = [item.question_id for item in payload.questions]
    questions = (
        await db.execute(
            select(InterviewQuestionBank).where(
                InterviewQuestionBank.id.in_(question_ids),
                InterviewQuestionBank.active.is_(True),
            )
        )
    ).scalars().all()
    if len(questions) != len(question_ids):
        raise InterviewAdminError(422, "test_questions_must_be_active")
    return questions


def _test_view(
    test: MockTest,
    category: MockTestCategory,
    questions: list[tuple[MockTestQuestion, InterviewQuestionBank]],
) -> dict[str, Any]:
    return {
        "id": test.id,
        "slug": test.slug,
        "title": test.title,
        "description": test.description,
        "category_id": test.category_id,
        "category": category.title,
        "difficulty": test.difficulty,
        "format": test.format,
        "default_mode": test.default_mode,
        "question_count": test.question_count,
        "time_limit_seconds": test.time_limit_seconds,
        "company_style": test.company_style,
        "active": test.active,
        "version": test.version,
        "questions": [
            {
                "id": assignment.question_bank_id,
                "prompt": question.prompt,
                "skill_tags": assignment.skill_tags,
            }
            for assignment, question in questions
        ],
    }


async def _test_detail(db: AsyncSession, test: MockTest) -> dict[str, Any]:
    category = await db.get(MockTestCategory, test.category_id)
    if category is None:
        raise InterviewAdminError(409, "test_category_missing")
    assignments = (
        await db.execute(
            select(MockTestQuestion, InterviewQuestionBank)
            .join(
                InterviewQuestionBank,
                InterviewQuestionBank.id == MockTestQuestion.question_bank_id,
            )
            .where(
                MockTestQuestion.mock_test_id == test.id,
                MockTestQuestion.version == test.version,
            )
            .order_by(MockTestQuestion.position)
        )
    ).all()
    return _test_view(test, category, assignments)


async def list_tests(db: AsyncSession) -> list[dict[str, Any]]:
    tests = (
        await db.execute(select(MockTest).order_by(MockTest.id.desc()))
    ).scalars().all()
    return [await _test_detail(db, test) for test in tests]


async def create_test(
    db: AsyncSession,
    actor: User,
    payload: MockTestCreate,
) -> dict[str, Any]:
    await _validate_test_questions(db, payload)
    test = MockTest(
        slug=payload.slug,
        title=payload.title.strip(),
        description=payload.description.strip(),
        category_id=payload.category_id,
        difficulty=payload.difficulty,
        format=payload.format,
        default_mode=payload.default_mode,
        question_count=payload.question_count,
        time_limit_seconds=payload.time_limit_seconds,
        question_filter=None,
        skill_tags=sorted(
            {tag.strip() for item in payload.questions for tag in item.skill_tags if tag.strip()}
        ),
        company_style=payload.company_style,
        active=payload.active,
        version=1,
        source_metadata={
            "label": "Practice based on public or admin-curated patterns"
            if payload.company_style
            else "Admin-curated practice",
        },
    )
    db.add(test)
    await db.flush()
    for position, assignment in enumerate(payload.questions, start=1):
        db.add(
            MockTestQuestion(
                mock_test_id=test.id,
                version=1,
                question_bank_id=assignment.question_id,
                position=position,
                skill_tags=assignment.skill_tags,
            )
        )
    await _audit(
        db, actor, "test_created", "test", test.id,
        {"before": None, "after": {"version": 1, "question_count": test.question_count, "active": test.active}},
    )
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise InterviewAdminError(409, "test_slug_exists") from None
    return await _test_detail(db, test)


async def update_test(
    db: AsyncSession,
    actor: User,
    test_id: int,
    payload: MockTestUpdate,
) -> dict[str, Any]:
    test = await db.get(MockTest, test_id, with_for_update=True)
    if test is None:
        raise InterviewAdminError(404, "test_not_found")
    await _validate_test_questions(db, payload)
    changes = {
        "slug": payload.slug,
        "title": payload.title.strip(),
        "description": payload.description.strip(),
        "category_id": payload.category_id,
        "difficulty": payload.difficulty,
        "format": payload.format,
        "default_mode": payload.default_mode,
        "question_count": payload.question_count,
        "time_limit_seconds": payload.time_limit_seconds,
        "company_style": payload.company_style,
    }
    before_summary = {
        "version": test.version,
        "title": test.title,
        "active": test.active,
        "question_count": test.question_count,
    }
    content_fields = {
        key: value for key, value in changes.items()
        if key != "active" and getattr(test, key) != value
    }
    current_assignments = (
        await db.execute(
            select(MockTestQuestion)
            .where(
                MockTestQuestion.mock_test_id == test.id,
                MockTestQuestion.version == test.version,
            )
            .order_by(MockTestQuestion.position)
        )
    ).scalars().all()
    new_assignment_values = [
        (item.question_id, item.skill_tags) for item in payload.questions
    ]
    old_assignment_values = [
        (item.question_bank_id, item.skill_tags) for item in current_assignments
    ]
    assignment_changed = new_assignment_values != old_assignment_values
    for field, value in changes.items():
        setattr(test, field, value)
    test.active = payload.active
    test.skill_tags = sorted(
        {tag.strip() for item in payload.questions for tag in item.skill_tags if tag.strip()}
    )
    bumped = bool(content_fields or assignment_changed)
    if bumped:
        test.version += 1
        for position, assignment in enumerate(payload.questions, start=1):
            db.add(
                MockTestQuestion(
                    mock_test_id=test.id,
                    version=test.version,
                    question_bank_id=assignment.question_id,
                    position=position,
                    skill_tags=assignment.skill_tags,
                )
            )
    await _audit(
        db, actor, "test_updated", "test", test.id,
        {
            "before": before_summary,
            "after": {
                "version": test.version,
                "title": test.title,
                "active": test.active,
                "question_count": test.question_count,
            },
            "version_bumped": bumped,
        },
    )
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise InterviewAdminError(409, "test_slug_exists") from None
    return await _test_detail(db, test)


async def update_category(
    db: AsyncSession,
    actor: User,
    category_id: int,
    title: str,
    active: bool,
) -> dict[str, Any]:
    category = await db.get(MockTestCategory, category_id, with_for_update=True)
    if category is None:
        raise InterviewAdminError(404, "category_not_found")
    before_summary = {"title": category.title, "active": category.active}
    category.title = title.strip()
    category.active = active
    await _audit(
        db, actor, "category_updated", "category", category.id,
        {
            "before": before_summary,
            "after": {"title": category.title, "active": category.active},
        },
    )
    await db.commit()
    return {"id": category.id, "slug": category.slug, "title": category.title, "active": category.active}


async def create_category(
    db: AsyncSession,
    actor: User,
    payload: CategoryCreate,
) -> dict[str, Any]:
    category = MockTestCategory(
        slug=payload.slug,
        title=payload.label.strip(),
        active=True,
    )
    db.add(category)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise InterviewAdminError(409, "category_slug_exists") from None
    await _audit(
        db, actor, "category_created", "category", category.id,
        {"before": None, "after": {"slug": category.slug, "label": category.title, "active": True}},
    )
    await db.commit()
    return {
        "id": category.id,
        "slug": category.slug,
        "label": category.title,
        "active": category.active,
    }


async def list_taxonomy(db: AsyncSession) -> dict[str, list[dict[str, Any]]]:
    categories = (
        await db.execute(select(MockTestCategory).order_by(MockTestCategory.title))
    ).scalars().all()
    difficulties = (
        await db.execute(select(InterviewStudioDifficulty).order_by(InterviewStudioDifficulty.code))
    ).scalars().all()
    return {
        "categories": [
            {"id": item.id, "slug": item.slug, "label": item.title, "active": item.active}
            for item in categories
        ],
        "difficulties": [
            {"code": item.code, "label": item.label, "active": item.active}
            for item in difficulties
        ],
    }


async def update_difficulty(
    db: AsyncSession,
    actor: User,
    code: str,
    label: str,
    active: bool,
) -> dict[str, Any]:
    difficulty = await db.get(InterviewStudioDifficulty, code, with_for_update=True)
    if difficulty is None:
        raise InterviewAdminError(404, "difficulty_not_found")
    before_summary = {"label": difficulty.label, "active": difficulty.active}
    difficulty.label = label.strip()
    difficulty.active = active
    await _audit(
        db, actor, "difficulty_updated", "difficulty", code,
        {
            "before": before_summary,
            "after": {"label": difficulty.label, "active": difficulty.active},
        },
    )
    await db.commit()
    return {"code": difficulty.code, "label": difficulty.label, "active": difficulty.active}


async def get_settings_view(db: AsyncSession) -> dict[str, Any]:
    from app.services.interview_studio_settings import list_interview_studio_settings

    return {
        **await list_interview_studio_settings(db),
        "allowed_provider_hosts": sorted(
            {
                host.strip().casefold()
                for host in get_settings().interview_allowed_provider_hosts
                if host.strip()
            }
        ),
    }


async def update_settings(
    db: AsyncSession,
    actor: User,
    payload: InterviewStudioSettingsUpdate,
) -> dict[str, Any]:
    values = payload.model_dump(exclude_unset=True)
    from app.services.interview_studio_settings import list_interview_studio_settings

    previous = await list_interview_studio_settings(db)
    resulting = previous.copy()
    resulting.update(values)
    if resulting["video_enabled"] and not resulting["voice_enabled"]:
        raise InterviewAdminError(422, "video_requires_voice_enabled")
    if resulting["recording_enabled"] and not resulting["video_enabled"]:
        raise InterviewAdminError(422, "recording_requires_video_enabled")
    before_summary = {key: previous[key] for key in values}
    for key, value in values.items():
        if key in _SETTINGS_RANGES:
            lower, upper = _SETTINGS_RANGES[key]
            if not lower <= value <= upper:
                raise InterviewAdminError(422, "setting_value_out_of_range")
        setting = await db.get(InterviewStudioSetting, key, with_for_update=True)
        if setting is None:
            setting = InterviewStudioSetting(key=key, value=value)
            db.add(setting)
        else:
            setting.value = value
        setting.updated_by = actor.id
        setting.updated_at = _now()
    await _audit(
        db, actor, "settings_updated", "settings", None,
        {
            "changed_fields": sorted(values),
            "before": before_summary,
            "after": values,
        },
    )
    await db.commit()
    return await get_settings_view(db)


async def get_analytics(db: AsyncSession, days: int = 30) -> dict[str, Any]:
    since = _now() - timedelta(days=min(max(days, 1), 90))
    session_rows = (
        await db.execute(
            select(
                func.date(InterviewSession.created_at).label("day"),
                InterviewSession.interview_mode,
                func.count(InterviewSession.id).label("started"),
                func.sum(
                case((InterviewSession.status == "COMPLETED", 1), else_=0)
                ).label("completed"),
            )
            .where(InterviewSession.created_at >= since)
            .group_by(func.date(InterviewSession.created_at), InterviewSession.interview_mode)
            .order_by(func.date(InterviewSession.created_at))
        )
    ).all()
    report_counts = (
        await db.execute(
            select(
                func.count(InterviewReport.id),
                func.sum(case((InterviewReport.status == "FAILED", 1), else_=0)),
            ).where(InterviewReport.created_at >= since)
        )
    ).one()
    usage_rows = (
        await db.execute(
            select(
                InterviewStudioUsageEvent.event_type,
                InterviewStudioUsageEvent.status,
                func.count(InterviewStudioUsageEvent.id),
                func.sum(InterviewStudioUsageEvent.duration_ms),
                func.sum(InterviewStudioUsageEvent.prompt_tokens),
                func.sum(InterviewStudioUsageEvent.completion_tokens),
                func.sum(InterviewStudioUsageEvent.audio_seconds),
            )
            .where(InterviewStudioUsageEvent.created_at >= since)
            .group_by(
                InterviewStudioUsageEvent.event_type,
                InterviewStudioUsageEvent.status,
            )
        )
    ).all()
    storage_bytes = int(
        await db.scalar(
            select(func.coalesce(func.sum(InterviewRecording.total_bytes), 0)).where(
                InterviewRecording.status.in_(("UPLOADING", "AVAILABLE")),
                InterviewRecording.retention_expires_at > _now(),
            )
        )
        or 0
    )
    started_total = sum(int(row.started or 0) for row in session_rows)
    completed_total = sum(int(row.completed or 0) for row in session_rows)
    usage = {
        "llm_requests": 0,
        "llm_failures": 0,
        "stt_requests": 0,
        "stt_failures": 0,
        "latency_total_ms": 0,
        "latency_samples": 0,
        "token_total": 0,
        "audio_seconds": 0.0,
    }
    for event_type, status, count, latency, prompt_tokens, completion_tokens, audio_seconds in usage_rows:
        prefix = "llm" if event_type == "LLM" else "stt"
        usage[f"{prefix}_requests"] += int(count or 0)
        if status == "FAILED":
            usage[f"{prefix}_failures"] += int(count or 0)
        usage["latency_total_ms"] += int(latency or 0)
        usage["latency_samples"] += int(count or 0)
        usage["token_total"] += int(prompt_tokens or 0) + int(completion_tokens or 0)
        usage["audio_seconds"] += float(audio_seconds or 0)
    report_total = int(report_counts[0] or 0)
    report_failures = int(report_counts[1] or 0)
    return {
        "window_days": min(max(days, 1), 90),
        "daily": [
            {
                "date": str(row.day),
                "mode": row.interview_mode,
                "started": int(row.started or 0),
                "completed": int(row.completed or 0),
            }
            for row in session_rows
        ],
        "sessions_started": started_total,
        "sessions_completed": completed_total,
        "completion_rate": round(completed_total / started_total, 4) if started_total else 0,
        "mode_split": {
            mode: sum(int(row.started or 0) for row in session_rows if row.interview_mode == mode)
            for mode in ("TEXT", "VOICE", "VIDEO")
        },
        "evaluation_failure_rate": round(report_failures / report_total, 4) if report_total else 0,
        "llm_failure_rate": round(
            usage["llm_failures"] / usage["llm_requests"], 4
        ) if usage["llm_requests"] else 0,
        "stt_failure_rate": round(
            usage["stt_failures"] / usage["stt_requests"], 4
        ) if usage["stt_requests"] else 0,
        "average_latency_ms": round(
            usage["latency_total_ms"] / usage["latency_samples"]
        ) if usage["latency_samples"] else 0,
        "token_total": usage["token_total"],
        "audio_minutes": round(usage["audio_seconds"] / 60, 2),
        "storage_bytes": storage_bytes,
    }


async def get_failure_monitor(db: AsyncSession) -> dict[str, Any]:
    evaluations = (
        await db.execute(
            select(
                InterviewEvaluation.failure_code,
                func.count(InterviewEvaluation.id),
            )
            .where(InterviewEvaluation.status == "FAILED")
            .group_by(InterviewEvaluation.failure_code)
        )
    ).all()
    reports = (
        await db.execute(
            select(InterviewReport.failure_code, func.count(InterviewReport.id))
            .where(InterviewReport.status == "FAILED")
            .group_by(InterviewReport.failure_code)
        )
    ).all()
    usage = (
        await db.execute(
            select(
                InterviewStudioUsageEvent.event_type,
                InterviewStudioUsageEvent.error_code,
                func.count(InterviewStudioUsageEvent.id),
            )
            .where(InterviewStudioUsageEvent.status == "FAILED")
            .group_by(
                InterviewStudioUsageEvent.event_type,
                InterviewStudioUsageEvent.error_code,
            )
        )
    ).all()
    return {
        "evaluations": [
            {"code": code or "evaluation_failed", "count": int(count)}
            for code, count in evaluations
        ],
        "reports": [
            {"code": code or "evaluation_failed", "count": int(count)}
            for code, count in reports
        ],
        "provider_failures": [
            {"provider": event_type, "code": code or "provider_failed", "count": int(count)}
            for event_type, code, count in usage
        ],
    }


async def list_audit_events(db: AsyncSession, limit: int = 100) -> list[dict[str, Any]]:
    rows = (
        await db.execute(
            select(InterviewStudioAdminAudit)
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


async def retry_failed_evaluations(
    db: AsyncSession,
    actor: User,
    limit: int,
) -> dict[str, int]:
    from app.services.interview_studio import retry_evaluation

    session_ids = (
        await db.execute(
            select(InterviewSession.id, InterviewSession.student_id)
            .join(InterviewQuestion, InterviewQuestion.session_id == InterviewSession.id)
            .join(InterviewAnswer, InterviewAnswer.question_id == InterviewQuestion.id)
            .outerjoin(
                InterviewEvaluation,
                InterviewEvaluation.answer_id == InterviewAnswer.id,
            )
            .outerjoin(InterviewReport, InterviewReport.session_id == InterviewSession.id)
            .where(
                InterviewSession.status.in_(
                    ("EVALUATION_FAILED", "EVALUATION_PENDING", "IN_PROGRESS")
                ),
                (InterviewEvaluation.status == "FAILED")
                | (InterviewReport.status == "FAILED"),
            )
            .distinct()
            .order_by(InterviewReport.created_at)
            .limit(min(max(limit, 1), 20))
        )
    ).all()
    completed = 0
    failed = 0
    for session_id, student_id in session_ids:
        try:
            result = await retry_evaluation(db, student_id, session_id)
            recovered = getattr(result, "status", None) == "COMPLETED"
            if isinstance(result, list):
                recovered = bool(result) and all(
                    isinstance(item, InterviewAnswerView)
                    and item.evaluation_status == "COMPLETED"
                    for item in result
                )
            if recovered:
                completed += 1
            else:
                failed += 1
        except InterviewStudioError:
            await db.rollback()
            failed += 1
    await _audit(
        db, actor, "evaluation_retry_batch", "evaluation", None,
        {"attempted": len(session_ids), "completed": completed, "failed": failed},
    )
    await db.commit()
    return {"attempted": len(session_ids), "completed": completed, "failed": failed}
