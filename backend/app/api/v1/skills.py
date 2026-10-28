"""Verified skill assessments, student credentials, and admin question management."""

import csv
import io
import json
import math
import random
import re
import textwrap
from calendar import monthrange
from datetime import date, datetime, timedelta, timezone
from typing import Annotated, Any
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select
from starlette.responses import StreamingResponse

from app.api.v1.dependencies import DbSession, require_roles
from app.models import Internship, Notification, SkillAttempt, SkillBadge, SkillLearningResource, SkillQuestion, User, UserRole
from app.services.audit import write_audit
from app.services.skill_badges import badge_matches_skill


router = APIRouter(prefix="/skills", tags=["skills"])
student_only = Annotated[User, Depends(require_roles(UserRole.STUDENT))]
admin_only = Annotated[User, Depends(require_roles(UserRole.ADMIN))]

ASSESSMENT_QUESTION_COUNT = 10
ASSESSMENT_MIX = {"EASY": 4, "MEDIUM": 4, "HARD": 2}
DIFFICULTY_WEIGHTS = {"EASY": 1, "MEDIUM": 2, "HARD": 3}
ASSESSMENT_DURATION = timedelta(minutes=15)
RETENTION_WINDOW = timedelta(days=7)
PASS_PERCENTAGE = 80
TOPIC_INFO: dict[str, dict[str, str]] = {
    "python": {"name": "Python & Backend Architecture", "icon": "🐍", "badge_title": "Verified Python Specialist"},
    "react": {"name": "React & Modern Frontend", "icon": "⚛️", "badge_title": "Verified React Pro"},
    "sql": {"name": "SQL & Database Design", "icon": "🗄️", "badge_title": "Verified SQL Specialist"},
    "dsa": {"name": "Data Structures & Algorithms", "icon": "🧮", "badge_title": "Verified DSA Problem Solver"},
    "ai": {"name": "Machine Learning & AI Engineering", "icon": "🤖", "badge_title": "Verified AI/ML Engineer"},
    "devops": {"name": "Cloud, Docker & DevOps", "icon": "☁️", "badge_title": "Verified Cloud & DevOps Specialist"},
    "security": {"name": "Web Security & System Design", "icon": "🛡️", "badge_title": "Verified Security & Systems Pro"},
    "typescript": {"name": "JavaScript & TypeScript Mastery", "icon": "🔷", "badge_title": "Verified TypeScript Specialist"},
}
DIFFICULTIES = set(DIFFICULTY_WEIGHTS)
QUESTION_TYPES = {"SINGLE", "MULTI", "TRUE_FALSE"}


class AssessmentStart(BaseModel):
    topic: str = Field(min_length=1, max_length=100)

    @field_validator("topic")
    @classmethod
    def trim_topic(cls, value: str) -> str:
        return value.strip().lower()


class AssessmentSubmit(BaseModel):
    answers: list[int | list[int]] = Field(min_length=ASSESSMENT_QUESTION_COUNT, max_length=ASSESSMENT_QUESTION_COUNT)
    question_time_seconds: list[int] = Field(default_factory=list, max_length=ASSESSMENT_QUESTION_COUNT)

    @field_validator("question_time_seconds")
    @classmethod
    def validate_question_times(cls, values: list[int]) -> list[int]:
        if any(value < 0 or value > int(ASSESSMENT_DURATION.total_seconds()) for value in values):
            raise ValueError("Question times must be between 0 and 900 seconds")
        return values


class SkillQuestionCreate(BaseModel):
    topic: str = Field(min_length=1, max_length=100)
    subtopic: str = Field(default="fundamentals", min_length=1, max_length=100)
    prompt: str = Field(min_length=1, max_length=4000)
    options: list[str] = Field(min_length=2, max_length=8)
    correct_index: int | None = Field(default=None, ge=0)
    correct_answers: list[int] | None = None
    explanation: str = Field(min_length=1, max_length=4000)
    difficulty: str = "MEDIUM"
    question_type: str = "SINGLE"
    source: str = Field(default="InternSphere curated assessment bank", max_length=500)
    active: bool = True

    @field_validator("topic", "prompt", "explanation")
    @classmethod
    def trim_required_text(cls, value: str) -> str:
        result = value.strip()
        if not result:
            raise ValueError("This value cannot be blank")
        return result

    @field_validator("subtopic")
    @classmethod
    def validate_subtopic(cls, value: str) -> str:
        result = value.strip().lower()
        if not re.fullmatch(r"[a-z0-9][a-z0-9_-]*", result):
            raise ValueError("Subtopic must use lowercase letters, numbers, '-' or '_'")
        return result

    @field_validator("topic")
    @classmethod
    def validate_topic(cls, value: str) -> str:
        if not re.fullmatch(r"[a-z0-9][a-z0-9_-]*", value.lower()):
            raise ValueError("Topic must be a lowercase id using letters, numbers, '-' or '_'")
        return value.lower()

    @field_validator("options")
    @classmethod
    def validate_options(cls, values: list[str]) -> list[str]:
        normalized = [value.strip() for value in values]
        if any(not value for value in normalized):
            raise ValueError("Answer options cannot be blank")
        if len({value.casefold() for value in normalized}) != len(normalized):
            raise ValueError("Answer options must not contain duplicates")
        return normalized

    @field_validator("difficulty")
    @classmethod
    def validate_difficulty(cls, value: str) -> str:
        difficulty = value.strip().upper()
        difficulty = {
            "BEGINNER": "EASY",
            "INTERMEDIATE": "MEDIUM",
            "ADVANCED": "HARD",
        }.get(difficulty, difficulty)
        if difficulty not in DIFFICULTIES:
            raise ValueError("Difficulty must be EASY, MEDIUM, or HARD")
        return difficulty

    @field_validator("question_type")
    @classmethod
    def validate_question_type(cls, value: str) -> str:
        question_type = value.strip().upper()
        if question_type not in QUESTION_TYPES:
            raise ValueError("Question type must be SINGLE, MULTI, or TRUE_FALSE")
        return question_type

    @field_validator("source")
    @classmethod
    def validate_source(cls, value: str) -> str:
        result = value.strip()
        if not result:
            raise ValueError("Source cannot be blank")
        return result


