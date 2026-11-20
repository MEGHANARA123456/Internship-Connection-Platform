"""Student-scoped catalog, attempts, comparisons, and recommendations."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    InterviewReport,
    InterviewSession,
    InterviewQuestionBank,
    InterviewStudioDifficulty,
    MockTest,
    MockTestCategory,
    MockTestQuestion,
)
from app.schemas.interview import (
    MockTestAttemptSummary,
    MockTestComparisonView,
    MockTestQuestionView,
    MockTestRecommendationView,
    MockTestView,
)
from app.services.interview_studio import InterviewStudioError


async def _get_test(
    db: AsyncSession,
    test_id: int,
    *,
    include_inactive: bool = False,
) -> tuple[MockTest, MockTestCategory]:
    statement = (
        select(MockTest, MockTestCategory)
        .join(MockTestCategory, MockTestCategory.id == MockTest.category_id)
        .join(
            InterviewStudioDifficulty,
            InterviewStudioDifficulty.code == MockTest.difficulty,
        )
        .where(MockTest.id == test_id)
    )
    if not include_inactive:
        statement = statement.where(
            MockTest.active.is_(True),
            MockTestCategory.active.is_(True),
            InterviewStudioDifficulty.active.is_(True),
        )
    row = (await db.execute(statement)).first()
    if row is None:
        raise InterviewStudioError(404, "mock_test_not_found")
    return row


async def _attempt_rows(
    db: AsyncSession,
    student_id: int,
    test_id: int,
    *,
    limit: int | None = None,
) -> list[tuple[InterviewSession, InterviewReport | None]]:
    statement = (
        select(InterviewSession, InterviewReport)
        .outerjoin(InterviewReport, InterviewReport.session_id == InterviewSession.id)
        .where(
            InterviewSession.student_id == student_id,
            InterviewSession.mock_test_id == test_id,
        )
        .order_by(InterviewSession.created_at.desc(), InterviewSession.id.desc())
    )
    if limit is not None:
        statement = statement.limit(limit)
    return list((await db.execute(statement)).all())


def _attempt_summary(
    session: InterviewSession,
    report: InterviewReport | None,
) -> MockTestAttemptSummary:
    return MockTestAttemptSummary(
        session_id=session.id,
        test_version=session.mock_test_version or 1,
        session_type=session.session_type,
        interview_mode=session.interview_mode,
        status=session.status,
        created_at=session.created_at,
        completed_at=session.completed_at,
        overall_score=(
            report.overall_score
            if report is not None and report.status == "COMPLETED"
            else None
        ),
        skill_breakdown=(
            report.skill_breakdown
            if report is not None and report.status == "COMPLETED"
            else None
        ),
    )


def _test_view(
    test: MockTest,
    category: MockTestCategory,
    attempts: list[tuple[InterviewSession, InterviewReport | None]],
    questions: list[MockTestQuestionView] | None = None,
) -> MockTestView:
    latest = _attempt_summary(*attempts[0]) if attempts else None
    return MockTestView(
        id=test.id,
        slug=test.slug,
        title=test.title,
        description=test.description,
        category=category.slug,
        difficulty=test.difficulty,
        format=test.format,
        default_mode=test.default_mode,
        question_count=test.question_count,
        time_limit_seconds=test.time_limit_seconds,
        estimated_duration_minutes=max(1, (test.time_limit_seconds + 59) // 60),
        skill_tags=test.skill_tags,
        company_style=test.company_style,
        version=test.version,
        attempt_count=len(attempts),
        completed_attempt_count=sum(
            1
            for session, report in attempts
            if session.status == "COMPLETED"
            and report is not None
            and report.status == "COMPLETED"
        ),
        latest_score=latest.overall_score if latest else None,
        latest_status=latest.status if latest else None,
        questions=questions,
        attempts=[_attempt_summary(*attempt) for attempt in attempts],
    )


async def list_mock_tests(
    db: AsyncSession,
    student_id: int,
    *,
    category: str | None = None,
    difficulty: str | None = None,
    test_format: str | None = None,
) -> list[MockTestView]:
    statement = (
        select(MockTest, MockTestCategory)
        .join(MockTestCategory, MockTestCategory.id == MockTest.category_id)
        .join(
            InterviewStudioDifficulty,
            InterviewStudioDifficulty.code == MockTest.difficulty,
        )
        .where(
            MockTest.active.is_(True),
            MockTestCategory.active.is_(True),
            InterviewStudioDifficulty.active.is_(True),
        )
        .order_by(MockTestCategory.title, MockTest.difficulty, MockTest.title)
    )
    if category:
        statement = statement.where(MockTestCategory.slug == category)
    if difficulty:
        statement = statement.where(MockTest.difficulty == difficulty)
    if test_format:
        statement = statement.where(MockTest.format == test_format)
    tests = list((await db.execute(statement)).all())
    result = []
    for test, test_category in tests:
        attempts = await _attempt_rows(db, student_id, test.id)
        result.append(_test_view(test, test_category, attempts))
    return result


async def get_mock_test_detail(
    db: AsyncSession,
    student_id: int,
    test_id: int,
) -> MockTestView:
    test, category = await _get_test(db, test_id)
    attempt_rows = await _attempt_rows(db, student_id, test.id, limit=30)
    rows = await db.execute(
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
    questions = [
        MockTestQuestionView(
            position=test_question.position,
            prompt=bank_question.prompt,
            skill_tags=test_question.skill_tags,
        )
        for test_question, bank_question in rows
    ]
    return _test_view(test, category, attempt_rows, questions)


async def list_mock_test_attempts(
    db: AsyncSession,
    student_id: int,
    test_id: int,
) -> list[MockTestAttemptSummary]:
    await _get_test(db, test_id)
    return [
        _attempt_summary(*row)
        for row in await _attempt_rows(db, student_id, test_id, limit=100)
    ]


async def compare_mock_test_attempts(
    db: AsyncSession,
    student_id: int,
    test_id: int,
    attempt_ids: list[int],
) -> MockTestComparisonView:
    await _get_test(db, test_id)
    rows = list(
        (
            await db.execute(
                select(InterviewSession, InterviewReport)
                .outerjoin(
                    InterviewReport,
                    InterviewReport.session_id == InterviewSession.id,
                )
                .where(
                    InterviewSession.id.in_(attempt_ids),
                    InterviewSession.student_id == student_id,
                    InterviewSession.mock_test_id == test_id,
                )
            )
        ).all()
    )
    if len(rows) != len(attempt_ids):
        raise InterviewStudioError(404, "mock_test_attempt_not_found")
    versions = {session.mock_test_version for session, _report in rows}
    if len(versions) != 1:
        raise InterviewStudioError(422, "attempt_versions_must_match")
    if any(
        session.status != "COMPLETED"
        or report is None
        or report.status != "COMPLETED"
        for session, report in rows
    ):
        raise InterviewStudioError(409, "attempt_evaluation_not_completed")
    rows.sort(key=lambda row: (row[0].created_at, row[0].id))
    version = next(iter(versions))
    if version is None:
        raise InterviewStudioError(409, "attempt_version_missing")
    return MockTestComparisonView(
        mock_test_id=test_id,
        test_version=version,
        attempts=[_attempt_summary(*row) for row in rows],
    )


async def recommend_mock_test(
    db: AsyncSession,
    student_id: int,
) -> MockTestRecommendationView:
    latest = await db.execute(
        select(InterviewReport, InterviewSession)
        .join(InterviewSession, InterviewSession.id == InterviewReport.session_id)
        .where(
            InterviewSession.student_id == student_id,
            InterviewSession.mock_test_id.is_not(None),
            InterviewSession.status == "COMPLETED",
            InterviewReport.status == "COMPLETED",
            InterviewReport.skill_breakdown.is_not(None),
        )
        .order_by(InterviewSession.completed_at.desc(), InterviewSession.id.desc())
        .limit(1)
    )
    report_session = latest.first()
    if report_session is None or not report_session[0].skill_breakdown:
        return MockTestRecommendationView(weakest_skill=None, recommended_test=None)
    report, _session = report_session
    weakest_skill = min(report.skill_breakdown, key=report.skill_breakdown.get)
    candidates = list(
        (
            await db.scalars(
                select(MockTest)
                .join(MockTestCategory, MockTestCategory.id == MockTest.category_id)
                .where(
                    MockTest.active.is_(True),
                    MockTestCategory.active.is_(True),
                )
                .order_by(MockTest.question_count, MockTest.title)
            )
        ).all()
    )
    test_id = next(
        (test.id for test in candidates if weakest_skill in (test.skill_tags or [])),
        None,
    )
    recommended = (
        await get_mock_test_detail(db, student_id, test_id)
        if test_id is not None
        else None
    )
    return MockTestRecommendationView(
        weakest_skill=weakest_skill,
        recommended_test=recommended,
    )
