"""Shared account-erasure service used by privacy and administrator endpoints."""

from pathlib import Path
from typing import Any

from fastapi import HTTPException
from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models import (
    Application,
    AuditLog,
    CompanyDocument,
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
from app.services.company_documents import company_document_path


async def erase_user(
    db: AsyncSession,
    target: User,
    *,
    reason: str | None,
    actor: User | None = None,
    admin_action: bool = False,
) -> dict[str, Any]:
    """Erase a user and dependent records in one transaction.

    The optional administrator policy prevents self-deletion and removal of the
    last administrator. GDPR self-service erasure keeps its existing policy.
    """
    resume_path: Path | None = None
    company_document_paths: list[Path] = []

    try:
        if admin_action and actor is not None and actor.id == target.id:
            raise HTTPException(status_code=400, detail="You cannot delete your own account")

        if admin_action and target.role == UserRole.ADMIN:
            admin_count = await db.scalar(
                select(func.count()).select_from(User).where(User.role == UserRole.ADMIN)
            )
            if (admin_count or 0) <= 1:
                raise HTTPException(
                    status_code=400,
                    detail="At least one administrator must remain",
                )

        resume = await db.scalar(select(Resume).where(Resume.student_id == target.id))
        if resume is not None:
            resume_path = Path(get_settings().resume_storage_path) / resume.stored_filename
        if target.role == UserRole.COMPANY:
            documents = await db.scalars(
                select(CompanyDocument).where(CompanyDocument.company_id == target.id)
            )
            for document in documents:
                try:
                    company_document_paths.append(
                        company_document_path(document.stored_filename)
                    )
                except HTTPException:
                    continue

        internship_ids: list[int] = []
        if target.role == UserRole.COMPANY:
            internship_ids = list(
                await db.scalars(
                    select(Internship.id).where(Internship.company_id == target.id)
                )
            )

        impacted_students: set[int] = set()
        if internship_ids:
            impacted_students = set(
                await db.scalars(
                    select(Application.student_id)
                    .where(Application.internship_id.in_(internship_ids))
                    .distinct()
                )
            )
            for student_id in impacted_students:
                db.add(
                    Notification(
                        user_id=student_id,
                        notification_type="COMPANY_ACCOUNT_DELETED",
                        title="An internship you applied to was removed",
                        body=(
                            "The company account was deleted and its internships and "
                            "associated applications have been removed."
                        ),
                    )
                )

        application_conditions = [Application.student_id == target.id]
        if internship_ids:
            application_conditions.append(Application.internship_id.in_(internship_ids))
        application_ids = list(
            await db.scalars(
                select(Application.id).where(or_(*application_conditions))
            )
        )

        conversation_ids = list(
            await db.scalars(
                select(Conversation.id).where(
                    (Conversation.student_id == target.id)
                    | (Conversation.company_id == target.id)
                )
            )
        )

        if application_ids:
            await db.execute(
                delete(Interview).where(Interview.application_id.in_(application_ids))
            )
        await db.execute(delete(Interview).where(Interview.scheduled_by == target.id))
        if conversation_ids:
            await db.execute(
                delete(Message).where(Message.conversation_id.in_(conversation_ids))
            )
        await db.execute(delete(Message).where(Message.sender_id == target.id))
        if conversation_ids:
            await db.execute(
                delete(Conversation).where(Conversation.id.in_(conversation_ids))
            )

        await db.execute(
            delete(CompanyReview).where(
                (CompanyReview.company_id == target.id)
                | (CompanyReview.student_id == target.id)
                | (
                    CompanyReview.internship_id.in_(internship_ids)
                    if internship_ids
                    else False
                )
            )
        )
        await db.execute(
            delete(SavedInternship).where(
                (SavedInternship.student_id == target.id)
                | (
                    SavedInternship.internship_id.in_(internship_ids)
                    if internship_ids
                    else False
                )
            )
        )
        await db.execute(
            delete(Report).where(Report.reporter_id == target.id)
        )
        await db.execute(
            update(Report)
            .where(Report.reported_user_id == target.id)
            .values(reported_user_id=None)
        )
        if internship_ids:
            await db.execute(
                update(Report)
                .where(Report.internship_id.in_(internship_ids))
                .values(internship_id=None)
            )

        if application_ids:
            await db.execute(
                delete(Application).where(Application.id.in_(application_ids))
            )
        await db.execute(delete(Internship).where(Internship.company_id == target.id))
        await db.execute(delete(Resume).where(Resume.student_id == target.id))
        await db.execute(delete(RefreshToken).where(RefreshToken.user_id == target.id))
        await db.execute(
            delete(EmailVerificationToken).where(
                EmailVerificationToken.user_id == target.id
            )
        )
        await db.execute(delete(EmailMessage).where(EmailMessage.user_id == target.id))
        await db.execute(delete(Notification).where(Notification.user_id == target.id))
        await db.execute(
            delete(CompanyDocument).where(CompanyDocument.company_id == target.id)
        )
        await db.execute(delete(StudentProfile).where(StudentProfile.user_id == target.id))
        await db.execute(delete(CompanyProfile).where(CompanyProfile.user_id == target.id))

        deleted_email = target.email
        deleted_role = target.role.value
        audit_reason = reason.strip() if reason and reason.strip() else "User direct request"
        if admin_action:
            db.add(
                AuditLog(
                    actor_id=actor.id if actor else None,
                    actor_email=actor.email if actor else None,
                    action="ADMIN_USER_DELETED",
                    target_type="USER",
                    target_id=target.id,
                    metadata_={
                        "reason": audit_reason,
                        "deleted_email": deleted_email,
                        "deleted_role": deleted_role,
                    },
                )
            )
        else:
            db.add(
                AuditLog(
                    actor_id=None,
                    actor_email=f"anonymized_user_{target.id}@deleted.local",
                    action="GDPR_RIGHT_TO_ERASURE_EXECUTED",
                    target_type="USER",
                    target_id=target.id,
                    metadata_={
                        "reason": audit_reason,
                        "regulatory_claim": "GDPR Art. 17 / CCPA § 1798.105",
                    },
                )
            )

        await db.execute(delete(User).where(User.id == target.id))
        await db.commit()
    except BaseException:
        await db.rollback()
        raise

    if resume_path is not None:
        try:
            resume_path.unlink(missing_ok=True)
        except OSError:
            pass
    for document_path in company_document_paths:
        try:
            document_path.unlink(missing_ok=True)
        except OSError:
            pass

    return {
        "success": True,
        "message": (
            "Your account and all associated personal data have been permanently "
            "deleted in accordance with GDPR and CCPA."
            if not admin_action
            else "User account and associated data permanently deleted."
        ),
    }