class SkillQuestionUpdate(BaseModel):
    topic: str | None = Field(default=None, min_length=1, max_length=100)
    subtopic: str | None = Field(default=None, min_length=1, max_length=100)
    prompt: str | None = Field(default=None, min_length=1, max_length=4000)
    options: list[str] | None = Field(default=None, min_length=2, max_length=8)
    correct_index: int | None = Field(default=None, ge=0)
    correct_answers: list[int] | None = None
    explanation: str | None = Field(default=None, min_length=1, max_length=4000)
    difficulty: str | None = None
    question_type: str | None = None
    source: str | None = Field(default=None, min_length=1, max_length=500)
    active: bool | None = None


class SkillLearningResourceCreate(BaseModel):
    topic: str = Field(min_length=1, max_length=100)
    subtopic: str = Field(min_length=1, max_length=100)
    title: str = Field(min_length=1, max_length=255)
    url: str = Field(min_length=1, max_length=1000)


class SkillLearningResourceUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    url: str | None = Field(default=None, min_length=1, max_length=1000)
    active: bool | None = None


def _utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def _add_months(value: datetime, months: int) -> datetime:
    month_index = value.month - 1 + months
    year = value.year + month_index // 12
    month = month_index % 12 + 1
    day = min(value.day, monthrange(year, month)[1])
    return value.replace(year=year, month=month, day=day)


def _retry_after(until: datetime, now: datetime) -> int:
    return max(1, math.ceil((until - now).total_seconds()))


def _question_response(question: SkillQuestion, options: list[str]) -> dict[str, Any]:
    return {
        "id": question.id,
        "prompt": question.prompt,
        "options": options,
        "difficulty": question.difficulty,
        "subtopic": question.subtopic,
        "question_type": question.question_type,
    }


def _badge_level(score: float) -> str:
    if score >= 80:
        return "Advanced"
    if score >= 60:
        return "Intermediate"
    return "Beginner"


def _question_dict(question: SkillQuestion) -> dict[str, Any]:
    return {
        "id": question.id,
        "topic": question.topic,
        "prompt": question.prompt,
        "options": question.options,
        "correct_index": question.correct_index,
        "correct_answers": question.correct_answers,
        "explanation": question.explanation,
        "difficulty": question.difficulty,
        "subtopic": question.subtopic,
        "question_type": question.question_type,
        "source": question.source,
        "active": question.active,
        "created_at": question.created_at,
    }


def _correct_indices(snapshot: dict[str, Any]) -> list[int]:
    answers = snapshot.get("correct_answers")
    if isinstance(answers, list) and answers:
        return [int(answer) for answer in answers]
    return [int(snapshot["correct_index"])]


def _answer_credit(
    answer: int | list[int],
    snapshot: dict[str, Any],
    option_order: list[int],
) -> tuple[float, str | list[str], str | list[str]]:
    question_type = str(snapshot.get("question_type", "SINGLE"))
    selected_positions = answer if isinstance(answer, list) else [answer]
    if question_type != "MULTI" and len(selected_positions) != 1:
        raise HTTPException(422, "Single-answer questions require exactly one selected option")
    if any(position < 0 or position >= len(option_order) for position in selected_positions):
        raise HTTPException(422, "An answer does not match an available option")
    selected_indices = {option_order[position] for position in selected_positions}
    correct_indices = set(_correct_indices(snapshot))
    if question_type == "MULTI":
        credit = max(0.0, (len(selected_indices & correct_indices) - len(selected_indices - correct_indices)) / len(correct_indices))
    else:
        credit = float(selected_indices == correct_indices)
    options = list(snapshot["options"])
    selected_text = [options[index] for index in sorted(selected_indices)]
    correct_text = [options[index] for index in sorted(correct_indices)]
    if question_type == "MULTI":
        return credit, selected_text, correct_text
    return credit, (selected_text[0] if selected_text else ""), correct_text[0]


def _validate_question(
    options: list[str],
    correct_index: int | None,
    correct_answers: list[int] | None,
    question_type: str,
) -> None:
    if question_type == "TRUE_FALSE" and len(options) != 2:
        raise HTTPException(422, "TRUE_FALSE questions must have exactly two options")
    if question_type == "MULTI":
        if not correct_answers or len(correct_answers) < 2:
            raise HTTPException(422, "MULTI questions require at least two correct_answers indices")
        if len(set(correct_answers)) != len(correct_answers):
            raise HTTPException(422, "correct_answers indices must be unique")
        if any(index < 0 or index >= len(options) for index in correct_answers):
            raise HTTPException(422, "Every correct_answers index must identify an option")
        return
    if correct_index is None or correct_index >= len(options):
        raise HTTPException(422, "correct_index must identify exactly one answer option")
    if correct_answers not in (None, [], [correct_index]):
        raise HTTPException(422, "SINGLE and TRUE_FALSE questions use correct_index")


def _difficulty_weight(difficulty: str) -> int:
    return DIFFICULTY_WEIGHTS.get(difficulty.upper(), 2)


def _question_results(attempt: SkillAttempt) -> list[dict[str, Any]]:
    results = []
    question_times = attempt.question_time_seconds or []
    for index, (answer, snapshot, order) in enumerate(zip(
        attempt.answers or [],
        attempt.question_snapshots,
        attempt.option_orders,
    )):
        credit, selected_answer, correct_answer = _answer_credit(answer, snapshot, order)
        results.append({
            "question_id": attempt.question_ids[index],
            "prompt": snapshot["prompt"],
            "subtopic": snapshot.get("subtopic", "fundamentals"),
            "difficulty": snapshot.get("difficulty", "MEDIUM"),
            "question_type": snapshot.get("question_type", "SINGLE"),
            "selected_answer": selected_answer,
            "correct_answer": correct_answer,
            "explanation": snapshot["explanation"],
            "is_correct": credit >= 1.0,
            "earned_credit": round(credit, 3),
            "time_seconds": question_times[index] if index < len(question_times) else 0,
        })
    return results


