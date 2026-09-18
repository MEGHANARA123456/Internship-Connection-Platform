from datetime import datetime
from typing import Literal

from pydantic import BaseModel

ApplicationStatus = Literal["APPLIED", "UNDER_REVIEW", "SHORTLISTED", "INTERVIEW_SCHEDULED", "SELECTED", "REJECTED", "WITHDRAWN"]


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