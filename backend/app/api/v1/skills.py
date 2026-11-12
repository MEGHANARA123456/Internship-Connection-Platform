"""Verified skill assessments, student credentials, and admin question management."""

import csv
import io
import json
import logging
import math
import random
import re
import textwrap
from calendar import monthrange
from datetime import date, datetime, timedelta, timezone
from typing import Annotated, Any
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel, ConfigDict, Field, StrictInt, field_validator, model_validator
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from starlette.responses import StreamingResponse
from fastapi.responses import JSONResponse

from app.api.v1.dependencies import DbSession, require_roles
from app.models import AuditLog, Internship, Notification, SkillAttempt, SkillBadge, SkillLearningResource, SkillQuestion, SkillTopic, User, UserRole
from app.services.audit import write_audit
from app.services.question_import import (
    MAX_IMPORT_FILE_SIZE,
    build_question_import_template_csv,
    build_question_import_template_xlsx,
    parse_question_import_file,
)
from app.services.question_key_audit import question_key_audit_csv
from app.services.skill_badges import badge_matches_skill


router = APIRouter(prefix="/skills", tags=["skills"])
student_only = Annotated[User, Depends(require_roles(UserRole.STUDENT))]
admin_only = Annotated[User, Depends(require_roles(UserRole.ADMIN))]
logger = logging.getLogger(__name__)

ASSESSMENT_QUESTION_COUNT = 10
ASSESSMENT_MIX = {"EASY": 4, "MEDIUM": 4, "HARD": 2}
DIFFICULTY_WEIGHTS = {"EASY": 1, "MEDIUM": 2, "HARD": 3}
ASSESSMENT_DURATION = timedelta(minutes=15)
RETENTION_WINDOW = timedelta(days=7)
ASSESSMENT_ATTEMPT_LIMIT = 3
ASSESSMENT_RETAKE_COOLDOWN = timedelta(hours=24)
PASS_PERCENTAGE = 80
TOPIC_INFO: dict[str, dict[str, str]] = {
    "python": {"name": "Python & Backend Architecture", "icon": "🐍", "badge_title": "Verified Python Specialist", "description": "Build dependable Python services and backend systems."},
    "react": {"name": "React & Modern Frontend", "icon": "⚛️", "badge_title": "Verified React Pro", "description": "Create responsive interfaces with modern React."},
    "sql": {"name": "SQL & Database Design", "icon": "🗄️", "badge_title": "Verified SQL Specialist", "description": "Query, model, and reason about relational data."},
    "dsa": {"name": "Data Structures & Algorithms", "icon": "🧮", "badge_title": "Verified DSA Problem Solver", "description": "Practice core structures, complexity, and algorithms."},
    "ai": {"name": "Machine Learning & AI Engineering", "icon": "🤖", "badge_title": "Verified AI/ML Engineer", "description": "Explore machine learning concepts and practical AI."},
    "devops": {"name": "Cloud, Docker & DevOps", "icon": "☁️", "badge_title": "Verified Cloud & DevOps Specialist", "description": "Understand cloud infrastructure and delivery workflows."},
    "security": {"name": "Web Security & System Design", "icon": "🛡️", "badge_title": "Verified Security & Systems Pro", "description": "Apply secure design principles to web systems."},
    "typescript": {"name": "JavaScript & TypeScript Mastery", "icon": "🔷", "badge_title": "Verified TypeScript Specialist", "description": "Strengthen typed JavaScript and application design."},
}
DIFFICULTIES = set(DIFFICULTY_WEIGHTS)
QUESTION_TYPES = {"SINGLE", "MULTI", "TRUE_FALSE"}


class AssessmentStart(BaseModel):
    topic: str = Field(min_length=1, max_length=100)

    @field_validator("topic")
    @classmethod
    def trim_topic(cls, value: str) -> str:
        """Strip whitespace and lowercase the assessment topic supplied in the request."""
        return value.strip().lower()


class AssessmentSubmit(BaseModel):
    answers: list[int | list[int]] = Field(min_length=ASSESSMENT_QUESTION_COUNT, max_length=ASSESSMENT_QUESTION_COUNT)
    question_time_seconds: list[int] = Field(default_factory=list, max_length=ASSESSMENT_QUESTION_COUNT)

    @field_validator("question_time_seconds")
    @classmethod
    def validate_question_times(cls, values: list[int]) -> list[int]:
        """Reject per-question durations outside zero through the configured assessment duration."""
        if any(value < 0 or value > int(ASSESSMENT_DURATION.total_seconds()) for value in values):
            raise ValueError("Question times must be between 0 and 900 seconds")
        return values


class AssessmentAnswers(BaseModel):
    model_config = ConfigDict(extra="forbid")

    answers: list[StrictInt | list[StrictInt] | None] = Field(
        min_length=ASSESSMENT_QUESTION_COUNT,
        max_length=ASSESSMENT_QUESTION_COUNT,
    )


class SkillQuestionCreate(BaseModel):
    topic: str = Field(min_length=1, max_length=100)
    subtopic: str = Field(default="fundamentals", min_length=2, max_length=40)
    prompt: str = Field(min_length=1, max_length=4000)
    options: list[str] = Field(min_length=2, max_length=8)
    correct_index: int | None = Field(default=None, ge=0, description="Zero-based correct answer option index.")
    correct_answers: list[int] | None = Field(default=None, description="Zero-based correct answer option indices for MULTI questions.")
    correct_option_number: int | None = Field(default=None, ge=1, description="One-based correct answer option number.")
    correct_option_numbers: list[int] | None = Field(default=None, description="One-based correct answer option numbers for MULTI questions.")
    explanation: str = Field(min_length=1, max_length=4000)
    difficulty: str = "MEDIUM"
    question_type: str = "SINGLE"
    source: str = Field(default="InternSphere curated assessment bank", max_length=500)
    resource_title: str | None = None
    resource_url: str | None = None
    resource_subtopic: str | None = None
    active: bool = True

    @model_validator(mode="after")
    def convert_option_numbers(self) -> "SkillQuestionCreate":
        supplied = self.model_fields_set
        if {"correct_index", "correct_option_number"} <= supplied:
            raise ValueError("Send either zero-based correct_index or one-based correct_option_number, not both")
        if {"correct_answers", "correct_option_numbers"} <= supplied:
            raise ValueError("Send either zero-based correct_answers or one-based correct_option_numbers, not both")
        if self.correct_option_number is not None:
            self.correct_index = self.correct_option_number - 1
        if self.correct_option_numbers is not None:
            if any(number < 1 for number in self.correct_option_numbers):
                raise ValueError("Correct option numbers must be 1 or greater")
            self.correct_answers = sorted(number - 1 for number in self.correct_option_numbers)
        return self

    @field_validator("topic", "prompt", "explanation")
    @classmethod
    def trim_required_text(cls, value: str) -> str:
        """Strip required question text fields and reject values that become blank."""
        result = value.strip()
        if not result:
            raise ValueError("This value cannot be blank")
        return result

    @field_validator("subtopic")
    @classmethod
    def validate_subtopic(cls, value: str) -> str:
        """Normalize a subtopic slug and restrict it to lowercase letters, digits, and hyphens."""
        result = re.sub(r"[\s_]+", "-", value.strip().lower()).strip("-")
        if not 2 <= len(result) <= 40 or not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", result):
            raise ValueError("Subtopic must be 2-40 characters using lowercase letters, numbers, and hyphens.")
        return result

    @field_validator("topic")
    @classmethod
    def validate_topic(cls, value: str) -> str:
        """Normalize a topic identifier to lowercase and reject characters outside its identifier format."""
        if not re.fullmatch(r"[a-z0-9][a-z0-9_-]*", value.lower()):
            raise ValueError("Topic must be a lowercase id using letters, numbers, '-' or '_'")
        return value.lower()

    @field_validator("options")
    @classmethod
    def validate_options(cls, values: list[str]) -> list[str]:
        """Trim answer options and reject blank or case-insensitively duplicated values."""
        normalized = [value.strip() for value in values]
        if any(not value for value in normalized):
            raise ValueError("Answer options cannot be blank")
        if len({value.casefold() for value in normalized}) != len(normalized):
            raise ValueError("Answer options must not contain duplicates")
        return normalized

    @field_validator("difficulty")
    @classmethod
    def validate_difficulty(cls, value: str) -> str:
        """Normalize supported difficulty aliases and require EASY, MEDIUM, or HARD."""
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
        """Normalize and validate a question type against the supported assessment types."""
        question_type = value.strip().upper()
        if question_type not in QUESTION_TYPES:
            raise ValueError("Question type must be SINGLE, MULTI, or TRUE_FALSE")
        return question_type

    @field_validator("source")
    @classmethod
    def validate_source(cls, value: str) -> str:
        """Trim the source label and reject a blank value."""
        result = value.strip()
        if not result:
            raise ValueError("Source cannot be blank")
        return result

    @field_validator("resource_title", "resource_url", "resource_subtopic")
    @classmethod
    def validate_optional_resource(cls, value: str | None) -> str | None:
        """Accept optional learning-resource fields only when they are supplied as a complete set."""
        if value is None:
            return None
        return value.strip()


