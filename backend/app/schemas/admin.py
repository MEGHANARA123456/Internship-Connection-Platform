from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


# ── Basic User ────────────────────────────────────────────────────────────────

class UserAdminResponse(BaseModel):
    id: int
    email: str
    role: str
    is_active: bool
    is_verified: bool
    mfa_enabled: bool = False
    suspended_at: datetime | None

    model_config = {"from_attributes": True}


class ModerationStatus(BaseModel):
    status: Literal["PUBLISHED", "VERIFIED", "REJECTED", "CLOSED"]
    reason: str | None = None


# ── Reports ───────────────────────────────────────────────────────────────────

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

    model_config = {"from_attributes": True}


# ── Audit Log ─────────────────────────────────────────────────────────────────

class AuditLogResponse(BaseModel):
    id: int
    actor_id: int | None
    actor_email: str | None
    action: str
    target_type: str | None
    target_id: int | None
    metadata: dict[str, Any] | None = Field(None, alias="metadata_", serialization_alias="metadata")
    ip_address: str | None
    created_at: datetime

    model_config = {"populate_by_name": True, "from_attributes": True}


class PaginatedAuditLogs(BaseModel):
    items: list[AuditLogResponse]
    total: int
    page: int
    page_size: int


# ── User drill-down ───────────────────────────────────────────────────────────

class ApplicationBrief(BaseModel):
    id: int
    status: str
    internship_title: str
    company_name: str
    created_at: datetime


class StudentProfileBrief(BaseModel):
    full_name: str
    university: str
    major: str
    graduation_year: int


class CompanyProfileBrief(BaseModel):
    company_name: str
    industry: str
    verification_status: str
    posting_count: int


class UserDetailResponse(UserAdminResponse):
    student_profile: StudentProfileBrief | None = None
    company_profile: CompanyProfileBrief | None = None
    applications: list[ApplicationBrief] | None = None
    recent_audit_events: list[AuditLogResponse] | None = None


# ── Company listing ───────────────────────────────────────────────────────────

class CompanyListItem(BaseModel):
    id: int
    user_id: int
    company_name: str
    industry: str
    website: str | None
    verification_status: str
    posting_count: int


# ── Company posting ───────────────────────────────────────────────────────────

class CompanyPostingItem(BaseModel):
    id: int
    title: str
    status: str
    applicant_count: int
    created_at: datetime


class CompanyPostingsResponse(BaseModel):
    company_id: int
    items: list[CompanyPostingItem]


class ModerationAction(BaseModel):
    status: Literal["PUBLISHED", "REJECTED", "CLOSED"]
    reason: str | None = None


# ── Admin Analytics ───────────────────────────────────────────────────────────

class UserGrowthPoint(BaseModel):
    period: str          # e.g. "2026-W38" or "2026-09"
    students: int
    companies: int
    admins: int


class FunnelByCompany(BaseModel):
    company_id: int
    company_name: str
    applied: int
    screened: int
    interviews: int
    offers: int


class TopCompanyItem(BaseModel):
    company_id: int
    company_name: str
    posting_count: int
    published_count: int


class AdminActionVolume(BaseModel):
    period: str | None = None
    action: str
    count: int