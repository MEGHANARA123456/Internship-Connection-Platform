from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class SkillGapRunRequest(BaseModel):
    target_role: str | None = Field(default=None, min_length=2, max_length=80)
    internship_id: int | None = Field(default=None, gt=0)

    @model_validator(mode="after")
    def validate_target(self) -> "SkillGapRunRequest":
        if (self.target_role is None) == (self.internship_id is None):
            raise ValueError("provide exactly one of target_role or internship_id")
        return self


class SkillCreate(BaseModel):
    canonical_name: str = Field(min_length=2, max_length=100)
    aliases: list[str] = Field(default_factory=list, max_length=30)

    model_config = ConfigDict(extra="forbid")


class SkillUpdate(BaseModel):
    canonical_name: str | None = Field(default=None, min_length=2, max_length=100)
    aliases: list[str] | None = Field(default=None, max_length=30)

    model_config = ConfigDict(extra="forbid")

    @model_validator(mode="after")
    def require_update(self) -> "SkillUpdate":
        if not self.model_fields_set:
            raise ValueError("at least one field is required")
        return self


class RoleSkillItem(BaseModel):
    skill_id: int = Field(gt=0)
    requirement_type: Literal["required", "preferred"]


class RoleSkillMapUpdate(BaseModel):
    role_label: str = Field(min_length=2, max_length=120)
    requirements: list[RoleSkillItem] = Field(min_length=1, max_length=100)

    model_config = ConfigDict(extra="forbid")

    @model_validator(mode="after")
    def unique_skills(self) -> "RoleSkillMapUpdate":
        ids = [item.skill_id for item in self.requirements]
        if len(set(ids)) != len(ids):
            raise ValueError("each skill may appear only once")
        return self