class SkillQuestionUpdate(BaseModel):
    topic: str | None = Field(default=None, min_length=1, max_length=100)
    subtopic: str | None = Field(default=None, min_length=2, max_length=40)
    prompt: str | None = Field(default=None, min_length=1, max_length=4000)
    options: list[str] | None = Field(default=None, min_length=2, max_length=8)
    correct_index: int | None = Field(default=None, ge=0, description="Zero-based correct answer option index.")
    correct_answers: list[int] | None = Field(default=None, description="Zero-based correct answer option indices for MULTI questions.")
    correct_option_number: int | None = Field(default=None, ge=1, description="One-based correct answer option number.")
    correct_option_numbers: list[int] | None = Field(default=None, description="One-based correct answer option numbers for MULTI questions.")
    explanation: str | None = Field(default=None, min_length=1, max_length=4000)
    difficulty: str | None = None
    question_type: str | None = None
    source: str | None = Field(default=None, min_length=1, max_length=500)
    active: bool | None = None

    @model_validator(mode="after")
    def convert_option_numbers(self) -> "SkillQuestionUpdate":
        supplied = self.model_fields_set
        if {"correct_index", "correct_option_number"} <= supplied:
            raise ValueError("Send either zero-based correct_index or one-based correct_option_number, not both")
        if {"correct_answers", "correct_option_numbers"} <= supplied:
            raise ValueError("Send either zero-based correct_answers or one-based correct_option_numbers, not both")
        if self.correct_option_number is not None:
            self.correct_index = self.correct_option_number - 1
        if self.correct_option_numbers is not None:
            if any(number < 1 for number in self.correct_option_numbers):
                raise ValueError("Correct option numbers must be 1 or greater")
            self.correct_answers = sorted(number - 1 for number in self.correct_option_numbers)
        return self

    @field_validator("subtopic")
    @classmethod
    def normalize_subtopic(cls, value: str | None) -> str | None:
        if value is None:
            return None
        result = re.sub(r"[\s_]+", "-", value.strip().lower()).strip("-")
        if not 2 <= len(result) <= 40 or not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", result):
            raise ValueError("Subtopic must be 2-40 characters using lowercase letters, numbers, and hyphens.")
        return result


class SkillQuestionKeyReview(BaseModel):
    correct_option_number: int | None = Field(default=None, ge=1)
    correct_option_numbers: list[int] | None = None

    @model_validator(mode="after")
    def validate_key_choice(self) -> "SkillQuestionKeyReview":
        supplied = self.model_fields_set
        if {"correct_option_number", "correct_option_numbers"} <= supplied:
            raise ValueError("Choose either one correct option number or a list of correct option numbers")
        if self.correct_option_numbers is not None and any(number < 1 for number in self.correct_option_numbers):
            raise ValueError("Correct option numbers must be 1 or greater")
        return self


class SkillLearningResourceCreate(BaseModel):
    topic: str = Field(min_length=1, max_length=100)
    subtopic: str = Field(min_length=1, max_length=100)
    title: str = Field(min_length=1, max_length=255)
    url: str = Field(min_length=1, max_length=1000)


class SkillLearningResourceUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    url: str | None = Field(default=None, min_length=1, max_length=1000)
    active: bool | None = None


class SkillTopicUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=3, max_length=60)
    description: str | None = Field(default=None, max_length=200)
    icon: str | None = Field(default=None, min_length=1, max_length=80)
    badge_title: str | None = Field(default=None, min_length=1, max_length=255)

    @field_validator("name", "icon", "badge_title")
    @classmethod
    def trim_topic_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        trimmed = value.strip()
        if not trimmed:
            raise ValueError("This value cannot be blank")
        return trimmed


class SkillTopicCreate(BaseModel):
    topic: str = Field(min_length=2, max_length=40)
    name: str = Field(min_length=3, max_length=60)
    description: str = Field(default="", max_length=200)
    icon: str = Field(default="✦", min_length=1, max_length=80)
    badge_title: str = Field(default="", max_length=255)

    @field_validator("topic")
    @classmethod
    def validate_slug(cls, value: str) -> str:
        slug = value.strip().lower()
        if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", slug):
            raise ValueError("Topic ID must use lowercase letters, numbers, and hyphens.")
        return slug

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        trimmed = value.strip()
        if not 3 <= len(trimmed) <= 60:
            raise ValueError("Topic name must be 3-60 characters.")
        return trimmed

    @field_validator("icon")
    @classmethod
    def validate_icon(cls, value: str) -> str:
        trimmed = value.strip()
        if not trimmed:
            raise ValueError("Topic icon cannot be blank.")
        return trimmed

    @field_validator("description", "badge_title")
    @classmethod
    def normalize_optional_text(cls, value: str) -> str:
        return value.strip()


def _utc(value: datetime) -> datetime:
    """Normalize a datetime to UTC, attaching UTC to naive values."""
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def _add_months(value: datetime, months: int) -> datetime:
    """Shift a datetime by whole calendar months, clamping the day to the destination month."""
    month_index = value.month - 1 + months
    year = value.year + month_index // 12
    month = month_index % 12 + 1
    day = min(value.day, monthrange(year, month)[1])
    return value.replace(year=year, month=month, day=day)


def _retry_after(until: datetime, now: datetime) -> int:
    """Return the positive whole-second delay until an assessment becomes available."""
    return max(1, math.ceil((until - now).total_seconds()))


def _attempt_payload(attempt: SkillAttempt, now: datetime, *, resumed: bool) -> dict[str, Any]:
    """Serialize an active assessment attempt, shuffling options by its saved order and including remaining time and resumed answers."""
    questions = [
        {
            "id": question_id,
            "prompt": snapshot["prompt"],
            "options": [
                snapshot["options"][index]
                for index in option_order
            ],
            "difficulty": snapshot.get("difficulty", "MEDIUM"),
            "subtopic": snapshot.get("subtopic", "fundamentals"),
            "question_type": snapshot.get("question_type", "SINGLE"),
        }
        for question_id, snapshot, option_order in zip(
            attempt.question_ids,
            attempt.question_snapshots,
            attempt.option_orders,
        )
    ]
    default_answers = [
        [] if snapshot.get("question_type") == "MULTI" else None
        for snapshot in attempt.question_snapshots
    ]
    return {
        "attempt_id": attempt.id,
        "topic": attempt.topic,
        "started_at": attempt.started_at,
        "expires_at": attempt.expires_at,
        "remaining_seconds": max(0, math.ceil((_utc(attempt.expires_at) - now).total_seconds())),
        "resumed": resumed,
        "questions": questions,
        "answers": (
            attempt.answers if attempt.answers is not None else default_answers
        ) if resumed else None,
    }


def _assessment_limit_error(code: str, next_available_at: datetime, detail: str, now: datetime) -> JSONResponse:
    """Build a 429 response with the next assessment availability time and Retry-After header."""
    return JSONResponse(
        status_code=429,
        content={
            "code": code,
            "next_available_at": _utc(next_available_at).isoformat(),
            "detail": detail,
        },
        headers={"Retry-After": str(_retry_after(next_available_at, now))},
    )


def _badge_level(score: float) -> str:
    """Map a percentage score to the Beginner, Intermediate, or Advanced badge level."""
    if score >= 80:
        return "Advanced"
    if score >= 60:
        return "Intermediate"
    return "Beginner"


def _question_dict(question: SkillQuestion) -> dict[str, Any]:
    """Serialize a skill question with its answer key, explanation, difficulty, and source fields."""
    correct_indices = question.correct_answers or [question.correct_index]
    return {
        "id": question.id,
        "topic": question.topic,
        "prompt": question.prompt,
        "options": question.options,
        "correct_index": question.correct_index,
        "correct_answers": question.correct_answers,
        "correct_option_number": question.correct_index + 1,
        "correct_option_numbers": [index + 1 for index in correct_indices],
        "explanation": question.explanation,
        "difficulty": question.difficulty,
        "subtopic": question.subtopic,
        "question_type": question.question_type,
        "source": question.source,
        "active": question.active,
        "key_reviewed_at": question.key_reviewed_at,
        "key_reviewed_by": question.key_reviewed_by,
        "created_at": question.created_at,
    }