async def _attempt_result(db: DbSession, attempt: SkillAttempt) -> dict[str, Any]:
    if attempt.submitted_at is None or attempt.answers is None:
        raise HTTPException(409, "Submit this assessment before viewing its result")
    questions = _question_results(attempt)
    scores = attempt.subtopic_scores or {}
    weak_subtopics = [
        subtopic for subtopic, result in scores.items()
        if float(result.get("percentage", 0)) < 60
    ]
    strengths = [
        subtopic for subtopic, result in scores.items()
        if float(result.get("percentage", 0)) >= 80
    ]
    resources = list(await db.scalars(
        select(SkillLearningResource)
        .where(
            SkillLearningResource.topic == attempt.topic,
            SkillLearningResource.subtopic.in_([*weak_subtopics, "general"]),
            SkillLearningResource.active.is_(True),
        )
        .order_by(SkillLearningResource.subtopic, SkillLearningResource.id)
    )) if weak_subtopics else []
    learning_by_subtopic: dict[str, list[dict[str, str]]] = {}
    for subtopic in weak_subtopics:
        matching = [
            resource for resource in resources
            if resource.subtopic in {subtopic, "general"}
        ][:3]
        learning_by_subtopic[subtopic] = [
            {"title": resource.title, "url": resource.url}
            for resource in matching
        ]

    matching_internships: list[dict[str, Any]] = []
    if attempt.passed:
        candidates = list(await db.scalars(
            select(Internship)
            .where(Internship.status == "PUBLISHED", Internship.deadline >= date.today())
            .order_by(Internship.created_at.desc())
            .limit(100)
        ))
        for internship in candidates:
            skills = [skill.strip() for skill in (internship.skills or "").split(",") if skill.strip()]
            matching_skills = [
                skill for skill in skills if badge_matches_skill(attempt.topic, skill)
            ]
            if matching_skills:
                matching_internships.append({
                    "id": internship.id,
                    "title": internship.title,
                    "matched_skills": matching_skills,
                })
            if len(matching_internships) == 3:
                break

    badge = await db.scalar(select(SkillBadge).where(SkillBadge.attempt_id == attempt.id))
    return {
        "attempt_id": attempt.id,
        "topic": attempt.topic,
        "attempt_number": attempt.attempt_number,
        "score": attempt.score,
        "raw_score": attempt.raw_score,
        "weighted_percentage": attempt.weighted_percentage,
        "level": attempt.level or _badge_level(float(attempt.weighted_percentage or 0)),
        "passed": bool(attempt.passed),
        "percentile": attempt.percentile if attempt.percentile is not None else "Not enough data yet",
        "time_taken_seconds": attempt.time_taken_seconds or 0,
        "started_at": attempt.started_at,
        "submitted_at": attempt.submitted_at,
        "retake_at": _utc(attempt.started_at) + timedelta(hours=24),
        "badge": ({
            "topic": badge.topic,
            "title": badge.title,
            "level": badge.level,
            "score": badge.score,
            "earned_at": badge.earned_at,
            "expires_at": badge.expires_at,
        } if badge else None),
        "questions": questions,
        "subtopic_scores": scores,
        "difficulty_scores": attempt.difficulty_scores or {},
        "strengths": strengths,
        "weak_subtopics": [
            {
                "subtopic": subtopic,
                "tip": f"Review the core concepts and work through practical examples for {subtopic.replace('-', ' ')} before retaking this topic.",
                "learning_links": learning_by_subtopic.get(subtopic, []),
            }
            for subtopic in weak_subtopics
        ],
        "matching_internships": matching_internships,
    }


