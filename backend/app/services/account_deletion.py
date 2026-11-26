"""Shared account-erasure service used by privacy and administrator endpoints."""

import asyncio
import logging
from typing import Any

from fastapi import HTTPException
from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

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
    InterviewRecording,
    InterviewRecordingDeletion,
    Internship,
    Message,
    Notification,
    RefreshToken,
    Report,
    Resume,
    SavedInternship,
    SkillAttempt,
    SkillBadge,
    StudentProfile,
    User,
    UserRole,
)
from app.services.asset_storage import (
    asset_key,
    get_asset_storage,
    legacy_avatar_key,
)

logger = logging.getLogger(__name__)


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
    assets_to_delete: list[tuple[str, str]] = []
    interview_video_recordings: list[InterviewRecording] = []

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
            assets_to_delete.append(
                (
                    resume.storage_backend,
                    resume.storage_key
                    or asset_key("resumes", resume.stored_filename),
                )
            )
        if target.role == UserRole.STUDENT:
            interview_video_recordings = list(
                await db.scalars(
                    select(InterviewRecording).where(
                        InterviewRecording.student_id == target.id
                    )
                )
            )
        if target.role == UserRole.COMPANY:
            documents = await db.scalars(
                select(CompanyDocument).where(CompanyDocument.company_id == target.id)
            )
            for document in documents:
                assets_to_delete.append(
                    (
                        document.storage_backend,
                        document.storage_key
                        or asset_key("company_documents", document.stored_filename),
                    )
                )

        profiles = await db.scalars(
            select(StudentProfile).where(StudentProfile.user_id == target.id)
        )
        for profile in profiles:
            avatar_key = profile.avatar_storage_key or legacy_avatar_key(profile.avatar_url)
            if avatar_key:
                assets_to_delete.append(
                    (
                        profile.avatar_storage_backend or "local",
                        avatar_key,
                    )
                )
        company_profiles = await db.scalars(
            select(CompanyProfile).where(CompanyProfile.user_id == target.id)
        )
        for profile in company_profiles:
            avatar_key = profile.avatar_storage_key or legacy_avatar_key(profile.avatar_url)
            if avatar_key:
                assets_to_delete.append(
                    (
                        profile.avatar_storage_backend or "local",
                        avatar_key,
                    )
                )

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
        await db.execute(delete(SkillBadge).where(SkillBadge.student_id == target.id))
        await db.execute(delete(SkillAttempt).where(SkillAttempt.student_id == target.id))
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
                    action="admin_user_deleted",
                    target_type="user",
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

        db.add_all(
            [
                InterviewRecordingDeletion(
                    storage_key=recording.storage_key,
                    storage_backend=recording.storage_backend,
                    storage_file_id=recording.storage_file_id,
                    source_type=recording.source_type,
                    user_id=recording.student_id,
                    session_id=recording.session_id,
                    upload_active=recording.upload_active,
                    final_status="DELETED",
                )
                for recording in interview_video_recordings
            ]
        )
        for backend, key in assets_to_delete:
            await asyncio.to_thread(get_asset_storage(backend).delete, key)
        await db.execute(delete(User).where(User.id == target.id))
        await db.commit()
    except BaseException:
        await db.rollback()
        raise

    if interview_video_recordings:
        from app.services.interview_video import process_recording_deletions

        await process_recording_deletions(db, limit=len(interview_video_recordings))

    return {
        "success": True,
        "message": (
            "Your account and all associated personal data have been permanently "
            "deleted in accordance with GDPR and CCPA."
            if not admin_action
            else "User account and associated data permanently deleted."
        ),
    }