def _correct_indices(snapshot: dict[str, Any]) -> list[int]:
    """Return the correct option indices from a question snapshot, supporting both legacy and multi-answer data."""
    answers = snapshot.get("correct_answers")
    if isinstance(answers, list) and answers:
        return [int(answer) for answer in answers]
    return [int(snapshot["correct_index"])]


def _answer_credit(
    answer: int | list[int],
    snapshot: dict[str, Any],
    option_order: list[int],
) -> tuple[float, str | list[str], str | list[str]]:
    """Map displayed selections back to stored options and calculate credit, raising 422 for invalid selections."""
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
    """Validate correct-answer indices and option counts for single-, multiple-, and true/false questions."""
    if question_type == "TRUE_FALSE" and len(options) != 2:
        raise HTTPException(422, "TRUE_FALSE questions must have exactly two options")
    if question_type == "MULTI":
        if not correct_answers or len(correct_answers) < 2:
            raise HTTPException(422, "MULTI questions require at least two correct option numbers")
        if len(set(correct_answers)) != len(correct_answers):
            raise HTTPException(422, "Correct option numbers must be unique")
        if any(index < 0 or index >= len(options) for index in correct_answers):
            raise HTTPException(422, f"Choose correct option numbers from 1 to {len(options)}")
        return
    if correct_index is None or correct_index >= len(options):
        raise HTTPException(422, f"Choose a correct option number from 1 to {len(options)}")
    if correct_answers not in (None, [], [correct_index]):
        raise HTTPException(422, "SINGLE and TRUE_FALSE questions use correct_index")


def _difficulty_weight(difficulty: str) -> int:
    """Return the configured score weight for a difficulty, defaulting unknown values to the medium weight."""
    return DIFFICULTY_WEIGHTS.get(difficulty.upper(), 2)


def _question_results(attempt: SkillAttempt) -> list[dict[str, Any]]:
    """Build per-question result details, including selected/correct answers, earned credit, and recorded time."""
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
    """Build a submitted assessment result with question details, subtopic strengths, weaknesses, and learning resources."""
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
    """Render an assessment result into a downloadable PDF report."""
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
        """Escape text characters that are special in PDF string literals."""
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
    """Reject a question prompt that duplicates another question in the same topic."""
    query = select(SkillQuestion.id).where(
        SkillQuestion.topic == topic,
        func.lower(SkillQuestion.prompt) == prompt.casefold(),
    )
    if exclude_id is not None:
        query = query.where(SkillQuestion.id != exclude_id)
    if await db.scalar(query) is not None:
        raise HTTPException(409, "A question with this topic and prompt already exists")


@router.get("/topics")
async def list_assessment_topics(user: student_only, db: DbSession) -> list[dict[str, Any]]:
    """List only non-archived topics with a question pool ready for student participation."""
    rows = (await db.execute(
        select(SkillQuestion.topic, SkillQuestion.difficulty, func.count(SkillQuestion.id))
        .where(SkillQuestion.active.is_(True))
        .group_by(SkillQuestion.topic, SkillQuestion.difficulty)
        .order_by(SkillQuestion.topic)
    )).all()
    counts_by_topic: dict[str, dict[str, int]] = {}
    for topic, difficulty, count in rows:
        if not isinstance(topic, str) or not topic.strip():
            logger.warning("Skipping skill-question readiness row with an empty topic.")
            continue
        if not isinstance(difficulty, str):
            logger.warning("Skipping skill-question readiness row for %r with no difficulty.", topic)
            continue
        topic_slug = topic.strip()
        counts = counts_by_topic.setdefault(topic_slug, {})
        counts[difficulty.upper()] = int(count or 0)
    topic_metadata = {
        topic.slug: topic
        for topic in await db.scalars(select(SkillTopic))
    }

    student_attempts: dict[str, dict[str, Any]] = {}
    attempts = await db.execute(
        select(SkillAttempt.topic, SkillAttempt.status, SkillAttempt.score)
        .where(SkillAttempt.student_id == user.id)
        .order_by(SkillAttempt.started_at.desc(), SkillAttempt.id.desc())
    )
    for topic, status, score in attempts:
        if not isinstance(topic, str) or not topic.strip():
            continue
        summary = student_attempts.setdefault(
            topic,
            {"attempt_status": status, "best_score": None},
        )
        if score is not None and (
            summary["best_score"] is None or score > summary["best_score"]
        ):
            summary["best_score"] = score

    topics = []
    for topic in sorted(set(counts_by_topic) | set(topic_metadata)):
        try:
            metadata = topic_metadata.get(topic)
            if metadata is not None and metadata.archived_at is not None:
                continue
            counts = counts_by_topic.get(topic, {})
            missing = [
                f"{required - counts.get(difficulty, 0)} more active {difficulty.lower()} question(s)"
                for difficulty, required in ASSESSMENT_MIX.items()
                if counts.get(difficulty, 0) < required
            ]
            if missing:
                continue
            defaults = TOPIC_INFO.get(topic, {})
            attempt = student_attempts.get(topic, {})
            topics.append({
                "id": topic,
                "name": metadata.name if metadata else defaults.get("name", topic.replace("-", " ").replace("_", " ").title()),
                "icon": metadata.icon if metadata else defaults.get("icon", "✦"),
                "description": metadata.description if metadata else defaults.get("description", "Show what you know and build a verified skill."),
                "badge_title": metadata.badge_title if metadata else defaults.get("badge_title", f"Verified {topic.title()} Specialist"),
                "question_counts": {
                    difficulty.lower(): counts.get(difficulty, 0)
                    for difficulty in ASSESSMENT_MIX
                },
                "available": True,
                "unavailable_reason": None,
                "question_count": ASSESSMENT_QUESTION_COUNT,
                "duration_seconds": int(ASSESSMENT_DURATION.total_seconds()),
                "pass_percentage": PASS_PERCENTAGE,
                "attempt_status": attempt.get("attempt_status"),
                "best_score": attempt.get("best_score"),
            })
        except Exception:
            logger.exception("Skipping invalid skill assessment topic %r.", topic)
    return topics


@router.post("/assessments/start")
async def start_assessment(
    data: AssessmentStart,
    user: student_only,
    db: DbSession,
) -> dict[str, Any]:
    """Resume an eligible in-progress attempt or create a randomized timed assessment for the student."""
    student_id = user.id
    topic_metadata = await db.scalar(
        select(SkillTopic).where(SkillTopic.slug == data.topic).with_for_update()
    )
    await db.scalar(select(User).where(User.id == student_id).with_for_update())
    now = datetime.now(timezone.utc)
    active_attempt = await db.scalar(
        select(SkillAttempt)
        .where(
            SkillAttempt.student_id == student_id,
            SkillAttempt.topic == data.topic,
            SkillAttempt.status == "IN_PROGRESS",
        )
        .with_for_update()
    )
    expired_attempt_closed = False
    if active_attempt is not None:
        if now < _utc(active_attempt.expires_at):
            return _attempt_payload(active_attempt, now, resumed=True)
        active_attempt.status = "EXPIRED"
        expired_attempt_closed = True
        await db.flush()

    if topic_metadata is not None and topic_metadata.archived_at is not None:
        if expired_attempt_closed:
            await db.commit()
        raise HTTPException(404, "Assessment topic not found")
    if not await _topic_is_ready(db, data.topic):
        if expired_attempt_closed:
            await db.commit()
        raise HTTPException(409, "This assessment topic is not ready yet")

    weekly_attempts = list(await db.scalars(
        select(SkillAttempt)
        .where(SkillAttempt.student_id == student_id, SkillAttempt.started_at >= now - RETENTION_WINDOW)
        .order_by(SkillAttempt.started_at)
    ))
    if len(weekly_attempts) >= ASSESSMENT_ATTEMPT_LIMIT:
        oldest_expiry = _utc(weekly_attempts[0].started_at) + RETENTION_WINDOW
        response = _assessment_limit_error(
            "WEEKLY_LIMIT",
            oldest_expiry,
            f"You have reached the limit of {ASSESSMENT_ATTEMPT_LIMIT} assessment attempts in "
            f"{RETENTION_WINDOW.days} days. Try again after the oldest attempt leaves the weekly window.",
            now,
        )
        if expired_attempt_closed:
            await db.commit()
        return response

    latest_for_topic = await db.scalar(
        select(SkillAttempt)
        .where(SkillAttempt.student_id == student_id, SkillAttempt.topic == data.topic)
        .order_by(SkillAttempt.started_at.desc())
        .limit(1)
    )
    if latest_for_topic is not None:
        retry_at = _utc(latest_for_topic.started_at) + ASSESSMENT_RETAKE_COOLDOWN
        if now < retry_at:
            response = _assessment_limit_error(
                "COOLDOWN",
                retry_at,
                f"You can retake this topic {int(ASSESSMENT_RETAKE_COOLDOWN.total_seconds() // 3600)} "
                "hours after your previous attempt.",
                now,
            )
            if expired_attempt_closed:
                await db.commit()
            return response

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
            SkillAttempt.student_id == student_id,
            SkillAttempt.topic == data.topic,
        )
    ) or 0)
    option_orders: list[list[int]] = []
    snapshots: list[dict[str, Any]] = []
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

    attempt = SkillAttempt(
        student_id=student_id,
        topic=data.topic,
        status="IN_PROGRESS",
        question_ids=[question.id for question in chosen_questions],
        question_snapshots=snapshots,
        option_orders=option_orders,
        started_at=now,
        expires_at=now + ASSESSMENT_DURATION,
        attempt_number=topic_attempt_count + 1,
    )
    db.add(attempt)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        active_attempt = await db.scalar(
            select(SkillAttempt).where(
                SkillAttempt.student_id == student_id,
                SkillAttempt.topic == data.topic,
                SkillAttempt.status == "IN_PROGRESS",
            )
        )
        resumed_at = datetime.now(timezone.utc)
        if active_attempt is None or resumed_at >= _utc(active_attempt.expires_at):
            raise
        return _attempt_payload(active_attempt, resumed_at, resumed=True)
    await db.refresh(attempt)
    return _attempt_payload(attempt, datetime.now(timezone.utc), resumed=False)