def _report_pdf(result: dict[str, Any]) -> bytes:
    report_lines = [
        "InternSphere Skill Assessment Performance Report",
        f"Topic: {result['topic']}",
        f"Attempt: {result['attempt_number']}",
        f"Raw score: {result['raw_score']} / 10",
        f"Weighted score: {result['weighted_percentage']}%",
        f"Level: {result['level']}",
        f"Result: {'PASS' if result['passed'] else 'NOT PASSED'}",
        f"Time taken: {result['time_taken_seconds']} seconds",
        f"Percentile: {result['percentile']}",
        "",
        "Subtopic performance:",
    ]
    for subtopic, score in result["subtopic_scores"].items():
        report_lines.append(f"{subtopic}: {score['percentage']}%")
    report_lines.extend(["", "Question review:"])
    for question in result["questions"]:
        report_lines.extend([
            f"{question['subtopic']} ({question['difficulty']})",
            f"Question: {question['prompt']}",
            f"Your answer: {question['selected_answer']}",
            f"Correct answer: {question['correct_answer']}",
            f"Explanation: {question['explanation']}",
            f"Credit: {question['earned_credit']} · Time: {question['time_seconds']} seconds",
            "",
        ])
    for weak in result["weak_subtopics"]:
        report_lines.append(f"Study tip for {weak['subtopic']}: {weak['tip']}")
        report_lines.extend(
            f"Learning link: {resource['title']} ({resource['url']})"
            for resource in weak["learning_links"]
        )
    if result["matching_internships"]:
        report_lines.extend(["", "Matching open internships:"])
        report_lines.extend(
            f"{item['title']} (skills: {', '.join(item['matched_skills'])})"
            for item in result["matching_internships"]
        )
    wrapped_lines = [
        segment
        for line in report_lines
        for segment in (textwrap.wrap(str(line), width=88) or [""])
    ]
    pages = [
        wrapped_lines[index:index + 48]
        for index in range(0, len(wrapped_lines), 48)
    ] or [[]]
    if result["badge"]:
        pages.append([
            "Verified Skill Badge Certificate",
            result["badge"]["title"],
            f"Level: {result['badge']['level']}",
            f"Score: {result['badge']['score']}%",
            f"Earned: {str(result['badge']['earned_at'])}",
            f"Expires: {str(result['badge']['expires_at'])}",
            "This certificate confirms a server-graded InternSphere assessment result.",
        ])

    def pdf_text(value: str) -> str:
        safe = value.encode("latin-1", "replace").decode("latin-1")
        return safe.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")

    objects: list[bytes] = []
    page_ids = [4 + 2 * index for index in range(len(pages))]
    objects.append(b"<< /Type /Catalog /Pages 2 0 R >>")
    objects.append(
        f"<< /Type /Pages /Kids [{' '.join(f'{item} 0 R' for item in page_ids)}] /Count {len(page_ids)} >>".encode()
    )
    objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    for index, lines in enumerate(pages):
        page_id = page_ids[index]
        content_id = page_id + 1
        commands = ["BT", "/F1 10 Tf", "50 760 Td", "14 TL"]
        for line in lines:
            commands.extend([f"({pdf_text(line)}) Tj", "T*"])
        commands.append("ET")
        content = "\n".join(commands).encode("latin-1", "replace")
        objects.append(
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents {content_id} 0 R >>".encode()
        )
        objects.append(
            f"<< /Length {len(content)} >>\nstream\n".encode() + content + b"\nendstream"
        )

    output = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for index, body in enumerate(objects, start=1):
        offsets.append(len(output))
        output.extend(f"{index} 0 obj\n".encode() + body + b"\nendobj\n")
    xref_position = len(output)
    output.extend(f"xref\n0 {len(offsets)}\n".encode())
    output.extend(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        output.extend(f"{offset:010d} 00000 n \n".encode())
    output.extend(
        f"trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{xref_position}\n%%EOF".encode()
    )
    return bytes(output)


async def _assert_unique_prompt(
    db: DbSession,
    topic: str,
    prompt: str,
    *,
    exclude_id: int | None = None,
) -> None:
    query = select(SkillQuestion.id).where(
        SkillQuestion.topic == topic,
        func.lower(SkillQuestion.prompt) == prompt.casefold(),
    )
    if exclude_id is not None:
        query = query.where(SkillQuestion.id != exclude_id)
    if await db.scalar(query) is not None:
        raise HTTPException(409, "A question with this topic and prompt already exists")


@router.get("/topics")
async def list_assessment_topics(user: student_only, db: DbSession) -> list[dict[str, str]]:
    topics = list(await db.scalars(
        select(SkillQuestion.topic)
        .where(SkillQuestion.active.is_(True))
        .distinct()
        .order_by(SkillQuestion.topic)
    ))
    return [
        {
            "id": topic,
            "name": TOPIC_INFO.get(topic, {}).get("name", topic.replace("-", " ").replace("_", " ").title()),
            "icon": TOPIC_INFO.get(topic, {}).get("icon", "✦"),
        }
        for topic in topics
    ]


@router.post("/assessments/start")
async def start_assessment(
    data: AssessmentStart,
    user: student_only,
    db: DbSession,
) -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    weekly_attempts = list(await db.scalars(
        select(SkillAttempt)
        .where(SkillAttempt.student_id == user.id, SkillAttempt.started_at >= now - RETENTION_WINDOW)
        .order_by(SkillAttempt.started_at)
    ))
    if len(weekly_attempts) >= 3:
        oldest_expiry = _utc(weekly_attempts[0].started_at) + RETENTION_WINDOW
        raise HTTPException(
            429,
            "You have reached the limit of 3 assessment attempts in 7 days. Try again after the oldest attempt leaves the weekly window.",
            headers={"Retry-After": str(_retry_after(oldest_expiry, now))},
        )

    latest_for_topic = await db.scalar(
        select(SkillAttempt)
        .where(SkillAttempt.student_id == user.id, SkillAttempt.topic == data.topic)
        .order_by(SkillAttempt.started_at.desc())
        .limit(1)
    )
    if latest_for_topic is not None:
        retry_at = _utc(latest_for_topic.started_at) + timedelta(hours=24)
        if now < retry_at:
            raise HTTPException(
                429,
                "You can retake this topic 24 hours after your previous attempt.",
                headers={"Retry-After": str(_retry_after(retry_at, now))},
            )

    available = list(await db.scalars(
        select(SkillQuestion).where(
            SkillQuestion.topic == data.topic,
            SkillQuestion.active.is_(True),
        )
    ))
    if not available:
        raise HTTPException(404, "This assessment topic is not available")
    pools = {
        difficulty: [question for question in available if question.difficulty.upper() == difficulty]
        for difficulty in ASSESSMENT_MIX
    }
    insufficient = {
        difficulty: count - len(pools[difficulty])
        for difficulty, count in ASSESSMENT_MIX.items()
        if len(pools[difficulty]) < count
    }
    if insufficient:
        missing = ", ".join(
            f"{count} {difficulty.lower()}" for difficulty, count in insufficient.items()
        )
        raise HTTPException(
            409,
            f"This question bank cannot fill the fixed 4 easy, 4 medium, 2 hard mix without repeats. Add at least {missing} questions.",
        )

    picker = random.SystemRandom()
    chosen_questions = [
        question
        for difficulty, count in ASSESSMENT_MIX.items()
        for question in picker.sample(pools[difficulty], count)
    ]
    picker.shuffle(chosen_questions)
    topic_attempt_count = int(await db.scalar(
        select(func.count(SkillAttempt.id)).where(
            SkillAttempt.student_id == user.id,
            SkillAttempt.topic == data.topic,
        )
    ) or 0)
    option_orders: list[list[int]] = []
    snapshots: list[dict[str, Any]] = []
    presented_questions: list[dict[str, Any]] = []
    for question in chosen_questions:
        order = list(range(len(question.options)))
        picker.shuffle(order)
        option_orders.append(order)
        snapshots.append({
            "prompt": question.prompt,
            "options": list(question.options),
            "correct_index": question.correct_index,
            "correct_answers": question.correct_answers or [question.correct_index],
            "explanation": question.explanation,
            "difficulty": question.difficulty,
            "subtopic": question.subtopic,
            "question_type": question.question_type,
        })
        presented_questions.append(_question_response(
            question,
            [question.options[index] for index in order],
        ))

    attempt = SkillAttempt(
        student_id=user.id,
        topic=data.topic,
        question_ids=[question.id for question in chosen_questions],
        question_snapshots=snapshots,
        option_orders=option_orders,
        started_at=now,
        expires_at=now + ASSESSMENT_DURATION,
        attempt_number=topic_attempt_count + 1,
    )
    db.add(attempt)
    await db.commit()
    await db.refresh(attempt)
    return {
        "attempt_id": attempt.id,
        "topic": attempt.topic,
        "started_at": attempt.started_at,
        "expires_at": attempt.expires_at,
        "attempt_number": attempt.attempt_number,
        "duration_seconds": int(ASSESSMENT_DURATION.total_seconds()),
        "questions": presented_questions,
    }


@router.post("/assessments/{attempt_id}/submit")
async def submit_assessment(
    attempt_id: int,
    data: AssessmentSubmit,
    user: student_only,
    db: DbSession,
) -> dict[str, Any]:
    attempt = await db.scalar(select(SkillAttempt).where(
        SkillAttempt.id == attempt_id,
        SkillAttempt.student_id == user.id,
    ).with_for_update())
    if attempt is None:
        raise HTTPException(404, "Assessment attempt not found")
    if attempt.submitted_at is not None:
        raise HTTPException(409, "This assessment attempt has already been submitted")
    now = datetime.now(timezone.utc)
    if now > _utc(attempt.expires_at):
        raise HTTPException(410, "The assessment time limit expired. Late submissions are not accepted.")
    if data.question_time_seconds and len(data.question_time_seconds) != len(attempt.question_ids):
        raise HTTPException(422, "Provide time spent for each question")

    weighted_earned = 0.0
    weighted_possible = 0
    raw_score = 0.0
    topic_subtopics: dict[str, dict[str, float]] = {}
    difficulty_scores: dict[str, dict[str, float]] = {}
    for answer, snapshot, order in zip(data.answers, attempt.question_snapshots, attempt.option_orders):
        credit, _, _ = _answer_credit(answer, snapshot, order)
        difficulty = str(snapshot.get("difficulty", "MEDIUM")).upper()
        subtopic = str(snapshot.get("subtopic", "fundamentals"))
        weight = _difficulty_weight(difficulty)
        weighted_earned += credit * weight
        weighted_possible += weight
        raw_score += credit
        topic_result = topic_subtopics.setdefault(subtopic, {"earned": 0.0, "possible": 0.0})
        topic_result["earned"] += credit * weight
        topic_result["possible"] += weight
        difficulty_result = difficulty_scores.setdefault(difficulty, {"earned": 0.0, "possible": 0.0})
        difficulty_result["earned"] += credit
        difficulty_result["possible"] += 1

    weighted_percentage = round(weighted_earned * 100 / weighted_possible, 2)
    score = round(weighted_percentage)
    passed = weighted_percentage >= PASS_PERCENTAGE
    subtopic_scores = {
        subtopic: {
            "earned": round(result["earned"], 2),
            "possible": round(result["possible"], 2),
            "percentage": round(result["earned"] * 100 / result["possible"], 2),
        }
        for subtopic, result in topic_subtopics.items()
    }
    normalized_difficulty_scores = {
        difficulty: {
            "correct": round(result["earned"], 2),
            "total": int(result["possible"]),
            "percentage": round(result["earned"] * 100 / result["possible"], 2),
        }
        for difficulty, result in difficulty_scores.items()
    }
    attempt.answers = data.answers
    attempt.question_time_seconds = data.question_time_seconds or [0] * len(data.answers)
    attempt.raw_score = round(raw_score, 2)
    attempt.weighted_percentage = weighted_percentage
    attempt.score = score
    attempt.level = _badge_level(weighted_percentage)
    attempt.time_taken_seconds = min(
        int(ASSESSMENT_DURATION.total_seconds()),
        max(0, int((now - _utc(attempt.started_at)).total_seconds())),
    )
    attempt.subtopic_scores = subtopic_scores
    attempt.difficulty_scores = normalized_difficulty_scores
    attempt.passed = passed
    attempt.submitted_at = now
    await db.flush()
    topic_scores = list(await db.scalars(
        select(SkillAttempt.weighted_percentage).where(
            SkillAttempt.topic == attempt.topic,
            SkillAttempt.submitted_at.is_not(None),
            SkillAttempt.weighted_percentage.is_not(None),
        )
    ))
    if len(topic_scores) >= 30:
        attempt.percentile = round(
            sum(float(value) <= weighted_percentage for value in topic_scores) * 100 / len(topic_scores),
            2,
        )

    if passed:
        topic_info = TOPIC_INFO.get(attempt.topic, {})
        badge = SkillBadge(
            student_id=user.id,
            topic=attempt.topic,
            title=topic_info.get("badge_title", f"Verified {attempt.topic.title()} Specialist"),
            level=_badge_level(weighted_percentage),
            score=score,
            attempt_id=attempt.id,
            earned_at=now,
            expires_at=_add_months(now, 12),
        )
        db.add(badge)
        db.add(Notification(
            user_id=user.id,
            notification_type="SKILL_BADGE_EARNED",
            title=f"Verified {attempt.topic} badge earned",
            body=f"You passed the {attempt.topic} assessment with a {weighted_percentage:g}% weighted score.",
        ))
    await db.commit()
    return await _attempt_result(db, attempt)


@router.get("/assessments/{attempt_id}/result")
async def get_assessment_result(
    attempt_id: int,
    user: student_only,
    db: DbSession,
) -> dict[str, Any]:
    attempt = await db.scalar(select(SkillAttempt).where(
        SkillAttempt.id == attempt_id,
        SkillAttempt.student_id == user.id,
    ))
    if attempt is None:
        raise HTTPException(404, "Assessment attempt not found")
    return await _attempt_result(db, attempt)


@router.get("/assessments/{attempt_id}/report.pdf")
async def download_assessment_report(
    attempt_id: int,
    user: student_only,
    db: DbSession,
) -> StreamingResponse:
    attempt = await db.scalar(select(SkillAttempt).where(
        SkillAttempt.id == attempt_id,
        SkillAttempt.student_id == user.id,
    ))
    if attempt is None:
        raise HTTPException(404, "Assessment attempt not found")
    result = await _attempt_result(db, attempt)
    return StreamingResponse(
        iter([_report_pdf(result)]),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="skill-assessment-{attempt.id}.pdf"'},
    )


@router.get("/history")
async def list_assessment_history(user: student_only, db: DbSession) -> dict[str, Any]:
    attempts = list(await db.scalars(
        select(SkillAttempt)
        .where(
            SkillAttempt.student_id == user.id,
            SkillAttempt.submitted_at.is_not(None),
        )
        .order_by(SkillAttempt.submitted_at)
    ))
    previous_scores: dict[str, float] = {}
    history = []
    for attempt in attempts:
        score = float(attempt.weighted_percentage or 0)
        previous = previous_scores.get(attempt.topic)
        history.append({
            "attempt_id": attempt.id,
            "topic": attempt.topic,
            "attempt_number": attempt.attempt_number,
            "score": attempt.score,
            "weighted_percentage": score,
            "passed": bool(attempt.passed),
            "submitted_at": attempt.submitted_at,
            "change_from_previous": round(score - previous, 2) if previous is not None else None,
        })
        previous_scores[attempt.topic] = score
    return {"attempts": history}


@router.get("/badges")
async def list_my_skill_badges(user: student_only, db: DbSession) -> list[dict[str, Any]]:
    now = datetime.now(timezone.utc)
    badges = list(await db.scalars(
        select(SkillBadge)
        .where(SkillBadge.student_id == user.id)
        .order_by(SkillBadge.earned_at.desc())
    ))
    expiring = [
        badge for badge in badges
        if now < _utc(badge.expires_at) <= now + timedelta(days=30)
    ]
    for badge in expiring:
        title = f"Verified {badge.topic} badge expires soon"
        body = f"Your {badge.topic} skill badge expires within 30 days. Retake the assessment to renew it."
        exists = await db.scalar(select(Notification.id).where(
            Notification.user_id == user.id,
            Notification.notification_type == "SKILL_BADGE_EXPIRING",
            Notification.title == title,
            Notification.body == body,
        ))
        if exists is None:
            db.add(Notification(
                user_id=user.id,
                notification_type="SKILL_BADGE_EXPIRING",
                title=title,
                body=body,
            ))
    if expiring:
        await db.commit()

    return [
        {
            "id": badge.id,
            "topic": badge.topic,
            "title": badge.title,
            "level": badge.level,
            "score": badge.score,
            "attempt_id": badge.attempt_id,
            "earned_at": badge.earned_at,
            "expires_at": badge.expires_at,
            "valid": _utc(badge.expires_at) > now,
            "expires_soon": now < _utc(badge.expires_at) <= now + timedelta(days=30),
        }
        for badge in badges
    ]


@router.get("/attempts")
async def list_my_skill_attempts(user: student_only, db: DbSession) -> list[dict[str, Any]]:
    attempts = list(await db.scalars(
        select(SkillAttempt)
        .where(SkillAttempt.student_id == user.id)
        .order_by(SkillAttempt.started_at.desc())
    ))
    return [
        {
            "id": attempt.id,
            "topic": attempt.topic,
            "question_count": len(attempt.question_ids),
            "score": attempt.score,
            "weighted_percentage": attempt.weighted_percentage,
            "level": attempt.level,
            "attempt_number": attempt.attempt_number,
            "passed": attempt.passed,
            "started_at": attempt.started_at,
            "expires_at": attempt.expires_at,
            "submitted_at": attempt.submitted_at,
        }
        for attempt in attempts
    ]


@router.get("/admin/questions")
async def list_skill_questions(
    user: admin_only,
    db: DbSession,
    topic: str | None = None,
    active: bool | None = None,
) -> list[dict[str, Any]]:
    query = select(SkillQuestion).order_by(SkillQuestion.topic, SkillQuestion.id)
    if topic:
        query = query.where(SkillQuestion.topic == topic.strip().lower())
    if active is not None:
        query = query.where(SkillQuestion.active.is_(active))
    questions = list(await db.scalars(query))
    return [_question_dict(question) for question in questions]


@router.post("/admin/questions", status_code=201)
async def create_skill_question(
    data: SkillQuestionCreate,
    user: admin_only,
    db: DbSession,
) -> dict[str, Any]:
    _validate_question(data.options, data.correct_index, data.correct_answers, data.question_type)
    await _assert_unique_prompt(db, data.topic, data.prompt)
    values = data.model_dump()
    if values["correct_index"] is None:
        values["correct_index"] = values["correct_answers"][0]
    question = SkillQuestion(**values)
    db.add(question)
    await db.flush()
    await write_audit(
        db,
        user,
        "skill_question_created",
        "skill_question",
        question.id,
        metadata={"topic": question.topic, "prompt": question.prompt},
    )
    await db.commit()
    await db.refresh(question)
    return _question_dict(question)


@router.patch("/admin/questions/{question_id}")
async def update_skill_question(
    question_id: int,
    data: SkillQuestionUpdate,
    user: admin_only,
    db: DbSession,
) -> dict[str, Any]:
    question = await db.get(SkillQuestion, question_id)
    if question is None:
        raise HTTPException(404, "Skill question not found")
    values = data.model_dump(exclude_unset=True)
    if any(value is None for value in values.values()):
        raise HTTPException(422, "Question updates cannot contain null values")
    merged = {
        "topic": values.get("topic", question.topic),
        "subtopic": values.get("subtopic", question.subtopic),
        "prompt": values.get("prompt", question.prompt),
        "options": values.get("options", question.options),
        "correct_index": values.get("correct_index", question.correct_index),
        "correct_answers": values.get("correct_answers", question.correct_answers),
        "explanation": values.get("explanation", question.explanation),
        "difficulty": values.get("difficulty", question.difficulty),
        "question_type": values.get("question_type", question.question_type),
        "source": values.get("source", question.source),
    }
    merged["topic"] = str(merged["topic"]).strip().lower()
    merged["subtopic"] = str(merged["subtopic"]).strip().lower()
    merged["prompt"] = str(merged["prompt"]).strip()
    merged["explanation"] = str(merged["explanation"]).strip()
    if not merged["prompt"] or not merged["explanation"]:
        raise HTTPException(422, "Prompt and explanation cannot be blank")
    if not re.fullmatch(r"[a-z0-9][a-z0-9_-]*", merged["topic"]):
        raise HTTPException(422, "Topic must be a lowercase id using letters, numbers, '-' or '_'")
    if not re.fullmatch(r"[a-z0-9][a-z0-9_-]*", merged["subtopic"]):
        raise HTTPException(422, "Subtopic must use lowercase letters, numbers, '-' or '_'")
    merged["difficulty"] = {
        "BEGINNER": "EASY",
        "INTERMEDIATE": "MEDIUM",
        "ADVANCED": "HARD",
    }.get(str(merged["difficulty"]).strip().upper(), str(merged["difficulty"]).strip().upper())
    merged["question_type"] = str(merged["question_type"]).strip().upper()
    if merged["difficulty"] not in DIFFICULTIES:
        raise HTTPException(422, "Difficulty must be EASY, MEDIUM, or HARD")
    if merged["question_type"] not in QUESTION_TYPES:
        raise HTTPException(422, "Question type must be SINGLE, MULTI, or TRUE_FALSE")
    merged["source"] = str(merged["source"]).strip()
    if not merged["source"]:
        raise HTTPException(422, "Source cannot be blank")
    normalized_options = [str(option).strip() for option in merged["options"]]
    if any(not option for option in normalized_options) or len({option.casefold() for option in normalized_options}) != len(normalized_options):
        raise HTTPException(422, "Answer options must be non-empty and unique")
    merged["options"] = normalized_options
    _validate_question(
        merged["options"],
        merged["correct_index"],
        merged["correct_answers"],
        merged["question_type"],
    )
    if merged["correct_index"] is None:
        merged["correct_index"] = merged["correct_answers"][0]
    await _assert_unique_prompt(db, merged["topic"], merged["prompt"], exclude_id=question.id)
    before = {key: getattr(question, key) for key in values}
    for key, value in values.items():
        setattr(question, key, merged.get(key, value))
    await write_audit(
        db,
        user,
        "skill_question_updated",
        "skill_question",
        question_id,
        {"before": before, "after": values},
    )
    await db.commit()
    await db.refresh(question)
    return _question_dict(question)


@router.delete("/admin/questions/{question_id}", status_code=204)
async def delete_skill_question(
    question_id: int,
    user: admin_only,
    db: DbSession,
) -> None:
    question = await db.get(SkillQuestion, question_id)
    if question is None:
        raise HTTPException(404, "Skill question not found")
    await write_audit(
        db,
        user,
        "skill_question_deleted",
        "skill_question",
        question_id,
        {"topic": question.topic, "prompt": question.prompt},
    )
    await db.delete(question)
    await db.commit()


@router.post("/admin/questions/import")
async def import_skill_questions(
    user: admin_only,
    db: DbSession,
    file: UploadFile = File(...),
) -> dict[str, int]:
    if not (file.filename or "").lower().endswith(".csv"):
        raise HTTPException(415, "Upload a CSV file")
    raw = await file.read(2 * 1024 * 1024 + 1)
    if len(raw) > 2 * 1024 * 1024:
        raise HTTPException(413, "CSV file exceeds the 2 MB limit")
    try:
        text = raw.decode("utf-8-sig")
        reader = csv.DictReader(io.StringIO(text))
        required = {"topic", "prompt", "options", "explanation", "difficulty"}
        if not reader.fieldnames or not required.issubset(set(reader.fieldnames)):
            raise ValueError("CSV headers must include topic,prompt,options,correct_index,explanation,difficulty")
        rows = list(reader)
    except (UnicodeDecodeError, csv.Error, ValueError) as error:
        raise HTTPException(422, f"Invalid CSV: {error}") from error
    if not rows:
        raise HTTPException(422, "CSV contains no questions")

    questions: list[SkillQuestion] = []
    seen_prompts: set[tuple[str, str]] = set()
    for row_number, row in enumerate(rows, start=2):
        try:
            raw_options = row["options"].strip()
            options = json.loads(raw_options) if raw_options.startswith("[") else raw_options.split("|")
            raw_correct_answers = row.get("correct_answers", "").strip()
            correct_answers = json.loads(raw_correct_answers) if raw_correct_answers else None
            raw_correct_index = row.get("correct_index", "").strip()
            model = SkillQuestionCreate(
                topic=row["topic"],
                subtopic=row.get("subtopic") or "fundamentals",
                prompt=row["prompt"],
                options=options,
                correct_index=int(raw_correct_index) if raw_correct_index else None,
                correct_answers=correct_answers,
                explanation=row["explanation"],
                difficulty=row["difficulty"] or "MEDIUM",
                question_type=row.get("question_type") or "SINGLE",
                source=row.get("source") or "Admin CSV import",
                active=row.get("active", "true").strip().lower() not in {"0", "false", "no", "off"},
            )
            _validate_question(model.options, model.correct_index, model.correct_answers, model.question_type)
            values = model.model_dump()
            if values["correct_index"] is None:
                values["correct_index"] = values["correct_answers"][0]
            key = (model.topic, model.prompt.casefold())
            if key in seen_prompts:
                raise HTTPException(409, "Duplicate topic and prompt in this CSV")
            seen_prompts.add(key)
            await _assert_unique_prompt(db, model.topic, model.prompt)
            questions.append(SkillQuestion(**values))
        except (KeyError, TypeError, ValueError, HTTPException) as error:
            detail = error.detail if isinstance(error, HTTPException) else str(error)
            raise HTTPException(422, f"CSV row {row_number}: {detail}") from error

    db.add_all(questions)
    await db.flush()
    await write_audit(
        db,
        user,
        "skill_questions_imported",
        "skill_question",
        questions[0].id,
        metadata={"count": len(questions), "topics": sorted({question.topic for question in questions})},
    )
    await db.commit()
    return {"imported": len(questions)}


def _validated_resource_url(url: str) -> str:
    normalized = url.strip()
    parts = urlsplit(normalized)
    if parts.scheme not in {"http", "https"} or not parts.netloc:
        raise HTTPException(422, "Learning links must use an http or https URL")
    return normalized


def _learning_resource_dict(resource: SkillLearningResource) -> dict[str, Any]:
    return {
        "id": resource.id,
        "topic": resource.topic,
        "subtopic": resource.subtopic,
        "title": resource.title,
        "url": resource.url,
        "active": resource.active,
        "created_at": resource.created_at,
    }


@router.get("/admin/resources")
async def list_learning_resources(user: admin_only, db: DbSession) -> list[dict[str, Any]]:
    resources = list(await db.scalars(
        select(SkillLearningResource)
        .order_by(SkillLearningResource.topic, SkillLearningResource.subtopic, SkillLearningResource.id)
    ))
    return [_learning_resource_dict(resource) for resource in resources]


@router.post("/admin/resources", status_code=201)
async def create_learning_resource(
    data: SkillLearningResourceCreate,
    user: admin_only,
    db: DbSession,
) -> dict[str, Any]:
    topic = data.topic.strip().lower()
    subtopic = data.subtopic.strip().lower()
    url = _validated_resource_url(data.url)
    existing = await db.scalar(select(SkillLearningResource.id).where(
        SkillLearningResource.topic == topic,
        SkillLearningResource.subtopic == subtopic,
        SkillLearningResource.url == url,
    ))
    if existing is not None:
        raise HTTPException(409, "This learning link already exists for the topic and subtopic")
    resource = SkillLearningResource(
        topic=topic,
        subtopic=subtopic,
        title=data.title.strip(),
        url=url,
        created_by_user_id=user.id,
    )
    db.add(resource)
    await db.flush()
    await write_audit(
        db,
        user,
        "skill_learning_resource_created",
        "skill_learning_resource",
        resource.id,
        metadata={"topic": topic, "subtopic": subtopic, "title": resource.title},
    )
    await db.commit()
    await db.refresh(resource)
    return _learning_resource_dict(resource)


@router.patch("/admin/resources/{resource_id}")
async def update_learning_resource(
    resource_id: int,
    data: SkillLearningResourceUpdate,
    user: admin_only,
    db: DbSession,
) -> dict[str, Any]:
    resource = await db.get(SkillLearningResource, resource_id)
    if resource is None:
        raise HTTPException(404, "Learning resource not found")
    values = data.model_dump(exclude_unset=True)
    if not values:
        raise HTTPException(422, "Provide at least one resource field to update")
    before = {key: getattr(resource, key) for key in values}
    if "url" in values:
        values["url"] = _validated_resource_url(values["url"])
    if "title" in values:
        values["title"] = values["title"].strip()
    for key, value in values.items():
        setattr(resource, key, value)
    await write_audit(
        db,
        user,
        "skill_learning_resource_updated",
        "skill_learning_resource",
        resource.id,
        {"before": before, "after": values},
    )
    await db.commit()
    await db.refresh(resource)
    return _learning_resource_dict(resource)


@router.delete("/admin/resources/{resource_id}", status_code=204)
async def delete_learning_resource(
    resource_id: int,
    user: admin_only,
    db: DbSession,
) -> None:
    resource = await db.get(SkillLearningResource, resource_id)
    if resource is None:
        raise HTTPException(404, "Learning resource not found")
    await write_audit(
        db,
        user,
        "skill_learning_resource_deleted",
        "skill_learning_resource",
        resource.id,
        {"topic": resource.topic, "subtopic": resource.subtopic, "title": resource.title},
    )
    await db.delete(resource)
    await db.commit()


@router.get("/admin/stats")
async def get_skill_assessment_stats(user: admin_only, db: DbSession) -> list[dict[str, Any]]:
    questions = list(await db.scalars(select(SkillQuestion).order_by(SkillQuestion.topic, SkillQuestion.id)))
    attempts = list(await db.scalars(
        select(SkillAttempt).where(SkillAttempt.submitted_at.is_not(None))
    ))
    attempts_by_topic: dict[str, list[SkillAttempt]] = {}
    question_rates: dict[int, list[float]] = {}
    weakest_subtopics: dict[str, dict[str, list[float]]] = {}
    for attempt in attempts:
        attempts_by_topic.setdefault(attempt.topic, []).append(attempt)
        for subtopic, result in (attempt.subtopic_scores or {}).items():
            scores = weakest_subtopics.setdefault(attempt.topic, {}).setdefault(subtopic, [])
            scores.append(float(result.get("percentage", 0)))
        if attempt.answers is None:
            continue
        for question_id, snapshot, order, answer in zip(
            attempt.question_ids,
            attempt.question_snapshots,
            attempt.option_orders,
            attempt.answers,
        ):
            tally = question_rates.setdefault(question_id, [0, 0])
            credit, _, _ = _answer_credit(answer, snapshot, order)
            tally[1] += 1
            tally[0] += credit
    topics = sorted(set(TOPIC_INFO) | {question.topic for question in questions})
    stats = []
    for topic in topics:
        topic_attempts = attempts_by_topic.get(topic, [])
        topic_questions = [question for question in questions if question.topic == topic]
        active_by_difficulty = {
            difficulty: sum(
                question.active and question.difficulty.upper() == difficulty
                for question in topic_questions
            )
            for difficulty in ASSESSMENT_MIX
        }
        missing_mix = {
            difficulty: count - active_by_difficulty[difficulty]
            for difficulty, count in ASSESSMENT_MIX.items()
            if active_by_difficulty[difficulty] < count
        }
        hardest = sorted(
            (
                {
                    "question_id": question.id,
                    "prompt": question.prompt,
                    "attempts": question_rates.get(question.id, [0, 0])[1],
                    "correct_rate": (
                        round(100 * question_rates[question.id][0] / question_rates[question.id][1], 2)
                        if question_rates.get(question.id, [0, 0])[1]
                        else None
                    ),
                }
                for question in topic_questions
            ),
            key=lambda question: (
                question["correct_rate"] if question["correct_rate"] is not None else 101,
                -question["attempts"],
            ),
        )[:5]
        stats.append({
            "topic": topic,
            "attempts": len(topic_attempts),
            "pass_rate": (
                round(100 * sum(bool(attempt.passed) for attempt in topic_attempts) / len(topic_attempts))
                if topic_attempts else 0
            ),
            "average_score": (
                round(sum(float(attempt.weighted_percentage or 0) for attempt in topic_attempts) / len(topic_attempts), 2)
                if topic_attempts else None
            ),
            "active_questions": sum(question.active for question in topic_questions),
            "difficulty_pool_sizes": active_by_difficulty,
            "bank_warnings": [
                f"Add {missing} active {difficulty.lower()} question(s) for the required 4/4/2 attempt mix."
                for difficulty, missing in missing_mix.items()
            ] + [
                f"Only {active_by_difficulty[difficulty]} active {difficulty.lower()} questions; aim for at least 15 where the bank supports it."
                for difficulty in ASSESSMENT_MIX
                if active_by_difficulty[difficulty] < 15 and difficulty not in missing_mix
            ],
            "hardest_questions": hardest,
            "weakest_subtopics": [
                {
                    "subtopic": subtopic,
                    "average_percentage": round(sum(scores) / len(scores), 2),
                    "attempts": len(scores),
                }
                for subtopic, scores in sorted(
                    weakest_subtopics.get(topic, {}).items(),
                    key=lambda item: sum(item[1]) / len(item[1]),
                )[:5]
            ],
        })
    return stats
