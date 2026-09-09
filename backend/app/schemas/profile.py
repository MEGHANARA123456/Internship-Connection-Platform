from pydantic import BaseModel, Field


class StudentProfileUpdate(BaseModel):
    full_name: str = Field(min_length=2, max_length=255)
    university: str = Field(min_length=2, max_length=255)
    major: str = Field(min_length=2, max_length=255)
    graduation_year: int = Field(ge=2000, le=2100)
    bio: str | None = None
    skills: str | None = None
    avatar_url: str | None = None


class CompanyProfileUpdate(BaseModel):
    company_name: str = Field(min_length=2, max_length=255)
    industry: str = Field(min_length=2, max_length=255)
    website: str | None = None
    description: str | None = None
    verification_status: str = Field(default="PENDING", pattern="^(PENDING|VERIFIED|REJECTED)$")
    avatar_url: str | None = None


class ProfileResponse(BaseModel):
    id: int
    user_id: int
    full_name: str | None = None
    university: str | None = None
    major: str | None = None
    graduation_year: int | None = None
    bio: str | None = None
    skills: str | None = None
    company_name: str | None = None
    industry: str | None = None
    website: str | None = None
    description: str | None = None
    verification_status: str | None = None
    avatar_url: str | None = None


class ResumeResponse(BaseModel):
    id: int
    original_filename: str
    content_type: str
    file_size: int