@router.get("/assessments/active")
async def get_active_assessment(
    user: student_only,
    db: DbSession,
    topic: str,
) -> dict[str, Any] | None:
    """Return the authenticated student?s current unsubmitted assessment attempt, if one is active."""
    normalized_topic = topic.strip().lower()
    attempt = await db.scalar(
        select(SkillAttempt).where(
            SkillAttempt.student_id == user.id,
            SkillAttempt.topic == normalized_topic,
            SkillAttempt.status == "IN_PROGRESS",
        )
    )
    if attempt is None:
        return None
    now = datetime.now(timezone.utc)
    if now >= _utc(attempt.expires_at):
        attempt.status = "EXPIRED"
        await db.commit()
        return None
    return _attempt_payload(attempt, now, resumed=True)


@router.put("/attempts/{attempt_id}/answers")
async def save_assessment_answers(
    attempt_id: int,
    data: AssessmentAnswers,
    user: student_only,
    db: DbSession,
) -> dict[str, Any]:
    """Persist draft answers for the student?s active assessment without submitting it."""
    attempt = await db.scalar(
        select(SkillAttempt).where(
            SkillAttempt.id == attempt_id,
            SkillAttempt.student_id == user.id,
        ).with_for_update()
    )
    if attempt is None:
        raise HTTPException(404, "Assessment attempt not found")
    if attempt.status != "IN_PROGRESS" or attempt.submitted_at is not None:
        raise HTTPException(409, "This assessment attempt is no longer in progress")
    if datetime.now(timezone.utc) >= _utc(attempt.expires_at):
        attempt.status = "EXPIRED"
        await db.commit()
        raise HTTPException(410, "The assessment time limit expired.")
    if len(data.answers) != len(attempt.option_orders):
        raise HTTPException(422, "Provide one selection entry for each question")
    for answer, snapshot, option_order in zip(
        data.answers,
        attempt.question_snapshots,
        attempt.option_orders,
    ):
        if snapshot.get("question_type") == "MULTI":
            if not isinstance(answer, list):
                raise HTTPException(422, "Multi-answer questions require a selection list")
        elif answer is None:
            continue
        elif not isinstance(answer, int) or isinstance(answer, bool):
            raise HTTPException(422, "Single-answer questions require one selected option")
        selected = answer if isinstance(answer, list) else [answer]
        if len(set(selected)) != len(selected) or any(
            selection < 0 or selection >= len(option_order) for selection in selected
        ):
            raise HTTPException(422, "An answer does not match an available option")
    attempt.answers = data.answers
    await db.commit()
    return {"saved": True}


@router.post("/assessments/{attempt_id}/submit")
async def submit_assessment(
    attempt_id: int,
    data: AssessmentSubmit,
    user: student_only,
    db: DbSession,
) -> dict[str, Any]:
    """Validate and grade the active assessment, persist its result, and update any earned skill credential."""
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
        attempt.status = "EXPIRED"
        await db.commit()
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
    attempt.status = "COMPLETED"
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
        topic_metadata = await db.get(SkillTopic, attempt.topic)
        topic_info = TOPIC_INFO.get(attempt.topic, {})
        badge = SkillBadge(
            student_id=user.id,
            topic=attempt.topic,
            title=topic_metadata.badge_title if topic_metadata else topic_info.get("badge_title", f"Verified {attempt.topic.title()} Specialist"),
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
    """Return a submitted assessment result belonging to the authenticated student."""
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
    """Generate and stream the PDF report for a submitted assessment owned by the student."""
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
    """List the authenticated student?s assessment attempts, newest first."""
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
    """List skill badges earned by the authenticated student."""
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
    """List the authenticated student?s assessment attempt summaries."""
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
            "status": attempt.status,
            "passed": attempt.passed,
            "started_at": attempt.started_at,
            "expires_at": attempt.expires_at,
            "submitted_at": attempt.submitted_at,
            "subtopic_scores": attempt.subtopic_scores or {},
        }
        for attempt in attempts
    ]


@router.get("/admin/questions")
async def list_skill_questions(
    user: admin_only,
    db: DbSession,
    topic: str | None = None,
    topic_id: str | None = None,
    active: bool | None = None,
) -> list[dict[str, Any]]:
    """List skill questions with the supported topic and question-management filters."""
    query = select(SkillQuestion).order_by(SkillQuestion.topic, SkillQuestion.id)
    selected_topic = topic_id or topic
    if selected_topic:
        query = query.where(SkillQuestion.topic == selected_topic.strip().lower())
    if active is not None:
        query = query.where(SkillQuestion.active.is_(active))
    questions = list(await db.scalars(query))
    return [_question_dict(question) for question in questions]


@router.get("/admin/questions/key-review")
async def list_unreviewed_skill_question_keys(
    user: admin_only,
    db: DbSession,
) -> list[dict[str, Any]]:
    questions = list(await db.scalars(
        select(SkillQuestion)
        .where(SkillQuestion.key_reviewed_at.is_(None))
        .order_by(SkillQuestion.topic, SkillQuestion.id)
    ))
    return [_question_dict(question) for question in questions]


