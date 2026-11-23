"""Validated administrative payloads for Interview Studio content management."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


InterviewCategory = Literal["HR", "TECHNICAL"]
InterviewDifficulty = Literal["INTERMEDIATE"]
MockTestFormat = Literal["QUICK_PRACTICE", "STANDARD", "FULL", "TOPIC_WISE"]
MockTestMode = Literal["PRACTICE", "ASSESSMENT"]


class QuestionFields(BaseModel):
    category: InterviewCategory
    difficulty: str | None = None
    prompt: str = Field(min_length=8, max_length=3000)
    hint: str = Field(min_length=3, max_length=1500)
    rubric: str = Field(min_length=5, max_length=2500)


class QuestionCreate(QuestionFields):
    seed_key: str = Field(min_length=3, max_length=100, pattern=r"^[a-zA-Z0-9._-]+$")


class QuestionUpdate(BaseModel):
    category: InterviewCategory | None = None
    difficulty: str | None = None
    prompt: str | None = Field(default=None, min_length=8, max_length=3000)
    hint: str | None = Field(default=None, min_length=3, max_length=1500)
    rubric: str | None = Field(default=None, min_length=5, max_length=2500)
    active: bool | None = None


class QuestionAssignment(BaseModel):
    question_id: int = Field(gt=0)
    skill_tags: list[str] = Field(default_factory=list, max_length=20)


class MockTestFields(BaseModel):
    slug: str = Field(min_length=3, max_length=100, pattern=r"^[a-z0-9-]+$")
    title: str = Field(min_length=3, max_length=160)
    description: str = Field(min_length=5, max_length=3000)
    category_id: int = Field(gt=0)
    difficulty: str | None = None
    format: MockTestFormat
    default_mode: MockTestMode
    question_count: int = Field(ge=1, le=20)
    time_limit_seconds: int = Field(ge=60, le=7200)
    company_style: bool = False
    active: bool = True
    questions: list[QuestionAssignment] = Field(min_length=1, max_length=20)

    @model_validator(mode="after")
    def validate_question_count(self) -> "MockTestFields":
        if self.question_count not in {5, 10, 15, 20}:
            raise ValueError("question_count must be 5, 10, 15, or 20")
        if self.question_count != len(self.questions):
            raise ValueError("question_count must match assigned questions")
        if len({item.question_id for item in self.questions}) != len(self.questions):
            raise ValueError("question assignments must be unique")
        expected = {
            "QUICK_PRACTICE": {5},
            "STANDARD": {10},
            "FULL": {15, 20},
        }.get(self.format)
        if expected is not None and self.question_count not in expected:
            raise ValueError("question count does not match test format")
        return self


class MockTestCreate(MockTestFields):
    pass


class MockTestUpdate(MockTestFields):
    pass


class LabelUpdate(BaseModel):
    label: str = Field(min_length=2, max_length=40)
    active: bool


class CategoryCreate(BaseModel):
    slug: str = Field(min_length=2, max_length=50, pattern=r"^[a-z0-9-]+$")
    label: str = Field(min_length=2, max_length=100)


class InterviewStudioSettingsUpdate(BaseModel):
    voice_enabled: bool | None = None
    video_enabled: bool | None = None
    recording_enabled: bool | None = None
    retention_days: int | None = Field(default=None, ge=1, le=365)
    sessions_per_day: int | None = Field(default=None, ge=1, le=50)

    model_config = ConfigDict(extra="forbid")

    @model_validator(mode="after")
    def require_setting(self) -> "InterviewStudioSettingsUpdate":
        if not self.model_fields_set:
            raise ValueError("at least one setting is required")
        return self
