"""Strict public request and response contracts for the chatbot."""

from enum import Enum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


MAX_HISTORY_TURNS = 4
MAX_HISTORY_CHARS = 1500


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
    content: str = Field(min_length=1, max_length=MAX_HISTORY_CHARS)


class ChatAskRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    message: str = Field(min_length=1, max_length=500)
    history: list[ChatTurn] = Field(default_factory=list, max_length=MAX_HISTORY_TURNS)
    page: ChatPage = ChatPage.home

    @field_validator("history", mode="before")
    @classmethod
    def _normalize_history(cls, value):
        """Trim and truncate turn content, dropping invalid or blank dicts and blank turns.

        Malformed-role dicts remain for Pydantic validation; list results are capped at four.
        """
        if not isinstance(value, list):
            return value
        invalid_roles = [
            item
            for item in value
            if isinstance(item, dict) and item.get("role") not in {"user", "assistant"}
        ]
        if invalid_roles:
            return invalid_roles[-MAX_HISTORY_TURNS:]

        cleaned = []
        for item in value:
            if isinstance(item, dict):
                content = item.get("content")
                if not isinstance(content, str):
                    continue
                trimmed = content.strip()[:MAX_HISTORY_CHARS]
                if not trimmed:
                    continue
                cleaned.append({**item, "content": trimmed})
            elif isinstance(item, ChatTurn):
                trimmed = item.content.strip()[:MAX_HISTORY_CHARS]
                if not trimmed:
                    continue
                cleaned.append(ChatTurn(role=item.role, content=trimmed))
            else:
                cleaned.append(item)
        return cleaned[-MAX_HISTORY_TURNS:]


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
