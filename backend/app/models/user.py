from datetime import date, datetime, timezone
try:
    from enum import StrEnum
except ImportError:
    from enum import Enum
    class StrEnum(str, Enum):
        pass

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class UserRole(StrEnum):
    STUDENT = "STUDENT"
    COMPANY = "COMPANY"
    ADMIN = "ADMIN"


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[UserRole] = mapped_column(Enum(UserRole), index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    email_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    student_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    institution_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    organization_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    admin_approved: Mapped[bool] = mapped_column(Boolean, default=False)
    suspended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    verification_token: Mapped[str | None] = mapped_column(String(255), unique=True)
    verification_token_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    reset_token: Mapped[str | None] = mapped_column(String(255), unique=True)
    reset_token_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    mfa_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    mfa_secret: Mapped[str | None] = mapped_column(String(255), nullable=True)
    mfa_otp: Mapped[str | None] = mapped_column(String(64), nullable=True)
    mfa_otp_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    student_profile: Mapped["StudentProfile | None"] = relationship(back_populates="user", cascade="all, delete-orphan")
    company_profile: Mapped["CompanyProfile | None"] = relationship(back_populates="user", cascade="all, delete-orphan")
    refresh_tokens: Mapped[list["RefreshToken"]] = relationship(back_populates="user", cascade="all, delete-orphan")


class StudentProfile(Base):
    __tablename__ = "student_profiles"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, unique=True)
    full_name: Mapped[str] = mapped_column(String(255))
    university: Mapped[str] = mapped_column(String(255))
    major: Mapped[str] = mapped_column(String(255))
    graduation_year: Mapped[int] = mapped_column()
    bio: Mapped[str | None] = mapped_column(Text)
    skills: Mapped[str] = mapped_column(Text, default="")
    institution_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    avatar_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    user: Mapped[User] = relationship(back_populates="student_profile")


class CompanyProfile(Base):
    __tablename__ = "company_profiles"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, unique=True)
    company_name: Mapped[str] = mapped_column(String(255))
    industry: Mapped[str] = mapped_column(String(255))
    website: Mapped[str | None] = mapped_column(String(500))
    description: Mapped[str | None] = mapped_column(Text)
    verification_status: Mapped[str] = mapped_column(String(20), default="PENDING")
    avatar_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    user: Mapped[User] = relationship(back_populates="company_profile")


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"
    id: Mapped[int] = mapped_column(primary_key=True)
    jti: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    user: Mapped[User] = relationship(back_populates="refresh_tokens")


class EmailVerificationToken(Base):
    __tablename__ = "email_verification_tokens"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    token_digest: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class EmailMessage(Base):
    __tablename__ = "email_messages"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    recipient_email: Mapped[str] = mapped_column(String(255), index=True)
    sender_email: Mapped[str] = mapped_column(String(255))
    subject: Mapped[str] = mapped_column(String(255))
    message_type: Mapped[str] = mapped_column(String(50), default="GENERAL")
    body: Mapped[str] = mapped_column(Text)
    html: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)


class Internship(Base):
    __tablename__ = "internships"
    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    title: Mapped[str] = mapped_column(String(255))
    description: Mapped[str] = mapped_column(Text)
    location: Mapped[str] = mapped_column(String(255))
    industry: Mapped[str] = mapped_column(String(255))
    duration_months: Mapped[int] = mapped_column()
    stipend: Mapped[int | None] = mapped_column()
    work_mode: Mapped[str] = mapped_column(String(30))
    skills: Mapped[str] = mapped_column(Text, default="")
    deadline: Mapped[date] = mapped_column()
    status: Mapped[str] = mapped_column(String(30), default="DRAFT", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class Application(Base):
    __tablename__ = "applications"
    id: Mapped[int] = mapped_column(primary_key=True)
    internship_id: Mapped[int] = mapped_column(ForeignKey("internships.id"), index=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    status: Mapped[str] = mapped_column(String(30), default="APPLIED", index=True)
    cover_note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))


class Resume(Base):
    __tablename__ = "resumes"
    id: Mapped[int] = mapped_column(primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("users.id"), unique=True, index=True)
    original_filename: Mapped[str] = mapped_column(String(255))
    stored_filename: Mapped[str] = mapped_column(String(255), unique=True)
    content_type: Mapped[str] = mapped_column(String(100))
    file_size: Mapped[int] = mapped_column()


class Conversation(Base):
    __tablename__ = "conversations"
    id: Mapped[int] = mapped_column(primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class Message(Base):
    __tablename__ = "messages"
    id: Mapped[int] = mapped_column(primary_key=True)
    conversation_id: Mapped[int] = mapped_column(ForeignKey("conversations.id"), index=True)
    sender_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Interview(Base):
    __tablename__ = "interviews"
    id: Mapped[int] = mapped_column(primary_key=True)
    application_id: Mapped[int] = mapped_column(ForeignKey("applications.id"), index=True)
    scheduled_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    scheduled_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    interview_type: Mapped[str] = mapped_column(String(30))
    meeting_link: Mapped[str | None] = mapped_column(String(500))
    notes: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="SCHEDULED")


class Notification(Base):
    __tablename__ = "notifications"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    notification_type: Mapped[str] = mapped_column(String(50))
    title: Mapped[str] = mapped_column(String(255))
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Report(Base):
    __tablename__ = "reports"
    id: Mapped[int] = mapped_column(primary_key=True)
    reporter_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    reported_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    internship_id: Mapped[int | None] = mapped_column(ForeignKey("internships.id"))
    reason: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="OPEN", index=True)
    resolution_notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))


class SavedInternship(Base):
    __tablename__ = "saved_internships"
    __table_args__ = (UniqueConstraint("student_id", "internship_id", name="uq_saved_internship"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    internship_id: Mapped[int] = mapped_column(ForeignKey("internships.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    student: Mapped["User"] = relationship()
    internship: Mapped["Internship"] = relationship()


class CompanyReview(Base):
    __tablename__ = "company_reviews"
    __table_args__ = (UniqueConstraint("student_id", "internship_id", name="uq_company_review"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    internship_id: Mapped[int] = mapped_column(ForeignKey("internships.id"), index=True)
    rating: Mapped[int] = mapped_column(Integer)
    review_text: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    student: Mapped["User"] = relationship(foreign_keys=[student_id])
    company: Mapped["User"] = relationship(foreign_keys=[company_id])
    internship: Mapped["Internship"] = relationship(foreign_keys=[internship_id])


class AuditLog(Base):
    __tablename__ = "audit_logs"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    actor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True, nullable=True)
    actor_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    action: Mapped[str] = mapped_column(String(60), index=True)
    target_type: Mapped[str | None] = mapped_column(String(30), index=True, nullable=True)
    target_id: Mapped[int | None] = mapped_column(Integer, index=True, nullable=True)
    metadata_: Mapped[dict | None] = mapped_column("metadata", JSON, nullable=True)
    ip_address: Mapped[str | None] = mapped_column(String(45), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)
