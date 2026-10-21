# -----------------------------------------------------------------------------
# Pydantic models for internship payloads and filters.
# -----------------------------------------------------------------------------

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

Status = Literal["DRAFT", "PENDING_APPROVAL", "PUBLISHED", "CLOSED", "REJECTED"]


class InternshipInput(BaseModel):
    title: str = Field(min_length=2, max_length=255)
    description: str = Field(min_length=10)
    location: str = Field(min_length=2, max_length=255)
    industry: str = Field(min_length=2, max_length=255)
    duration_months: int = Field(ge=1, le=36)
    stipend: int | None = Field(default=None, ge=0)
    work_mode: Literal["REMOTE", "HYBRID", "ONSITE"]
    skills: list[str] = Field(default_factory=list, max_length=30)
    deadline: date


class InternshipCloseRequest(BaseModel):
    reject_pending: bool = False
    note: str | None = Field(default=None, max_length=300)


class InternshipResponse(InternshipInput):
    id: int
    company_id: int
    status: Status
    created_at: datetime
    closed_at: datetime | None = None
    company_name: str | None = None
    is_saved: bool | None = None
    match_score: int | None = None
    matched_skills: list[str] | None = None
    applicant_count: int | None = None



class InternshipPage(BaseModel):
    items: list[InternshipResponse]
    page: int
    page_size: int
    total: int