@router.get("/admin/questions/key-audit")
async def download_skill_question_key_audit(
    user: admin_only,
    db: DbSession,
) -> StreamingResponse:
    questions = list(await db.scalars(select(SkillQuestion).order_by(SkillQuestion.id)))
    content = question_key_audit_csv(questions)
    return StreamingResponse(
        iter([content]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="skill-question-key-audit.csv"'},
    )


@router.post("/admin/questions/{question_id}/key-review")
async def review_skill_question_key(
    question_id: int,
    data: SkillQuestionKeyReview,
    user: admin_only,
    db: DbSession,
) -> dict[str, Any]:
    question = await db.get(SkillQuestion, question_id)
    if question is None:
        raise HTTPException(404, "Skill question not found")

    fields = data.model_fields_set
    has_single_number = "correct_option_number" in fields
    has_multiple_numbers = "correct_option_numbers" in fields
    if has_single_number or has_multiple_numbers:
        if question.question_type == "MULTI":
            if not has_multiple_numbers or data.correct_option_numbers is None:
                raise HTTPException(422, "Choose at least two correct option numbers for a MULTI question")
            indices = [number - 1 for number in data.correct_option_numbers]
            _validate_question(question.options, indices[0] if indices else None, indices, "MULTI")
            question.correct_index = indices[0]
            question.correct_answers = indices
        else:
            if not has_single_number or data.correct_option_number is None:
                raise HTTPException(422, "Choose exactly one correct option number")
            index = data.correct_option_number - 1
            _validate_question(question.options, index, None, question.question_type)
            question.correct_index = index
            question.correct_answers = None

    question.key_reviewed_at = datetime.now(timezone.utc)
    question.key_reviewed_by = user.id
    await write_audit(
        db,
        user,
        "skill_question_key_reviewed",
        "skill_question",
        question.id,
        metadata={
            "topic": question.topic,
            "correct_option_numbers": [
                index + 1 for index in (question.correct_answers or [question.correct_index])
            ],
        },
    )
    await db.commit()
    await db.refresh(question)
    return _question_dict(question)


@router.post("/admin/questions", status_code=201)
async def create_skill_question(
    data: SkillQuestionCreate,
    user: admin_only,
    db: DbSession,
) -> dict[str, Any]:
    """Validate and create a skill question, recording the administrator action."""
    if await db.get(SkillTopic, data.topic) is None:
        raise HTTPException(404, "Skill topic not found")
    _validate_question(data.options, data.correct_index, data.correct_answers, data.question_type)
    await _assert_unique_prompt(db, data.topic, data.prompt)
    values = data.model_dump(exclude={"correct_option_number", "correct_option_numbers"})
    if values["correct_index"] is None:
        values["correct_index"] = values["correct_answers"][0]
    values["key_reviewed_at"] = datetime.now(timezone.utc)
    values["key_reviewed_by"] = user.id
    resource_title = values.pop("resource_title", None)
    resource_url = values.pop("resource_url", None)
    resource_subtopic = values.pop("resource_subtopic", None)
    question = SkillQuestion(**values)
    db.add(question)
    await db.flush()
    if resource_title is not None or resource_url is not None:
        if not (resource_title and resource_url):
            raise HTTPException(422, "Both resource title and URL are required when adding a learning resource")
        resource_subtopic = re.sub(r"[\s_]+", "-", (resource_subtopic or data.subtopic).strip().lower()).strip("-")
        if not 2 <= len(resource_subtopic) <= 40 or not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", resource_subtopic):
            raise HTTPException(422, "Resource subtopic must be 2-40 characters using lowercase letters, numbers, and hyphens.")
        resource_url = _validated_resource_url(resource_url)
        resource = SkillLearningResource(
            topic=data.topic.strip().lower(),
            subtopic=resource_subtopic,
            title=resource_title.strip(),
            url=resource_url,
            created_by_user_id=user.id,
        )
        db.add(resource)
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
    """Update an existing skill question from the supplied fields and record the administrator action."""
    question = await db.get(SkillQuestion, question_id)
    if question is None:
        raise HTTPException(404, "Skill question not found")
    values = data.model_dump(exclude_unset=True, exclude={"correct_option_number", "correct_option_numbers"})
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
    merged["subtopic"] = re.sub(r"[\s_]+", "-", str(merged["subtopic"]).strip().lower()).strip("-")
    merged["prompt"] = str(merged["prompt"]).strip()
    merged["explanation"] = str(merged["explanation"]).strip()
    if not merged["prompt"] or not merged["explanation"]:
        raise HTTPException(422, "Prompt and explanation cannot be blank")
    if not re.fullmatch(r"[a-z0-9][a-z0-9_-]*", merged["topic"]):
        raise HTTPException(422, "Topic must be a lowercase id using letters, numbers, '-' or '_'")
    if await db.get(SkillTopic, merged["topic"]) is None:
        raise HTTPException(404, "Skill topic not found")
    if not 2 <= len(merged["subtopic"]) <= 40 or not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", merged["subtopic"]):
        raise HTTPException(422, "Subtopic must be 2-40 characters using lowercase letters, numbers, and hyphens.")
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
    key_changed = (
        merged["correct_index"] != question.correct_index
        or merged["correct_answers"] != question.correct_answers
    )
    await _assert_unique_prompt(db, merged["topic"], merged["prompt"], exclude_id=question.id)
    before = {key: getattr(question, key) for key in values}
    for key, value in values.items():
        setattr(question, key, merged.get(key, value))
    if key_changed:
        question.key_reviewed_at = datetime.now(timezone.utc)
        question.key_reviewed_by = user.id
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
    """Delete a skill question and record the administrator action."""
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


@router.get("/admin/questions/import/template")
async def download_question_import_template(
    user: admin_only,
    db: DbSession,
    format: str = "csv",
    topic_id: str | None = None,
) -> StreamingResponse:
    """Download an authenticated topic-specific question import file."""
    format_name = (format or "csv").strip().lower()
    topic_slug = topic_id.strip().lower() if topic_id else None
    questions: list[SkillQuestion] = []
    if topic_slug:
        if not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,99}", topic_slug):
            raise HTTPException(422, "Topic slug must use lowercase letters, numbers, '-' or '_'")
        if await db.get(SkillTopic, topic_slug) is None:
            raise HTTPException(404, "Skill topic not found")
        questions = list(await db.scalars(
            select(SkillQuestion)
            .where(SkillQuestion.topic == topic_slug)
            .order_by(SkillQuestion.id)
        ))
    if format_name == "xlsx":
        workbook = build_question_import_template_xlsx()
        if workbook is None:
            raise HTTPException(415, "XLSX template is unavailable because openpyxl is not installed")
        if topic_slug:
            from openpyxl import load_workbook

            spreadsheet = load_workbook(io.BytesIO(workbook))
            sheet = spreadsheet.active
            for row in sheet.iter_rows(min_row=2):
                row[0].value = topic_slug
            output = io.BytesIO()
            spreadsheet.save(output)
            workbook = output.getvalue()
        return StreamingResponse(
            iter([workbook]),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": 'attachment; filename="skill-question-template.xlsx"'},
        )
    csv_bytes = build_question_import_template_csv()
    if topic_slug:
        headers = [
            "topic", "prompt", "options", "correct_option", "explanation",
            "difficulty", "question_type", "subtopic", "source", "active",
        ]
        output = io.StringIO(newline="")
        writer = csv.writer(output, lineterminator="\n")
        writer.writerow(headers)
        rows = [
            [
                topic_slug,
                question.prompt,
                json.dumps(question.options, ensure_ascii=False),
                ",".join(
                    str(index + 1)
                    for index in sorted(set(question.correct_answers or [question.correct_index]))
                ),
                question.explanation,
                question.difficulty.lower(),
                question.question_type,
                question.subtopic,
                question.source,
                str(question.active).lower(),
            ]
            for question in questions
        ]
        if not rows:
            rows = [[
                topic_slug,
                "EXAMPLE - replace or remove before import",
                json.dumps(["Option A", "Option B"]),
                "1",
                "Replace this example explanation before importing.",
                "easy",
                "SINGLE",
                "general",
                "Template example - replace or remove before import",
                "false",
            ]]
        for row in rows:
            writer.writerow([
                "'" + str(cell) if str(cell).startswith(("=", "+", "-", "@")) else cell
                for cell in row
            ])
        csv_bytes = output.getvalue().encode("utf-8")
        filename = f"skill-{topic_slug}-template-{date.today().isoformat()}.csv"
    else:
        filename = "skill-question-template.csv"
    return StreamingResponse(
        iter([csv_bytes]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/admin/questions/import")
async def import_skill_questions(
    user: admin_only,
    db: DbSession,
    partial: bool = False,
    topic_id: str | None = None,
    file: UploadFile = File(...),
) -> dict[str, Any]:
    """Parse and validate a question-bank import before creating its skill questions."""
    if not file.filename:
        raise HTTPException(422, "A file is required for the import.")
    raw = await file.read()
    if len(raw) > MAX_IMPORT_FILE_SIZE:
        raise HTTPException(413, "Question import file exceeds the 2 MB limit")
    try:
        result = parse_question_import_file(file.filename, raw)
    except ValueError as error:
        message = str(error)
        status_code = 415 if "Supported formats" in message or "Unsupported file type" in message else 422
        raise HTTPException(status_code, message) from error
    if any(
        error["field"] == "correct_option"
        and "identify different options" in error["message"]
        for item in result["rows"]
        for error in item["errors"]
    ):
        raise HTTPException(422, "correct_option and correct_index identify different options")
    if topic_id:
        selected_topic = topic_id.strip().lower()
        if not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,99}", selected_topic):
            raise HTTPException(422, "Topic slug must use lowercase letters, numbers, '-' or '_'")
        for item in result["rows"]:
            item["data"]["topic"] = selected_topic

    if not result["rows"]:
        raise HTTPException(422, "The uploaded file contains no question rows")

    valid_questions: list[SkillQuestion] = []
    created_resources: list[SkillLearningResource] = []
    seen_prompts: set[tuple[str, str]] = set()

    for item in result["rows"]:
        row_number = item["row"]
        row = item["data"]
        if item["errors"]:
            result["errors"].extend({"row": row_number, "field": error["field"], "message": error["message"]} for error in item["errors"])
            continue

        try:
            model = SkillQuestionCreate(
                topic=row["topic"],
                subtopic=row.get("subtopic") or "fundamentals",
                prompt=row["prompt"],
                options=row["options"],
                correct_index=row.get("correct_index"),
                correct_answers=row.get("correct_answers"),
                explanation=row.get("explanation") or "",
                difficulty=row.get("difficulty") or "MEDIUM",
                question_type=row.get("question_type") or "SINGLE",
                source=row.get("source") or "Admin bulk import",
                resource_title=row.get("resource_title"),
                resource_url=row.get("resource_url"),
                resource_subtopic=row.get("resource_subtopic"),
                active=row.get("active", True),
            )
            _validate_question(model.options, model.correct_index, model.correct_answers, model.question_type)
            if model.correct_index is None:
                if not model.correct_answers:
                    raise HTTPException(422, "A valid correct answer is required")
                model.correct_index = model.correct_answers[0]
            key = (model.topic, model.prompt.casefold())
            if key in seen_prompts:
                result["skipped_duplicates"] += 1
                continue
            seen_prompts.add(key)
            existing_id = await db.scalar(
                select(SkillQuestion.id).where(
                    SkillQuestion.topic == model.topic,
                    func.lower(SkillQuestion.prompt) == model.prompt.casefold(),
                )
            )
            if existing_id is not None:
                result["skipped_duplicates"] += 1
                continue
            await _assert_unique_prompt(db, model.topic, model.prompt)
            values = model.model_dump(exclude={"correct_option_number", "correct_option_numbers"})
            values.pop("resource_title", None)
            values.pop("resource_url", None)
            values.pop("resource_subtopic", None)
            values["key_reviewed_at"] = datetime.now(timezone.utc)
            values["key_reviewed_by"] = user.id
            question = SkillQuestion(**values)
            valid_questions.append(question)
            if model.resource_title and model.resource_url:
                created_resources.append(SkillLearningResource(
                    topic=model.topic,
                    subtopic=(model.resource_subtopic or model.subtopic).strip().lower(),
                    title=model.resource_title.strip(),
                    url=_validated_resource_url(model.resource_url),
                    created_by_user_id=user.id,
                ))
        except (TypeError, ValueError, HTTPException) as error:
            result["errors"].append({
                "row": row_number,
                "field": "question",
                "message": error.detail if isinstance(error, HTTPException) else str(error),
            })

    if result["errors"] and not partial:
        result["imported"] = 0
        raise HTTPException(422, "One or more question rows are invalid. Review the row errors and try again.")

    if not valid_questions:
        result["imported"] = 0
        return result

    db.add_all(valid_questions)
    await db.flush()
    for resource in created_resources:
        existing = await db.scalar(
            select(SkillLearningResource.id).where(
                SkillLearningResource.topic == resource.topic,
                SkillLearningResource.subtopic == resource.subtopic,
                SkillLearningResource.url == resource.url,
            )
        )
        if existing is None:
            db.add(resource)
    await db.flush()
    audit_target = valid_questions[0].id if valid_questions else None
    await write_audit(
        db,
        user,
        "skill_questions_imported",
        "skill_question",
        audit_target,
        metadata={"count": len(valid_questions), "topics": sorted({question.topic for question in valid_questions})},
    )
    await db.commit()
    result["imported"] = len(valid_questions)
    return result


def _validated_resource_url(url: str) -> str:
    """Require a well-formed HTTP or HTTPS URL before saving a learning resource."""
    normalized = url.strip()
    parts = urlsplit(normalized)
    if parts.scheme not in {"http", "https"} or not parts.netloc:
        raise HTTPException(422, "Learning links must use an http or https URL")
    return normalized


def _learning_resource_dict(resource: SkillLearningResource) -> dict[str, Any]:
    """Serialize a skill learning resource for API responses."""
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
async def list_learning_resources(
    user: admin_only,
    db: DbSession,
    topic_id: str | None = None,
) -> list[dict[str, Any]]:
    """List active learning resources for the requested skill topic and subtopic."""
    query = select(SkillLearningResource).order_by(
        SkillLearningResource.topic,
        SkillLearningResource.subtopic,
        SkillLearningResource.id,
    )
    if topic_id:
        query = query.where(SkillLearningResource.topic == topic_id.strip().lower())
    resources = list(await db.scalars(query))
    return [_learning_resource_dict(resource) for resource in resources]


@router.post("/admin/resources", status_code=201)
async def create_learning_resource(
    data: SkillLearningResourceCreate,
    user: admin_only,
    db: DbSession,
) -> dict[str, Any]:
    """Create a learning resource after validating its URL and record the administrator action."""
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
    """Update an existing learning resource and record the administrator action."""
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
    """Delete a learning resource and record the administrator action."""
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
async def get_skill_assessment_stats(
    user: admin_only,
    db: DbSession,
    topic_id: str | None = None,
) -> list[dict[str, Any]]:
    """Aggregate assessment participation, scores, and skill results for the administrator statistics response."""
    selected_topic = topic_id.strip().lower() if topic_id else None
    question_query = select(SkillQuestion).order_by(SkillQuestion.topic, SkillQuestion.id)
    attempt_query = select(SkillAttempt)
    if selected_topic:
        question_query = question_query.where(SkillQuestion.topic == selected_topic)
        attempt_query = attempt_query.where(SkillAttempt.topic == selected_topic)
    questions = list(await db.scalars(question_query))
    attempts = list(await db.scalars(attempt_query))
    attempts_by_topic: dict[str, list[SkillAttempt]] = {}
    question_rates: dict[int, list[float]] = {}
    weakest_subtopics: dict[str, dict[str, list[float]]] = {}
    for attempt in attempts:
        attempts_by_topic.setdefault(attempt.topic, []).append(attempt)
        if attempt.status not in {"COMPLETED", "SUBMITTED"}:
            continue
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
    topic_metadata_query = select(SkillTopic)
    if selected_topic:
        topic_metadata_query = topic_metadata_query.where(SkillTopic.slug == selected_topic)
    topic_metadata = {
        topic.slug: topic
        for topic in await db.scalars(topic_metadata_query)
    }
    known_topics = {question.topic for question in questions} | set(topic_metadata) | {
        attempt.topic for attempt in attempts
    }
    topics = (
        [selected_topic] if selected_topic in known_topics
        else [] if selected_topic
        else sorted(known_topics)
    )
    stats = []
    for topic in topics:
        metadata = topic_metadata.get(topic)
        defaults = TOPIC_INFO.get(topic, {})
        topic_attempts = attempts_by_topic.get(topic, [])
        completed_attempts = [attempt for attempt in topic_attempts if attempt.status in {"COMPLETED", "SUBMITTED"}]
        status_counts = {
            "completed": len(completed_attempts),
            "expired": sum(attempt.status == "EXPIRED" for attempt in topic_attempts),
            "in_progress": sum(attempt.status == "IN_PROGRESS" for attempt in topic_attempts),
        }
        topic_questions = [question for question in questions if question.topic == topic]
        active_by_difficulty = {
            difficulty: sum(
                question.active and question.difficulty.upper() == difficulty
                for question in topic_questions
            )
            for difficulty in ASSESSMENT_MIX
        }
        pool_sizes = {
            difficulty: {
                "active": active_by_difficulty[difficulty],
                "inactive": sum(
                    not question.active and question.difficulty.upper() == difficulty
                    for question in topic_questions
                ),
            }
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
                if question_rates.get(question.id, [0, 0])[1] > 0
            ),
            key=lambda question: (
                question["correct_rate"] if question["correct_rate"] is not None else 101,
                -question["attempts"],
            ),
        )[:5]
        if len(completed_attempts) < 5:
            hardest = []
        stats.append({
            "topic": topic,
            "name": metadata.name if metadata else defaults.get("name", topic.replace("-", " ").replace("_", " ").title()),
            "description": metadata.description if metadata else defaults.get("description", "Show what you know and build a verified skill."),
            "icon": metadata.icon if metadata else defaults.get("icon", "✦"),
            "badge_title": metadata.badge_title if metadata else defaults.get("badge_title", f"Verified {topic.title()} Specialist"),
            "archived_at": metadata.archived_at.isoformat() if metadata and metadata.archived_at else None,
            "archived_by": metadata.archived_by if metadata else None,
            "attempts": len(topic_attempts),
            "attempt_status_counts": status_counts,
            "pass_rate": (
                round(100 * sum(bool(attempt.passed) for attempt in completed_attempts) / len(completed_attempts))
                if completed_attempts else 0
            ),
            "average_score": (
                round(sum(float(attempt.weighted_percentage or 0) for attempt in completed_attempts) / len(completed_attempts), 2)
                if completed_attempts else None
            ),
            "score_sample_size": len(completed_attempts),
            "analytics_ready": len(completed_attempts) >= 5,
            "active_questions": sum(question.active for question in topic_questions),
            "difficulty_pool_sizes": active_by_difficulty,
            "question_pool_sizes": pool_sizes,
            "bank_warnings": [
                f"Add {missing} active {difficulty.lower()} question(s) for the required 4/4/2 attempt mix."
                for difficulty, missing in missing_mix.items()
            ],
            "hardest_questions": hardest,
            "weakest_subtopics": [
                {
                    "subtopic": subtopic,
                    "average_percentage": round(sum(scores) / len(scores), 2),
                    "attempts": len(scores),
                }
                for subtopic, scores in (
                    sorted(
                        weakest_subtopics.get(topic, {}).items(),
                        key=lambda item: sum(item[1]) / len(item[1]),
                    )[:5]
                    if len(completed_attempts) >= 5 else []
                )
            ],
        })
    return stats


