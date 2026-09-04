from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


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
    meeting_link: str | None = None
    notes: str | None = None


class InterviewUpdate(BaseModel):
    status: Literal["SCHEDULED", "RESCHEDULED", "COMPLETED", "CANCELLED"]
    scheduled_at: datetime | None = None
    meeting_link: str | None = None
    notes: str | None = None


class InterviewResponse(InterviewCreate):
    id: int
    application_id: int
    scheduled_by: int
    status: str


class NotificationResponse(BaseModel):
    id: int
    notification_type: str
    title: str
    body: str
    created_at: datetime
    read_at: datetime | None