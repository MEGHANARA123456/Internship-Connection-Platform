# -----------------------------------------------------------------------------
# Pydantic models for application request and response structures.
# -----------------------------------------------------------------------------

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

ApplicationStatus = Literal["APPLIED", "UNDER_REVIEW", "SHORTLISTED", "INTERVIEW_SCHEDULED", "SELECTED", "ACCEPTED", "REJECTED", "WITHDRAWN"]


class OfferAcceptance(BaseModel):
    signature_name: str = Field(min_length=1, max_length=200)
    signature_mode: Literal["draw", "type"]

    @field_validator("signature_name")
    @classmethod
    def validate_signature_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Signature name cannot be blank")
        return value


class ApplicationCreate(BaseModel):
    cover_note: str | None = None


class ApplicationStatusUpdate(BaseModel):
    status: ApplicationStatus


class BulkApplicationStatusUpdate(BaseModel):
    application_ids: list[int]
    status: ApplicationStatus


class BulkApplicationStatusResponse(BaseModel):
    updated_count: int
    success_ids: list[int]
    failed_ids: list[int]



class ApplicationResponse(BaseModel):
    id: int
    internship_id: int
    student_id: int
    status: ApplicationStatus
    cover_note: str | None
    offer_signed_name: str | None = None
    offer_signature_mode: str | None = None
    offer_accepted_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
    student_name: str | None = None
    student_university: str | None = None
    student_skills: list[str] = []
    resume_id: int | None = None
    internship_title: str | None = None
    company_name: str | None = None
    company_id: int | None = None


class ApplicationDashboard(BaseModel):
    counts: dict[str, int]
    applications: list[ApplicationResponse]