async def _topic_readiness(db: DbSession, topic: str) -> tuple[dict[str, int], list[str]]:
    counts = {
        difficulty: int(await db.scalar(
            select(func.count(SkillQuestion.id)).where(
                SkillQuestion.topic == topic,
                SkillQuestion.active.is_(True),
                SkillQuestion.difficulty == difficulty,
            )
        ) or 0)
        for difficulty in ASSESSMENT_MIX
    }
    warnings = [
        f"{difficulty.title()}: {counts[difficulty]}/{required} active questions (need {required - counts[difficulty]} more)"
        for difficulty, required in ASSESSMENT_MIX.items()
        if counts[difficulty] < required
    ]
    return counts, warnings


async def _topic_is_ready(db: DbSession, topic: str) -> bool:
    counts, warnings = await _topic_readiness(db, topic)
    return not warnings and all(counts[difficulty] >= required for difficulty, required in ASSESSMENT_MIX.items())


async def _topic_history_events(db: DbSession, topic: str) -> list[dict[str, Any]]:
    rows = list(await db.scalars(
        select(AuditLog)
        .where(AuditLog.action.in_({
            "skill_topic_created",
            "skill_topic_updated",
            "skill_topic_activated",
            "skill_topic_deactivated",
            "skill_topic_archived",
            "skill_topic_restored",
            "skill_topic_deleted",
            "skill_questions_imported",
            "skill_question_created",
            "skill_question_updated",
            "skill_question_deleted",
            "skill_learning_resource_created",
            "skill_learning_resource_updated",
            "skill_learning_resource_deleted",
        }))
        .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
    ))
    events: list[dict[str, Any]] = []
    for row in rows:
        metadata = row.metadata_ or {}
        if metadata.get("topic") != topic and row.target_type != "skill_topic":
            continue
        label = {
            "skill_topic_created": "Created",
            "skill_topic_updated": "Edited",
            "skill_topic_activated": "Activated",
            "skill_topic_deactivated": "Deactivated",
            "skill_topic_archived": "Archived",
            "skill_topic_restored": "Restored",
            "skill_topic_deleted": "Deleted",
            "skill_questions_imported": "Questions imported",
            "skill_question_created": "Question created",
            "skill_question_updated": "Question updated",
            "skill_question_deleted": "Question deleted",
            "skill_learning_resource_created": "Resource created",
            "skill_learning_resource_updated": "Resource updated",
            "skill_learning_resource_deleted": "Resource deleted",
        }.get(row.action, row.action.replace("_", " ").title())
        events.append({
            "id": row.id,
            "action": row.action,
            "label": label,
            "admin_email": row.actor_email,
            "created_at": row.created_at.isoformat(),
            "details": metadata,
        })
    return events


