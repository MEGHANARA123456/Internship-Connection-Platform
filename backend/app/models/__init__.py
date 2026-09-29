# -----------------------------------------------------------------------------
# Package initializer for all SQLAlchemy models used by the backend application.
# -----------------------------------------------------------------------------

from app.models.user import (
    Application,
    AuditLog,
    CompanyProfile,
    CompanyReview,
    Conversation,
    EmailMessage,
    EmailVerificationToken,
    Interview,
    Internship,
    Message,
    Notification,
    RefreshToken,
    Report,
    Resume,
    SavedInternship,
    StudentProfile,
    User,
    UserRole,
)

__all__ = [
    "Application",
    "AuditLog",
    "CompanyProfile",
    "CompanyReview",
    "Conversation",
    "EmailMessage",
    "EmailVerificationToken",
    "Interview",
    "Internship",
    "Message",
    "Notification",
    "RefreshToken",
    "Report",
    "Resume",
    "SavedInternship",
    "StudentProfile",
    "User",
    "UserRole",
]

