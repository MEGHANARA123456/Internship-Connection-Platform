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
        if u.role == UserRole.STUDENT and u.student_profile:
            name = u.student_profile.full_name
        elif u.role == UserRole.COMPANY and u.company_profile:
            name = u.company_profile.company_name
        contacts.append({
            "id": u.id,
            "email": u.email,
            "name": name,
            "role": u.role.value,
        })
    return contacts


@router.get("/conversations")
async def list_conversations(user: participant, db: DbSession) -> list[dict]:
    conversations = (await db.scalars(select(Conversation).where(or_(Conversation.student_id == user.id, Conversation.company_id == user.id)))).all()
    result = []
    for conv in conversations:
        partner_id = conv.company_id if user.id == conv.student_id else conv.student_id
        partner_user = await db.get(User, partner_id)
        partner_name = f"User #{partner_id}"
        if partner_user:
            if partner_user.role == UserRole.STUDENT and partner_user.student_profile:
                partner_name = partner_user.student_profile.full_name
            elif partner_user.role == UserRole.COMPANY and partner_user.company_profile:
                partner_name = partner_user.company_profile.company_name
            elif partner_user.email:
                partner_name = partner_user.email.split("@")[0]

        last_msg = await db.scalar(select(Message).where(Message.conversation_id == conv.id).order_by(Message.created_at.desc()).limit(1))
        unread = await db.scalar(select(Message.id).where(Message.conversation_id == conv.id, Message.sender_id != user.id, Message.read_at.is_(None)).limit(1))

        result.append({
            "id": conv.id,
            "student_id": conv.student_id,
            "company_id": conv.company_id,
            "partner_id": partner_id,
            "partner_name": partner_name,
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
    message = Message(conversation_id=conversation.id, sender_id=user.id, body=data.body); db.add(message); await db.commit(); await db.refresh(message)
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


@router.post("/notifications/{notification_id}/read", status_code=204)
async def mark_notification_read(notification_id: int, user: Annotated[User, Depends(get_current_user)], db: DbSession) -> None:
    notification = await db.scalar(select(Notification).where(Notification.id == notification_id, Notification.user_id == user.id))
    if notification is None: raise HTTPException(404, "Notification not found")
    notification.read_at = datetime.now(timezone.utc); await db.commit()