async def _topic_for_update(db: DbSession, topic: str) -> SkillTopic:
    metadata = await db.scalar(select(SkillTopic).where(SkillTopic.slug == topic).with_for_update())
    if metadata is None:
        raise HTTPException(404, "Skill topic not found")
    return metadata


async def _topic_impact_counts(db: DbSession, topic: str) -> dict[str, int]:
    now = datetime.now(timezone.utc)
    attempt_rows = list(await db.scalars(select(SkillAttempt).where(SkillAttempt.topic == topic)))
    attempts = {
        "completed_attempts": sum(attempt.status in {"COMPLETED", "SUBMITTED"} for attempt in attempt_rows),
        "expired_attempts": sum(
            attempt.status == "EXPIRED"
            or (attempt.status == "IN_PROGRESS" and _utc(attempt.expires_at) <= now)
            for attempt in attempt_rows
        ),
        "in_progress_attempts": sum(
            attempt.status == "IN_PROGRESS" and _utc(attempt.expires_at) > now
            for attempt in attempt_rows
        ),
    }
    badges = list(await db.scalars(select(SkillBadge).where(SkillBadge.topic == topic)))
    return {
        **attempts,
        "total_attempts": len(attempt_rows),
        "total_badges": len(badges),
        "active_badges": sum(_utc(badge.expires_at) > now for badge in badges),
        "expiring_badges": sum(now < _utc(badge.expires_at) <= now + timedelta(days=30) for badge in badges),
        "questions": int(await db.scalar(
            select(func.count(SkillQuestion.id)).where(SkillQuestion.topic == topic)
        ) or 0),
        "resources": int(await db.scalar(
            select(func.count(SkillLearningResource.id)).where(SkillLearningResource.topic == topic)
        ) or 0),
    }


@router.get("/admin/topics")
async def list_admin_skill_topics(
    user: admin_only,
    db: DbSession,
    topic_id: str | None = None,
    include_archived: bool = False,
) -> list[dict[str, Any]]:
    """Return persisted topic metadata with question-pool and attempt analytics."""
    stats = await get_skill_assessment_stats(user, db, topic_id)
    if not include_archived:
        stats = [item for item in stats if item.get("archived_at") is None]
    return stats


@router.get("/admin/skill-topics")
async def list_admin_skill_topics_lifecycle(
    user: admin_only,
    db: DbSession,
    include_archived: bool = False,
) -> list[dict[str, Any]]:
    """Alias for topic management clients, including an optional archived view."""
    return await list_admin_skill_topics(user, db, include_archived=include_archived)


@router.get("/admin/skill-topics/{topic}/subtopics")
async def list_admin_skill_topic_subtopics(
    topic: str,
    user: admin_only,
    db: DbSession,
) -> list[dict[str, Any]]:
    """Return unique question subtopics for an existing skill topic."""
    slug = topic.strip().lower()
    if await db.get(SkillTopic, slug) is None:
        raise HTTPException(404, "Skill topic not found")
    rows = (await db.execute(
        select(SkillQuestion.subtopic, func.count(SkillQuestion.id))
        .where(SkillQuestion.topic == slug)
        .group_by(SkillQuestion.subtopic)
        .order_by(SkillQuestion.subtopic)
    )).all()
    return [{"id": subtopic, "question_count": int(count)} for subtopic, count in rows]


@router.get("/admin/skill-topics/{topic}/impact")
async def get_admin_skill_topic_impact(
    topic: str,
    user: admin_only,
    db: DbSession,
) -> dict[str, int]:
    slug = topic.strip().lower()
    if await db.get(SkillTopic, slug) is None:
        raise HTTPException(404, "Skill topic not found")
    return await _topic_impact_counts(db, slug)


@router.post("/admin/skill-topics", status_code=201)
async def create_admin_skill_topic(
    data: SkillTopicCreate,
    user: admin_only,
    db: DbSession,
) -> dict[str, Any]:
    """Create a skill topic with a unique URL-safe slug."""
    if await db.get(SkillTopic, data.topic) is not None:
        raise HTTPException(409, "A skill topic with this ID already exists")
    metadata = SkillTopic(
        slug=data.topic,
        name=data.name,
        description=data.description,
        icon=data.icon,
        badge_title=data.badge_title or f"Verified {data.name} Specialist",
    )
    db.add(metadata)
    await write_audit(
        db, user, "skill_topic_created", "skill_topic", metadata.slug,
        metadata={"topic": data.topic, "topic_key": metadata.slug, "topic_name": metadata.name},
    )
    await db.commit()
    return {"topic": metadata.slug, "name": metadata.name}


