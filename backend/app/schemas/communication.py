# -----------------------------------------------------------------------------
# Pydantic models for communication-related data validation.
# -----------------------------------------------------------------------------

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

def _clean_meeting_link(v: str | None) -> str | None:
    if v is None:
        return None
    cleaned = v.strip()
    if not cleaned:
        return None
    if not cleaned.lower().startswith(("http://", "https://")):
        raise ValueError("Meeting link must start with http:// or https://")
    return cleaned


class ConversationCreate(BaseModel):
    participant_id: int


class MessageCreate(BaseModel):
    body: str = Field(min_length=1, max_length=5000)


class MessageResponse(BaseModel):
    id: int
    conversation_id: int
    sender_id: int
    body: str
    created_at: datetime
    read_at: datetime | None


class InterviewCreate(BaseModel):
    scheduled_at: datetime
    interview_type: Literal["VIDEO", "PHONE", "IN_PERSON"]
    meeting_link: str | None = Field(default=None, max_length=500)
    notes: str | None = None

    @field_validator("meeting_link")
    @classmethod
    def validate_meeting_link(cls, value: str | None) -> str | None:
        return _clean_meeting_link(value)


class InterviewUpdate(BaseModel):
    status: Literal["SCHEDULED", "RESCHEDULED", "COMPLETED", "CANCELLED"]
    scheduled_at: datetime | None = None
    interview_type: Literal["VIDEO", "PHONE", "IN_PERSON"] | None = None
    meeting_link: str | None = Field(default=None, max_length=500)
    notes: str | None = None
    change_reason: str | None = Field(default=None, max_length=1000)

    @field_validator("meeting_link")
    @classmethod
    def validate_meeting_link(cls, value: str | None) -> str | None:
        return _clean_meeting_link(value)


class InterviewResponse(BaseModel):
    id: int
    application_id: int
    scheduled_by: int
    status: str
    scheduled_at: datetime
    interview_type: str
    meeting_link: str | None = None
    notes: str | None = None
    cancel_reason: str | None = None
    cancelled_at: datetime | None = None
    candidate_name: str | None = None
    internship_title: str | None = None
    company_name: str | None = None


class InterviewFeedbackUpdate(BaseModel):
    result: Literal["PASS", "FAIL", "ON_HOLD"]
    rating: int | None = Field(default=None, ge=1, le=5)
    feedback: str | None = Field(default=None, max_length=5000)


class InterviewFeedbackResponse(BaseModel):
    interview_id: int
    result: str
    rating: int | None = None
    feedback: str | None = None
    feedback_at: datetime


class ApplicationNoteCreate(BaseModel):
    body: str = Field(min_length=1, max_length=5000)


class ApplicationNoteResponse(BaseModel):
    id: int
    application_id: int
    author_user_id: int
    body: str
    created_at: datetime


class NotificationResponse(BaseModel):
    id: int
    application_id: int | None = None
    gmail_url: str | None = None
    notification_type: str
    title: str
    body: str
    created_at: datetime
    read_at: datetime | None