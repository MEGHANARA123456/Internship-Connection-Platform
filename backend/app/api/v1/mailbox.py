from typing import Annotated
from fastapi import APIRouter, Depends
from sqlalchemy import select

from app.api.v1.dependencies import get_current_user
from app.api.v1.dependencies import DbSession
from app.models import EmailMessage, User

router = APIRouter(tags=["mailbox"])


async def _get_user_emails(user: User, db: DbSession) -> list[dict]:
    messages = (
        await db.scalars(
            select(EmailMessage)
            .where(EmailMessage.user_id == user.id)
            .order_by(EmailMessage.created_at.desc())
        )
    ).all()
    return [
        {
            "id": message.id,
            "to": message.recipient_email,
            "from": message.sender_email,
            "subject": message.subject,
            "message_type": message.message_type,
            "body": message.body,
            "html": message.html,
            "created_at": message.created_at,
        }
        for message in messages
    ]


@router.get("/me/emails")
async def get_my_emails(user: Annotated[User, Depends(get_current_user)], db: DbSession) -> list[dict]:
    """Return only email records owned by the authenticated user."""
    return await _get_user_emails(user, db)


@router.get("/mailbox/my", include_in_schema=False)
async def get_legacy_my_emails(user: Annotated[User, Depends(get_current_user)], db: DbSession) -> list[dict]:
    """Compatibility alias for the user-scoped mailbox endpoint."""
    return await _get_user_emails(user, db)
