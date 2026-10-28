"""Strict public request and response contracts for the chatbot."""

from enum import Enum
from pydantic import BaseModel, ConfigDict, Field
from typing import Literal


class ChatPage(str, Enum):
    home = "home"
    student_dashboard = "student-dashboard"
    opportunities = "opportunities"
    applications = "applications"
    profile = "profile"
    interviews = "interviews"
    messages = "messages"
    notifications = "notifications"
    company = "company"
    company_dashboard = "company-dashboard"
    company_jobs = "company-jobs"
    company_applicants = "company-applicants"
    company_analytics = "company-analytics"
    company_shortlisted = "company-shortlisted"
    company_pipeline = "company-pipeline"
    company_settings = "company-settings"
    company_profile = "company-profile"
    admin = "admin"
    admin_dashboard = "admin-dashboard"
    admin_moderation = "admin-moderation"
    admin_skills = "admin-skills"
    admin_verifications = "admin-verifications"
    admin_reports = "admin-reports"
    admin_audit_logs = "admin-audit-logs"
    admin_companies = "admin-companies"
    admin_users = "admin-users"
    privacy = "privacy"
    privacy_policy = "privacy-policy"
    privacy_center = "privacy-center"
    saved = "saved"
    login = "login"
    register_student = "register-student"
    register_company = "register-company"
    verify = "verify"


class ChatRole(str, Enum):
    user = "user"
    assistant = "assistant"


class ChatTurn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    role: ChatRole
    content: str = Field(min_length=1, max_length=500)


class ChatAskRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    message: str = Field(min_length=1, max_length=500)
    history: list[ChatTurn] = Field(default_factory=list, max_length=4)
    page: ChatPage = ChatPage.home


class ChatLink(BaseModel):
    label: str
    route: str


class ChatSource(BaseModel):
    id: str
    title: str
    route: str


class ChatAskResponse(BaseModel):
    answer: str
    links: list[ChatLink] = Field(default_factory=list)
    sources: list[ChatSource] = Field(default_factory=list)
    source_type: str
    suggested_followups: list[str] = Field(default_factory=list)
    category: str
    refused: bool


class ChatFeedbackRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    rating: Literal["up", "down"]
    source_type: Literal["docs", "live data", "docs + live data"]
    turn_id: str = Field(min_length=1, max_length=80)
