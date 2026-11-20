# -----------------------------------------------------------------------------
# Pydantic models for profile-related data validation.
# -----------------------------------------------------------------------------

from datetime import datetime
import re

from pydantic import BaseModel, Field, field_validator


class StudentProfileUpdate(BaseModel):
    full_name: str = Field(min_length=2, max_length=255)
    university: str = Field(min_length=2, max_length=255)
    major: str = Field(min_length=2, max_length=255)
    graduation_year: int = Field(ge=2000, le=2100)
    bio: str | None = None
    skills: str | None = None
    avatar_url: str | None = None


class StudentHandlesUpdate(BaseModel):
    github_username: str | None
    leetcode_username: str | None

    @field_validator("github_username", mode="before")
    @classmethod
    def validate_github_username(cls, value: object) -> object:
        if value is None:
            return None
        if not isinstance(value, str):
            return value
        username = value.strip().removeprefix("@").strip()
        if not username:
            return None
        if len(username) > 39 or not re.fullmatch(r"[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*", username):
            raise ValueError("Enter a valid GitHub username")
        return username

    @field_validator("leetcode_username", mode="before")
    @classmethod
    def validate_leetcode_username(cls, value: object) -> object:
        if value is None:
            return None
        if not isinstance(value, str):
            return value
        username = value.strip().removeprefix("@").strip()
        if not username:
            return None
        if len(username) > 50 or not re.fullmatch(r"[A-Za-z0-9_-]+", username):
            raise ValueError("Enter a valid LeetCode username")
        return username


class CompanyProfileUpdate(BaseModel):
    company_name: str = Field(min_length=2, max_length=255)
    industry: str = Field(min_length=2, max_length=255)
    website: str | None = None
    description: str | None = None
    avatar_url: str | None = None
    company_size: str | None = Field(default=None, max_length=40)
    location: str | None = Field(default=None, max_length=255)
    recruiter_contact_name: str | None = Field(default=None, max_length=255)
    recruiter_contact_phone: str | None = Field(default=None, max_length=40)
    recruiter_contact_email: str | None = Field(default=None, max_length=255)

class ProfileResponse(BaseModel):
    id: int
    user_id: int
    full_name: str | None = None
    university: str | None = None
    major: str | None = None
    graduation_year: int | None = None
    bio: str | None = None
    skills: str | None = None
    github_username: str | None = None
    leetcode_username: str | None = None
    company_name: str | None = None
    industry: str | None = None
    website: str | None = None
    description: str | None = None
    verification_status: str | None = None
    verification_note: str | None = None
    avatar_url: str | None = None
    company_size: str | None = None
    location: str | None = None
    recruiter_contact_name: str | None = None
    recruiter_contact_phone: str | None = None
    recruiter_contact_email: str | None = None

class ResumeResponse(BaseModel):
    id: int
    original_filename: str
    content_type: str
    file_size: int
    uploaded_at: datetime | None = None