from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_, select, update

from app.api.v1.dependencies import DbSession, get_current_user, require_roles
from app.core.config import get_settings
from app.models import Application, CompanyProfile, Conversation, Interview, Internship, Message, Notification, StudentProfile, User, UserRole
from app.api.v1.applications import application_transition_allowed
from app.schemas.communication import ConversationCreate, InterviewCreate, InterviewResponse, InterviewUpdate, MessageCreate, MessageResponse, NotificationResponse
from app.services.mail import send_dev_email

router = APIRouter(tags=["communication"])
participant = Annotated[User, Depends(require_roles(UserRole.STUDENT, UserRole.COMPANY))]


async def get_conversation(conversation_id: int, user: User, db: DbSession) -> Conversation:
    conversation = await db.scalar(select(Conversation).where(Conversation.id == conversation_id, or_(Conversation.student_id == user.id, Conversation.company_id == user.id)))
    if conversation is None: raise HTTPException(404, "Conversation not found")
    return conversation


@router.post("/conversations/with/{other_user_id}", status_code=201)
async def start_conversation(other_user_id: int, user: participant, db: DbSession) -> dict[str, int]:
    other_user = await db.get(User, other_user_id)
    if other_user is None:
        raise HTTPException(404, "Target user not found")
    if other_user.id == user.id:
        raise HTTPException(400, "Cannot start conversation with yourself")

    student_id, company_id = (user.id, other_user_id) if user.role == UserRole.STUDENT else (other_user_id, user.id)
    conversation = await db.scalar(select(Conversation).where(Conversation.student_id == student_id, Conversation.company_id == company_id))
    if conversation is None:
        conversation = Conversation(student_id=student_id, company_id=company_id)
        db.add(conversation)
        await db.commit()
        await db.refresh(conversation)
    return {"id": conversation.id}


@router.post("/conversations", status_code=201)
async def create_conversation(data: ConversationCreate, user: participant, db: DbSession) -> dict[str, int]:
    return await start_conversation(data.participant_id, user, db)


@router.get("/contacts")
async def list_contacts(user: Annotated[User, Depends(get_current_user)], db: DbSession) -> list[dict]:
    users = (await db.scalars(select(User).where(User.id != user.id, User.is_active == True).limit(20))).all()
    contacts = []
    for u in users:
        name = u.email.split("@")[0]
        avatar_url = None
        if u.role == UserRole.STUDENT and u.student_profile:
            name = u.student_profile.full_name
            avatar_url = u.student_profile.avatar_url
        elif u.role == UserRole.COMPANY and u.company_profile:
            name = u.company_profile.company_name
            avatar_url = u.company_profile.avatar_url
        contacts.append({
            "id": u.id,
            "email": u.email,
            "name": name,
            "role": u.role.value,
            "avatar_url": avatar_url,
        })
    return contacts


@router.get("/contacts/recommended")
async def list_recommended_contacts(user: Annotated[User, Depends(get_current_user)], db: DbSession) -> list[dict]:
    """
    Returns recommended contacts with related internship context.
    - For students: returns hiring companies with active and applied internships.
    - For companies: returns candidate applicants for review.
    """
    recommended = []

    if user.role == UserRole.STUDENT:
        query = (
            select(User, CompanyProfile, Internship)
            .join(CompanyProfile, User.id == CompanyProfile.user_id)
            .join(Internship, Internship.company_id == User.id)
            .where(User.id != user.id, Internship.status == "PUBLISHED")
            .order_by(Internship.created_at.desc())
            .limit(10)
        )
        rows = (await db.execute(query)).all()
        seen_companies = set()

        my_app_company_ids = set(
            (
                await db.scalars(
                    select(Internship.company_id)
                    .join(Application, Application.internship_id == Internship.id)
                    .where(Application.student_id == user.id)
                )
            ).all()
        )

        for u, comp, job in rows:
            if u.id in seen_companies:
                continue
            seen_companies.add(u.id)
            is_applied = u.id in my_app_company_ids
            recommended.append({
                "id": u.id,
                "user_id": u.id,
                "company_id": comp.id,
                "company_name": comp.company_name,
                "recruiter_name": comp.company_name,
                "industry": comp.industry,
                "email": u.email,
                "avatar_url": comp.avatar_url,
                "active_role": job.title,
                "recent_roles": [job.title],
                "internship_id": job.id,
                "stipend": job.stipend,
                "work_mode": job.work_mode,
                "status": "Applied" if is_applied else "Hiring Now",
                "relationship": "Applied" if is_applied else "Hiring Now",
                "role": "COMPANY",
            })

    elif user.role == UserRole.COMPANY:
        query = (
            select(User, StudentProfile, Application, Internship)
            .join(StudentProfile, User.id == StudentProfile.user_id)
            .join(Application, Application.student_id == User.id)
            .join(Internship, Application.internship_id == Internship.id)
            .where(Internship.company_id == user.id)
            .order_by(Application.created_at.desc())
            .limit(10)
        )
        rows = (await db.execute(query)).all()
        seen_students = set()
        for u, stud, app, job in rows:
            if u.id in seen_students:
                continue
            seen_students.add(u.id)
            status_str = app.status.value if hasattr(app.status, "value") else str(app.status)
            recommended.append({
                "id": u.id,
                "user_id": u.id,
                "student_id": stud.id,
                "name": stud.full_name,
                "student_name": stud.full_name,
                "university": stud.university,
                "major": stud.major,
                "email": u.email,
                "avatar_url": stud.avatar_url,
                "applied_role": job.title,
                "active_role": job.title,
                "recent_roles": [job.title],
                "internship_id": job.id,
                "application_id": app.id,
                "status": status_str,
                "relationship": "Candidate",
                "role": "STUDENT",
            })

    return recommended


