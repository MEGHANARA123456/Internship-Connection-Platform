# -----------------------------------------------------------------------------
# Pydantic models for admin data validation and API payloads.
# -----------------------------------------------------------------------------

from datetime import date, datetime
from typing import Any, Generic, Literal, TypeVar

from pydantic import BaseModel, Field, computed_field, field_validator

from app.core.config import get_settings

T = TypeVar("T")


# ── Basic User ────────────────────────────────────────────────────────────────

class UserAdminResponse(BaseModel):
    id: int
    email: str
    role: str
    is_active: bool
    is_verified: bool
    mfa_enabled: bool = False
    suspended_at: datetime | None
    created_at: datetime

    model_config = {"from_attributes": True}

    @computed_field
    @property
    def email_verification_required(self) -> bool:
        """Report whether this user's role requires email verification under current settings."""
        role = self.role.value if hasattr(self.role, "value") else str(self.role)
        settings = get_settings()
        if role == "COMPANY":
            return settings.require_company_email_verification
        return settings.require_email_verification and role != "ADMIN"


class AdminCreate(BaseModel):
    email: str
    password: str = Field(min_length=10)

    @field_validator("password")
    @classmethod
    def validate_password_strength(cls, password: str) -> str:
        """Require at least one alphabetic character and one digit without altering the password."""
        if not any(character.isalpha() for character in password) or not any(character.isdigit() for character in password):
            raise ValueError("Password must contain at least one letter and one digit")
        return password


class AdminUserDeletionRequest(BaseModel):
    confirmation_email: str
    reason: str = Field(min_length=5)


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
    actor_role: str | None = None
    action: str
    target_type: str | None
    target_id: int | str | None
    target_label: str | None = None
    target_url: str | None = None
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
    verification_note: str | None = None
    posting_count: int


class AdminPage(BaseModel, Generic[T]):
    items: list[T]
    total: int
    page: int
    page_size: int


class AdminStudentListItem(BaseModel):
    user_id: int
    full_name: str | None
    email: str
    university: str | None
    major: str | None
    graduation_year: int | None
    skills: list[str]
    is_verified: bool
    suspended_at: datetime | None
    created_at: datetime
    applications_count: int
    badges_count: int
    avatar_url: str | None


class AdminCompanyListItem(BaseModel):
    user_id: int
    company_name: str
    industry: str
    location: str | None
    company_size: str | None
    verification_status: str
    posting_count: int
    active_roles: int
    total_applicants: int
    created_at: datetime
    suspended_at: datetime | None


class AdminDetailAccount(BaseModel):
    user_id: int
    email: str
    is_active: bool
    is_verified: bool
    mfa_enabled: bool
    suspended_at: datetime | None
    created_at: datetime


class AdminStudentProfile(BaseModel):
    full_name: str
    university: str
    major: str
    graduation_year: int
    bio: str | None
    skills: str
    institution_email: str | None
    avatar_url: str | None
    show_verified_badges: bool


class AdminStudentApplication(BaseModel):
    id: int
    internship_title: str
    company_name: str
    status: str
    created_at: datetime


class AdminStudentInterview(BaseModel):
    date: datetime
    status: str
    internship_title: str
    company_name: str


class AdminSkillAttempt(BaseModel):
    topic: str
    score: float | None
    passed: bool | None
    submitted_at: datetime


class AdminSkillBadge(BaseModel):
    topic: str
    title: str
    level: str
    score: int
    issued_at: datetime
    expires_at: datetime
    valid: bool


class AdminStudentDetail(BaseModel):
    account: AdminDetailAccount
    profile: AdminStudentProfile | None
    applications: list[AdminStudentApplication]
    applications_total: int
    interviews: list[AdminStudentInterview]
    assessment_attempts: list[AdminSkillAttempt]
    badges: list[AdminSkillBadge]
    recent_audit_events: list[AuditLogResponse]


class AdminCompanyProfile(BaseModel):
    company_name: str
    industry: str
    website: str | None
    description: str | None
    company_size: str | None
    location: str | None
    recruiter_contact_name: str | None
    recruiter_contact_phone: str | None
    recruiter_contact_email: str | None
    verification_status: str
    verification_note: str | None


class AdminCompanyDocument(BaseModel):
    id: int
    document_type: str
    original_filename: str
    file_size: int
    uploaded_at: datetime


class AdminCompanyPosting(BaseModel):
    id: int
    title: str
    status: str
    deadline: date
    applicant_count: int
    created_at: datetime


class AdminVerificationEvent(BaseModel):
    action: str
    actor_email: str | None
    date: datetime
    reason: str | None = None


class AdminCompanyMetrics(BaseModel):
    active_roles: int
    total_internships: int
    total_applicants: int
    shortlisted: int
    interviews_scheduled: int
    offers: int


class AdminCompanyDetail(BaseModel):
    account: AdminDetailAccount
    profile: AdminCompanyProfile
    documents: list[AdminCompanyDocument]
    postings: list[AdminCompanyPosting]
    postings_total: int
    metrics: AdminCompanyMetrics
    verification_history: list[AdminVerificationEvent]
    recent_audit_events: list[AuditLogResponse]


# ── Company posting ───────────────────────────────────────────────────────────

class CompanyPostingItem(BaseModel):
    id: int
    title: str
    status: str
    applicant_count: int
    created_at: datetime


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