"""Student and admin schemas for the learning library."""

from typing import Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, Field, field_validator, model_validator


ResourceType = Literal["link", "video", "pdf", "notes", "course"]
ResourceLevel = Literal["ALL", "BEGINNER", "INTERMEDIATE", "ADVANCED"]

LEARNING_ROLE_TAGS = {
    "data-scientist",
    "data-analyst",
    "python-developer",
    "java-developer",
    "frontend-developer",
    "ml-engineer",
    "hr-interview",
    "video-interview",
}


def validate_https_url(value: str) -> str:
    value = value.strip()
    parsed = urlsplit(value)
    if (
        len(value) > 1000
        or parsed.scheme.casefold() != "https"
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or any(ord(char) < 32 for char in value)
    ):
        raise ValueError("URL must be a valid HTTPS URL without embedded credentials")
    return value


class LearningCategoryCreate(BaseModel):
    slug: str = Field(min_length=2, max_length=80, pattern=r"^[a-z0-9-]+$")
    title: str = Field(min_length=2, max_length=120)
    description: str = Field(default="", max_length=1000)
    active: bool = True


class LearningCategoryUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=2, max_length=120)
    description: str | None = Field(default=None, max_length=1000)
    active: bool | None = None


class LearningResourceCreate(BaseModel):
    slug: str = Field(min_length=2, max_length=100, pattern=r"^[a-z0-9-]+$")
    category_id: int = Field(gt=0)
    title: str = Field(min_length=2, max_length=180)
    description: str = Field(min_length=5, max_length=5000)
    url: str = Field(min_length=10, max_length=1000)
    resource_type: ResourceType
    level: ResourceLevel = "ALL"
    role_tags: list[str] = Field(default_factory=list, max_length=20)
    topic_tags: list[str] = Field(default_factory=list, max_length=30)
    active: bool = True

    @field_validator("url")
    @classmethod
    def https_only(cls, value: str) -> str:
        return validate_https_url(value)

    @field_validator("role_tags")
    @classmethod
    def valid_roles(cls, values: list[str]) -> list[str]:
        normalized = sorted({value.strip().lower() for value in values if value.strip()})
        if not set(normalized).issubset(LEARNING_ROLE_TAGS):
            raise ValueError("Unknown learning role tag")
        return normalized

    @field_validator("topic_tags")
    @classmethod
    def normalized_topics(cls, values: list[str]) -> list[str]:
        normalized = sorted({value.strip().lower().replace(" ", "-") for value in values if value.strip()})
        if any(len(value) > 60 for value in normalized):
            raise ValueError("Topic tags must be at most 60 characters")
        return normalized


class LearningResourceUpdate(BaseModel):
    category_id: int | None = Field(default=None, gt=0)
    title: str | None = Field(default=None, min_length=2, max_length=180)
    description: str | None = Field(default=None, min_length=5, max_length=5000)
    url: str | None = Field(default=None, min_length=10, max_length=1000)
    resource_type: ResourceType | None = None
    level: ResourceLevel | None = None
    role_tags: list[str] | None = Field(default=None, max_length=20)
    topic_tags: list[str] | None = Field(default=None, max_length=30)
    active: bool | None = None

    @field_validator("url")
    @classmethod
    def https_only(cls, value: str | None) -> str | None:
        return validate_https_url(value) if value is not None else None

    @field_validator("role_tags")
    @classmethod
    def valid_roles(cls, values: list[str] | None) -> list[str] | None:
        if values is None:
            return None
        normalized = sorted({value.strip().lower() for value in values if value.strip()})
        if not set(normalized).issubset(LEARNING_ROLE_TAGS):
            raise ValueError("Unknown learning role tag")
        return normalized

    @field_validator("topic_tags")
    @classmethod
    def normalized_topics(cls, values: list[str] | None) -> list[str] | None:
        if values is None:
            return None
        normalized = sorted({value.strip().lower().replace(" ", "-") for value in values if value.strip()})
        if any(len(value) > 60 for value in normalized):
            raise ValueError("Topic tags must be at most 60 characters")
        return normalized


class LearningPathResourceAssignment(BaseModel):
    resource_id: int = Field(gt=0)


class LearningPathCreate(BaseModel):
    slug: str = Field(min_length=2, max_length=100, pattern=r"^[a-z0-9-]+$")
    category_id: int = Field(gt=0)
    title: str = Field(min_length=2, max_length=180)
    description: str = Field(min_length=5, max_length=5000)
    role_tags: list[str] = Field(default_factory=list, max_length=20)
    topic_tags: list[str] = Field(default_factory=list, max_length=30)
    active: bool = True
    resources: list[LearningPathResourceAssignment] = Field(min_length=1, max_length=100)

    @model_validator(mode="after")
    def validate_path_assignments(self) -> "LearningPathCreate":
        ids = [item.resource_id for item in self.resources]
        if len(set(ids)) != len(ids):
            raise ValueError("Path resources must be unique")
        if not set(self.role_tags).issubset(LEARNING_ROLE_TAGS):
            raise ValueError("Unknown learning role tag")
        return self


class LearningPathUpdate(LearningPathCreate):
    pass


class StudentLearningPreferenceUpdate(BaseModel):
    target_role: str | None

    @field_validator("target_role")
    @classmethod
    def valid_target_role(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip().lower()
        if normalized not in LEARNING_ROLE_TAGS:
            raise ValueError("Select a supported learning target")
        return normalized


class ResourceProgressUpdate(BaseModel):
    status: Literal["VIEWED", "COMPLETED"]