@router.get("/conversations")
async def list_conversations(user: participant, db: DbSession) -> list[dict]:
    conversations = (await db.scalars(select(Conversation).where(or_(Conversation.student_id == user.id, Conversation.company_id == user.id)))).all()
    result = []
    for conv in conversations:
        partner_id = conv.company_id if user.id == conv.student_id else conv.student_id
        partner_user = await db.get(User, partner_id)
        partner_name = "User"
        partner_avatar = None
        if partner_user:
            if partner_user.role == UserRole.STUDENT:
                sp = await db.scalar(select(StudentProfile).where(StudentProfile.user_id == partner_id))
                if sp and sp.full_name:
                    partner_name = sp.full_name
                    partner_avatar = sp.avatar_url
                elif partner_user.email:
                    partner_name = partner_user.email.split("@")[0].title()
            elif partner_user.role == UserRole.COMPANY:
                cp = await db.scalar(select(CompanyProfile).where(CompanyProfile.user_id == partner_id))
                if cp and cp.company_name:
                    partner_name = cp.company_name
                    partner_avatar = cp.avatar_url
                elif partner_user.email:
                    partner_name = partner_user.email.split("@")[0].title()
            elif partner_user.email:
                partner_name = partner_user.email.split("@")[0].title()

        last_msg = await db.scalar(select(Message).where(Message.conversation_id == conv.id).order_by(Message.created_at.desc()).limit(1))
        unread = await db.scalar(select(Message.id).where(Message.conversation_id == conv.id, Message.sender_id != user.id, Message.read_at.is_(None)).limit(1))

        result.append({
            "id": conv.id,
            "student_id": conv.student_id,
            "company_id": conv.company_id,
            "partner_id": partner_id,
            "partner_name": partner_name,
            "partner_avatar": partner_avatar,
            "partner_role": partner_user.role.value if partner_user else "USER",
            "last_message": last_msg.body if last_msg else "No messages yet",
            "last_message_at": last_msg.created_at.isoformat() if last_msg else conv.created_at.isoformat(),
            "has_unread": unread is not None,
        })
    return sorted(result, key=lambda x: x["last_message_at"], reverse=True)


@router.get("/conversations/{conversation_id}/messages", response_model=list[MessageResponse])
async def list_messages(conversation_id: int, user: participant, db: DbSession) -> list[Message]:
    await get_conversation(conversation_id, user, db)
    await db.execute(update(Message).where(Message.conversation_id == conversation_id, Message.sender_id != user.id, Message.read_at.is_(None)).values(read_at=datetime.now(timezone.utc)))
    await db.commit()
    return list(await db.scalars(select(Message).where(Message.conversation_id == conversation_id).order_by(Message.created_at)))


@router.post("/conversations/{conversation_id}/messages", response_model=MessageResponse, status_code=201)
async def send_message(conversation_id: int, data: MessageCreate, user: participant, db: DbSession) -> Message:
    conversation = await get_conversation(conversation_id, user, db)
    message = Message(conversation_id=conversation.id, sender_id=user.id, body=data.body)
    db.add(message)
    await db.commit()
    await db.refresh(message)

    # Real-time WebSocket relay to conversation partner
    try:
        from app.api.v1.ws import manager
        recipient_id = conversation.company_id if user.id == conversation.student_id else conversation.student_id
        await manager.send_personal_message(
            recipient_id,
            {
                "type": "new_message",
                "conversation_id": conversation.id,
                "message": {
                    "id": message.id,
                    "conversation_id": message.conversation_id,
                    "sender_id": message.sender_id,
                    "body": message.body,
                    "created_at": message.created_at.isoformat(),
                    "read_at": None,
                },
            },
        )
    except Exception:
        pass

    return message


