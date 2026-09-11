import asyncio
from datetime import datetime, timezone
from email.message import EmailMessage
import logging
import smtplib
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models import EmailMessage, User

logger = logging.getLogger(__name__)

# In-memory email cache for instant in-app mailbox retrieval
SENT_EMAILS: list[dict[str, Any]] = []


def record_email_locally(to: str, subject: str, body: str, html: str | None = None) -> dict[str, Any]:
    email_entry = {
        "id": f"mail-{len(SENT_EMAILS) + 1}",
        "to": to.strip().lower(),
        "from": "noreply@internship.local",
        "subject": subject,
        "body": body,
        "html": html or body,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    SENT_EMAILS.insert(0, email_entry)
    return email_entry


def get_emails_for_recipient(recipient_email: str) -> list[dict[str, Any]]:
    clean = recipient_email.strip().lower()
    return [e for e in SENT_EMAILS if e["to"] == clean]


def _send_real_smtp(settings: Any, to: str, subject: str, body: str, html: str | None = None):
    """Sends real email via SMTP if credentials are configured in .env."""
    if not settings.mail_server or not settings.mail_username or not settings.mail_password:
        return

    # Skip dummy and mock test domains to prevent external DNS MX lookup bounces
    clean_to = to.strip().lower()
    dummy_domains = (
        "@example.com",
        "@test.com",
        "@internship.local",
        "@sample.com",
        "@example.org",
        "@example.net",
        "@mailinator.com",
    )
    if clean_to.endswith(dummy_domains):
        logger.info("Skipping real SMTP external delivery for mock test recipient: %s", clean_to)
        return

    try:
        msg = EmailMessage()
        msg["Subject"] = subject
        msg["From"] = settings.mail_from or settings.mail_username
        msg["To"] = to
        msg.set_content(body)
        if html:
            msg.add_alternative(html, subtype="html")

        with smtplib.SMTP(settings.mail_server, settings.mail_port, timeout=5) as server:
            server.starttls()
            server.login(settings.mail_username, settings.mail_password)
            server.send_message(msg)
            logger.info("Real email successfully sent to %s via SMTP", to)
    except Exception as exc:
        logger.warning("Optional SMTP delivery failed: %s", exc)


async def send_dev_email(
    to: str,
    subject: str,
    body: str,
    html: str | None = None,
    message_type: str = "GENERAL",
    db: AsyncSession | None = None,
) -> None:
    settings = get_settings()
    clean_to = to.strip().lower()
    record_email_locally(clean_to, subject, body, html)

    if db is not None:
        try:
            user = await db.scalar(select(User).where(User.email == clean_to))
            if user is not None:
                db.add(
                    EmailMessage(
                        user_id=user.id,
                        recipient_email=clean_to,
                        sender_email=settings.mail_from or "noreply@internship.local",
                        subject=subject,
                        message_type=message_type,
                        body=body,
                        html=html,
                    )
                )
                await db.commit()
        except Exception as exc:
            logger.warning("Could not persist user email record for %s: %s", clean_to, exc)

    # 1. Send to Mailpit HTTP API (Try configured host, then fallback to 127.0.0.1)
    hosts_to_try = [settings.mailpit_host, "127.0.0.1", "localhost"]
    mailpit_sent = False

    payload = {
        "From": {"Email": settings.mail_from or "noreply@internship.local", "Name": settings.mail_from_name or "Internship Platform"},
        "To": [{"Email": clean_to}],
        "Subject": subject,
        "Text": body,
        "HTML": html or body,
    }

    async with httpx.AsyncClient(timeout=3.0) as client:
        for host in set(hosts_to_try):
            try:
                resp = await client.post(f"http://{host}:8025/api/v1/send", json=payload)
                if resp.status_code < 400:
                    mailpit_sent = True
                    break
            except Exception:
                continue

    if not mailpit_sent:
        logger.info("Mailpit not reachable at port 8025, recorded email in local in-memory store for %s", clean_to)

    # 2. Optionally deliver via real SMTP if configured
    if settings.mail_server and settings.mail_username and settings.mail_password:
        loop = asyncio.get_running_loop()
        loop.run_in_executor(None, _send_real_smtp, settings, clean_to, subject, body, html)