@router.patch("/admin/topics/{topic}")
async def update_admin_skill_topic(
    topic: str,
    data: SkillTopicUpdate,
    user: admin_only,
    db: DbSession,
) -> dict[str, Any]:
    """Update an existing topic's display metadata."""
    slug = topic.strip().lower()
    if not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,99}", slug):
        raise HTTPException(422, "Topic slug must use lowercase letters, numbers, '-' or '_'")
    metadata = await _topic_for_update(db, slug)
    if metadata.archived_at is not None:
        raise HTTPException(409, "Restore this archived topic before editing it")
    changes = data.model_dump(exclude_unset=True)
    for field, value in changes.items():
        setattr(metadata, field, value)
    await db.flush()
    await write_audit(
        db,
        user,
        "skill_topic_updated",
        "skill_topic",
        metadata.slug,
        metadata={
            "topic": slug,
            "topic_key": slug,
            "topic_name": metadata.name,
            "fields": sorted(changes),
        },
    )
    await db.commit()
    await db.refresh(metadata)
    return {
        "topic": metadata.slug,
        "name": metadata.name,
        "description": metadata.description,
        "icon": metadata.icon,
        "badge_title": metadata.badge_title,
        "archived_at": metadata.archived_at.isoformat() if metadata.archived_at else None,
        "updated_at": metadata.updated_at,
    }


@router.post("/admin/skill-topics/{topic}/archive")
async def archive_admin_skill_topic(
    topic: str,
    user: admin_only,
    db: DbSession,
) -> dict[str, Any]:
    slug = topic.strip().lower()
    metadata = await _topic_for_update(db, slug)
    if metadata.archived_at is not None:
        return {"topic": slug, "archived": True, **await _topic_impact_counts(db, slug)}
    impacts = await _topic_impact_counts(db, slug)
    metadata.archived_at = datetime.now(timezone.utc)
    metadata.archived_by = user.id
    await write_audit(
        db, user, "skill_topic_archived", "skill_topic", slug,
        metadata={
            "topic": slug,
            "topic_key": slug,
            "topic_name": metadata.name,
            **impacts,
        },
    )
    await db.commit()
    return {"topic": slug, "archived": True, **impacts}


@router.post("/admin/skill-topics/{topic}/restore")
async def restore_admin_skill_topic(
    topic: str,
    user: admin_only,
    db: DbSession,
) -> dict[str, Any]:
    slug = topic.strip().lower()
    metadata = await _topic_for_update(db, slug)
    if metadata.archived_at is None:
        return {"topic": slug, "archived": False}
    metadata.archived_at = None
    metadata.archived_by = None
    await write_audit(
        db, user, "skill_topic_restored", "skill_topic", slug,
        metadata={"topic": slug, "topic_key": slug, "topic_name": metadata.name},
    )
    await db.commit()
    return {"topic": slug, "archived": False}


@router.get("/admin/skill-topics/{topic}/history")
async def get_admin_skill_topic_history(
    topic: str,
    user: admin_only,
    db: DbSession,
) -> dict[str, Any]:
    slug = topic.strip().lower()
    if await db.get(SkillTopic, slug) is None:
        raise HTTPException(404, "Skill topic not found")
    return {"topic": slug, "events": await _topic_history_events(db, slug)}


@router.delete("/admin/skill-topics/{topic}")
async def delete_admin_skill_topic(
    topic: str,
    user: admin_only,
    db: DbSession,
) -> dict[str, Any]:
    slug = topic.strip().lower()
    metadata = await _topic_for_update(db, slug)
    impacts = await _topic_impact_counts(db, slug)
    if metadata.archived_at is None:
        if impacts["in_progress_attempts"] or impacts["total_attempts"] or impacts["total_badges"] or impacts["questions"] or impacts["resources"]:
            raise HTTPException(409, {
                "message": "Archive this topic before deleting it permanently.",
                "archived": False,
                **impacts,
            })
    if impacts["in_progress_attempts"]:
        raise HTTPException(409, {
            "message": "This topic has non-expired attempts in progress and cannot be deleted.",
            **impacts,
        })
    if impacts["total_attempts"] or impacts["total_badges"]:
        raise HTTPException(409, {
            "message": "This topic has historical attempts or badges. Archive it instead to preserve history.",
            **impacts,
        })
    for question in await db.scalars(select(SkillQuestion).where(SkillQuestion.topic == slug)):
        await db.delete(question)
    for resource in await db.scalars(select(SkillLearningResource).where(SkillLearningResource.topic == slug)):
        await db.delete(resource)
    await write_audit(
        db, user, "skill_topic_deleted", "skill_topic", slug,
        metadata={
            "topic": slug,
            "topic_key": slug,
            "topic_name": metadata.name,
            **impacts,
        },
    )
    await db.delete(metadata)
    await db.commit()
    return {"topic": slug, "deleted": True, **impacts}


@router.get("/admin/topics/{topic}")
async def get_admin_skill_topic(
    topic: str,
    user: admin_only,
    db: DbSession,
    topic_id: str | None = None,
) -> dict[str, Any]:
    """Return one topic's analytics without exposing question answer keys."""
    slug = topic.strip().lower()
    if topic_id and topic_id.strip().lower() != slug:
        raise HTTPException(404, "Skill topic not found")
    topic_stats = next(
        (item for item in await get_skill_assessment_stats(user, db, slug) if item["topic"] == slug),
        None,
    )
    if topic_stats is None:
        raise HTTPException(404, "Skill topic not found")
    return topic_stats


@router.get("/admin/topics/{topic}/attempts")
async def list_admin_skill_topic_attempts(
    topic: str,
    user: admin_only,
    db: DbSession,
    topic_id: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100),
    status: str | None = None,
) -> dict[str, Any]:
    """Return a paginated, answer-key-free attempt history for a topic."""
    slug = topic.strip().lower()
    if topic_id and topic_id.strip().lower() != slug:
        raise HTTPException(404, "Skill topic not found")
    normalized_status = status.strip().upper() if status else None
    status_aliases = {"COMPLETED": {"COMPLETED", "SUBMITTED"}}
    if normalized_status and normalized_status not in {"COMPLETED", "EXPIRED", "IN_PROGRESS"}:
        raise HTTPException(422, "Status must be COMPLETED, EXPIRED, or IN_PROGRESS")
    query = select(SkillAttempt, User.email).join(User, User.id == SkillAttempt.student_id).where(
        SkillAttempt.topic == slug
    )
    filtered_query = select(SkillAttempt).where(SkillAttempt.topic == slug)
    if normalized_status:
        statuses = status_aliases.get(normalized_status, {normalized_status})
        query = query.where(SkillAttempt.status.in_(statuses))
        filtered_query = filtered_query.where(SkillAttempt.status.in_(statuses))
    total = int(await db.scalar(select(func.count(SkillAttempt.id)).where(SkillAttempt.topic == slug)) or 0)
    filtered_total = int(await db.scalar(select(func.count()).select_from(filtered_query.subquery())) or 0)
    rows = (await db.execute(
        query.order_by(SkillAttempt.started_at.desc(), SkillAttempt.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )).all()
    return {
        "items": [
            {
                "id": attempt.id,
                "student_id": attempt.student_id,
                "student_email": email,
                "topic": attempt.topic,
                "status": attempt.status,
                "score": None if attempt.status == "EXPIRED" else attempt.weighted_percentage,
                "passed": attempt.passed,
                "started_at": attempt.started_at,
                "submitted_at": attempt.submitted_at,
            }
            for attempt, email in rows
        ],
        "total": total,
        "filtered_total": filtered_total,
        "page": page,
        "page_size": page_size,
    }


@router.get("/admin/attempts/{attempt_id}")
async def get_admin_skill_attempt(
    attempt_id: int,
    user: admin_only,
    db: DbSession,
    topic_id: str | None = None,
) -> dict[str, Any]:
    """Return safe attempt analytics for an administrator's attempt drill-down."""
    attempt = await db.get(SkillAttempt, attempt_id)
    if attempt is None:
        raise HTTPException(404, "Assessment attempt not found")
    if topic_id and attempt.topic != topic_id.strip().lower():
        raise HTTPException(404, "Assessment attempt not found for this topic")
    student = await db.get(User, attempt.student_id)
    return {
        "id": attempt.id,
        "student_id": attempt.student_id,
        "student_email": student.email if student else None,
        "topic": attempt.topic,
        "status": attempt.status,
        "score": None if attempt.status == "EXPIRED" else attempt.weighted_percentage,
        "passed": None if attempt.status == "EXPIRED" else attempt.passed,
        "level": attempt.level,
        "percentile": attempt.percentile,
        "subtopic_scores": attempt.subtopic_scores or {},
        "started_at": attempt.started_at,
        "submitted_at": attempt.submitted_at,
    }