@router.post("/applications/{application_id}/interviews", response_model=InterviewResponse, status_code=201)
async def schedule_interview(application_id: int, data: InterviewCreate, user: Annotated[User, Depends(require_roles(UserRole.COMPANY))], db: DbSession) -> Interview:
    application = await db.scalar(select(Application).join(Internship, Application.internship_id == Internship.id).where(Application.id == application_id, Internship.company_id == user.id))
    if application is None: raise HTTPException(404, "Application not found")
    if not application_transition_allowed(application.status, "INTERVIEW_SCHEDULED"):
        raise HTTPException(409, f"Cannot schedule an interview from {application.status}")
    interview = Interview(application_id=application_id, scheduled_by=user.id, **data.model_dump()); db.add(interview)
    application.status = "INTERVIEW_SCHEDULED"; await db.commit(); await db.refresh(interview)
    student = await db.scalar(select(User).where(User.id == application.student_id))
    if student:
        db.add(Notification(user_id=student.id, notification_type="INTERVIEW_INVITE", title="Interview invitation", body=f"Interview scheduled for {data.scheduled_at.isoformat()}"))
        await db.commit()
        await send_dev_email(student.email, "Interview invitation", f"Interview scheduled for {data.scheduled_at.isoformat()}")
        try:
            from app.api.v1.ws import manager
            await manager.send_personal_message(
                student.id,
                {
                    "type": "interview_scheduled",
                    "application_id": application_id,
                    "scheduled_at": data.scheduled_at.isoformat(),
                    "interview_type": data.interview_type,
                    "meeting_link": data.meeting_link,
                },
            )
        except Exception:
            pass
    return interview


@router.get("/applications/{application_id}/interviews", response_model=list[InterviewResponse])
async def list_interviews(application_id: int, user: participant, db: DbSession) -> list[Interview]:
    application = await db.scalar(select(Application).where(Application.id == application_id, Application.student_id == user.id))
    if application is None:
        application = await db.scalar(select(Application).join(Internship, Application.internship_id == Internship.id).where(Application.id == application_id, Internship.company_id == user.id))
    if application is None: raise HTTPException(404, "Application not found")
    return list(await db.scalars(select(Interview).where(Interview.application_id == application_id).order_by(Interview.scheduled_at)))


@router.get("/interviews/my", response_model=list[InterviewResponse])
@router.get("/interviews", response_model=list[InterviewResponse])
async def list_my_interviews(user: Annotated[User, Depends(get_current_user)], db: DbSession) -> list[Interview]:
    if user.role == UserRole.STUDENT:
        query = select(Interview).join(Application, Interview.application_id == Application.id).where(Application.student_id == user.id).order_by(Interview.scheduled_at.desc())
    elif user.role == UserRole.COMPANY:
        query = select(Interview).join(Application, Interview.application_id == Application.id).join(Internship, Application.internship_id == Internship.id).where(Internship.company_id == user.id).order_by(Interview.scheduled_at.desc())
    else:
        query = select(Interview).order_by(Interview.scheduled_at.desc())
    return list(await db.scalars(query))


@router.patch("/interviews/{interview_id}", response_model=InterviewResponse)
async def update_interview(interview_id: int, data: InterviewUpdate, user: participant, db: DbSession) -> Interview:
    interview = await db.scalar(select(Interview).where(Interview.id == interview_id))
    if interview is None: raise HTTPException(404, "Interview not found")
    application = await db.scalar(select(Application).where(Application.id == interview.application_id))
    internship = await db.scalar(select(Internship).where(Internship.id == application.internship_id)) if application else None
    if application is None or (user.id != application.student_id and user.id != internship.company_id): raise HTTPException(403, "Interview access denied")
    for key, value in data.model_dump(exclude_unset=True).items(): setattr(interview, key, value)
    await db.commit(); await db.refresh(interview); return interview


@router.get("/notifications", response_model=list[NotificationResponse])
async def notifications(user: Annotated[User, Depends(get_current_user)], db: DbSession) -> list[Notification]:
    return list(await db.scalars(select(Notification).where(Notification.user_id == user.id).order_by(Notification.created_at.desc())))


@router.post("/notifications/read-all", status_code=204)
@router.patch("/notifications/read-all", status_code=204)
async def mark_all_notifications_read(user: Annotated[User, Depends(get_current_user)], db: DbSession) -> None:
    await db.execute(
        update(Notification)
        .where(Notification.user_id == user.id, Notification.read_at.is_(None))
        .values(read_at=datetime.now(timezone.utc))
    )
    await db.commit()


@router.post("/notifications/{notification_id}/read", status_code=204)
@router.patch("/notifications/{notification_id}/read", status_code=204)
async def mark_notification_read(notification_id: int, user: Annotated[User, Depends(get_current_user)], db: DbSession) -> None:
    notification = await db.scalar(select(Notification).where(Notification.id == notification_id, Notification.user_id == user.id))
    if notification is None: raise HTTPException(404, "Notification not found")
    notification.read_at = datetime.now(timezone.utc); await db.commit()