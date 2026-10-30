# This module provides a function to send notifications to users. It includes the `notify` function, which creates a notification record in the database and optionally sends an email to the user. The function also checks for sensitive information in the notification content and blocks certain types of notifications to prevent sending sensitive codes via email or other channels.
import logging
import re

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Notification, User
from app.services.mail import send_dev_email

logger = logging.getLogger(__name__)
BLOCKED_NOTIFICATION_TYPES = {
    "MFA_CHALLENGE",
    "MFA_SETUP",
    "MFA_STATUS_CHANGE",
    "PASSWORD_RESET",
    "OTP",
    "SECURITY_CODE",
}
_CODE_PATTERN = re.compile(r"\b\d{6}\b")


async def notify(
    db: AsyncSession,
    user_id: int,
    notification_type: str,
    title: str,
    body: str,
    *,
    email: bool = False,
    html: str | None = None,
    application_id: int | None = None,
    defer_delivery: bool = False,
) -> Notification | None:
    """Persist a notification, optionally queue email, and dispatch it unless delivery is deferred."""
    if notification_type in BLOCKED_NOTIFICATION_TYPES or _CODE_PATTERN.search(title) or _CODE_PATTERN.search(body):
        logger.warning(
            "Blocked notification containing a sensitive code for user %s (type %s)",
            user_id,
            notification_type,
        )
        return None

    notification = Notification(
        user_id=user_id,
        application_id=application_id,
        notification_type=notification_type,
        title=title,
        body=body,
    )
    db.add(notification)
    await db.flush()

    if email and not defer_delivery:
        recipient = await db.scalar(select(User).where(User.id == user_id))
        if recipient is not None:
            await send_dev_email(
                recipient.email,
                title,
                body,
                html=html,
                message_type=notification_type,
                db=db,
                application_id=application_id,
            )

    if not defer_delivery:
        try:
            await dispatch_notification(notification)
        except Exception as exc:
            logger.warning("Could not send notification to user %s: %s", user_id, exc)

    return notification


async def dispatch_notification(notification: Notification) -> None:
    """Send a persisted notification payload to its recipient over the WebSocket manager."""
    from app.api.v1.ws import manager

    await manager.send_personal_message(
        notification.user_id,
        {
            "type": "notification_created",
            "notification": {
                "id": notification.id,
                "notification_type": notification.notification_type,
                "title": notification.title,
                "body": notification.body,
                "created_at": notification.created_at.isoformat(),
                "read_at": notification.read_at.isoformat() if notification.read_at else None,
            },
        },
    )
