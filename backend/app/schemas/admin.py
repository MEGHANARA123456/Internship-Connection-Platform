from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class UserAdminResponse(BaseModel):
    id: int
    email: str
    role: str
    is_active: bool
    is_verified: bool
    mfa_enabled: bool = False
    suspended_at: datetime | None


class ModerationStatus(BaseModel):
    status: Literal["PUBLISHED", "VERIFIED", "REJECTED", "CLOSED"]


class ReportCreate(BaseModel):
    reported_user_id: int | None = None
    internship_id: int | None = None
    reason: str = Field(min_length=5, max_length=5000)


class ReportUpdate(BaseModel):
    status: Literal["OPEN", "INVESTIGATING", "RESOLVED"]
    resolution_notes: str | None = None


class ReportResponse(BaseModel):
    id: int
    reporter_id: int
    reported_user_id: int | None
    internship_id: int | None
    reason: str
    status: str
    resolution_notes: str | None
    created_at: datetime
    updated_at: datetime