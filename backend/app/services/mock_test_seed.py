"""Idempotently seed the draft reusable mock test catalog."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    InterviewQuestionBank,
    InterviewStudioDifficulty,
    MockTest,
    MockTestCategory,
    MockTestQuestion,
)


_CATEGORIES = {
    "HR": "HR and General",
    "TECHNICAL": "Technical",
}

# Each item is (bank category, bank question number, skill tags).
_TESTS = (
    {
        "slug": "hr-foundations-quick",
        "title": "HR Foundations: Quick Practice",
        "category": "HR",
        "difficulty": "BEGINNER",
        "format": "QUICK_PRACTICE",
        "description": "A short introduction to common internship interview topics.",
        "questions": [("HR", i, ["self-introduction", "motivation"]) for i in range(1, 6)],
    },
    {
        "slug": "hr-communication-standard",
        "title": "HR Communication",
        "category": "HR",
        "difficulty": "INTERMEDIATE",
        "format": "STANDARD",
        "description": "Practice clear communication, feedback, and workplace judgment.",
        "questions": [("HR", i, ["workplace-communication"]) for i in range(1, 11)],
    },
    {
        "slug": "hr-prioritization-topic",
        "title": "HR: Prioritization and Judgment",
        "category": "HR",
        "difficulty": "ADVANCED",
        "format": "TOPIC_WISE",
        "description": "Focus on explaining decisions, priorities, and trade-offs.",
        "questions": [("HR", i, ["prioritization"]) for i in range(1, 6)],
    },
    {
        "slug": "technical-fundamentals-quick",
        "title": "Technical Fundamentals: Quick Practice",
        "category": "TECHNICAL",
        "difficulty": "BEGINNER",
        "format": "QUICK_PRACTICE",
        "description": "A short check of programming and web-development fundamentals.",
        "questions": [("TECHNICAL", i, ["programming-fundamentals"]) for i in range(1, 6)],
    },
    {
        "slug": "technical-engineering-standard",
        "title": "Software Engineering Practice",
        "category": "TECHNICAL",
        "difficulty": "INTERMEDIATE",
        "format": "STANDARD",
        "description": "Practice debugging, API design, reliability, and engineering trade-offs.",
        "questions": [("TECHNICAL", i, ["software-engineering"]) for i in range(1, 11)],
    },
    {
        "slug": "technical-system-design-topic",
        "title": "Technical: System Design",
        "category": "TECHNICAL",
        "difficulty": "ADVANCED",
        "format": "TOPIC_WISE",
        "description": "Focus on architecture, reliability, and operational trade-offs.",
        "questions": [("TECHNICAL", i, ["system-design"]) for i in range(1, 6)],
    },
    {
        "slug": "data-science-foundations-standard",
        "title": "Data Science Foundations",
        "category": "DATA_SCIENCE",
        "difficulty": "BEGINNER",
        "format": "STANDARD",
        "description": "Practice data inspection, statistics, and model-evaluation basics.",
        "questions": [("DATA_SCIENCE", i, ["data-literacy"]) for i in range(1, 11)],
    },
    {
        "slug": "data-science-full-practice",
        "title": "Data Science: Full Practice",
        "category": "DATA_SCIENCE",
        "difficulty": "INTERMEDIATE",
        "format": "FULL",
        "description": "A longer practice set across analytics, technical reasoning, and workplace communication.",
        "questions": (
            [("DATA_SCIENCE", i, ["statistics-and-modeling"]) for i in range(1, 6)]
            + [("TECHNICAL", i, ["data-tooling"]) for i in range(1, 6)]
            + [("HR", i, ["communication"]) for i in range(1, 6)]
        ),
    },
    {
        "slug": "data-analyst-cleaning-topic",
        "title": "Data Analyst: Data Quality",
        "category": "DATA_ANALYST",
        "difficulty": "BEGINNER",
        "format": "TOPIC_WISE",
        "description": "Focus on inspecting data, validating inputs, and explaining data quality.",
        "questions": [("DATA_SCIENCE", i, ["data-quality"]) for i in range(1, 6)],
    },
    {
        "slug": "data-analyst-investigation-standard",
        "title": "Data Analyst: Investigation Practice",
        "category": "DATA_ANALYST",
        "difficulty": "ADVANCED",
        "format": "STANDARD",
        "description": "Practice analytical investigation, measurement, and communicating limitations.",
        "questions": (
            [("DATA_SCIENCE", i, ["analysis-and-measurement"]) for i in range(1, 6)]
            + [("TECHNICAL", i, ["data-tooling"]) for i in range(1, 6)]
        ),
    },
    {
        "slug": "behavioral-stories-quick",
        "title": "Behavioral Stories: Quick Practice",
        "category": "BEHAVIORAL",
        "difficulty": "BEGINNER",
        "format": "QUICK_PRACTICE",
        "description": "Practice giving concise examples and reflecting on outcomes.",
        "questions": [("BEHAVIORAL", i, ["behavioral-examples"]) for i in range(1, 6)],
    },
    {
        "slug": "behavioral-leadership-standard",
        "title": "Behavioral: Collaboration and Leadership",
        "category": "BEHAVIORAL",
        "difficulty": "ADVANCED",
        "format": "STANDARD",
        "description": "Practice collaboration, accountability, and learning from complex situations.",
        "questions": [("BEHAVIORAL", i, ["collaboration-and-leadership"]) for i in range(1, 11)],
    },
)


async def seed_mock_test_library(db: AsyncSession) -> int:
    difficulties = {
        row.code: row
        for row in (await db.scalars(select(InterviewStudioDifficulty))).all()
    }
    for code, label in (("INTERMEDIATE", "Intermediate"),):
        if code not in difficulties:
            db.add(
                InterviewStudioDifficulty(code=code, label=label, active=True)
            )
    categories = {
        category.slug: category
        for category in (await db.scalars(select(MockTestCategory))).all()
    }
    for slug, title in _CATEGORIES.items():
        category = categories.get(slug)
        if category is None:
            category = MockTestCategory(slug=slug, title=title, active=True)
            db.add(category)
            categories[slug] = category
    await db.flush()

    bank_questions = {
        question.seed_key: question
        for question in (await db.scalars(select(InterviewQuestionBank))).all()
    }
    tests = {
        test.slug: test for test in (await db.scalars(select(MockTest))).all()
    }
    inserted = 0
    for definition in _TESTS:
        slug = str(definition["slug"])
        if str(definition["category"]) not in {"HR", "TECHNICAL"}:
            continue
        if str(definition["difficulty"]) != "INTERMEDIATE":
            continue
        questions = list(definition["questions"])
        test = tests.get(slug)
        if test is not None:
            continue
        test = MockTest(
            slug=slug,
            title=str(definition["title"]),
            description=str(definition["description"]),
            category_id=categories[str(definition["category"])].id,
            difficulty=str(definition["difficulty"]),
            format=str(definition["format"]),
            default_mode="PRACTICE",
            question_count=len(questions),
            time_limit_seconds=min(len(questions) * 120, 1200),
            question_filter={
                "difficulty": str(definition["difficulty"]),
                "source": "fixed_question_set",
            },
            skill_tags=sorted(
                {
                    tag
                    for _bank_category, _number, tags in questions
                    for tag in tags
                }
            ),
            company_style=slug in {
                "technical-engineering-standard",
                "data-science-full-practice",
            },
            active=False,
            version=1,
            source_metadata={
                "status": "DRAFT-for-review",
                "source": "InternSphere curated practice patterns",
                "seed_version": 1,
                "company_style_disclaimer": (
                    "Practice based on public or admin-curated patterns; not an official assessment."
                ),
            },
        )
        db.add(test)
        await db.flush()
        tests[slug] = test
        inserted += 1
        for position, (bank_category, number, skill_tags) in enumerate(questions, start=1):
            seed_key = (
                f"{bank_category.lower()}-{str(definition['difficulty']).lower()}-{number:02d}-v1"
            )
            bank_question = bank_questions.get(seed_key)
            if bank_question is None:
                raise RuntimeError(f"Question bank seed is missing required row: {seed_key}")
            db.add(
                MockTestQuestion(
                    mock_test_id=test.id,
                    version=test.version,
                    question_bank_id=bank_question.id,
                    position=position,
                    skill_tags=skill_tags,
                )
            )
    await db.commit()
    return inserted
