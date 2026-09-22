import asyncio
from datetime import datetime, timezone
from email.message import EmailMessage as SmtpEmailMessage
from email.utils import formataddr
import logging
import smtplib
import ssl
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models import EmailMessage as DbEmailMessage, User

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
        msg = SmtpEmailMessage()
        msg["Subject"] = subject
        sender_display_name = getattr(settings, "mail_from_name", "Internship Platform") or "Internship Platform"
        sender_email = settings.mail_from or settings.mail_username
        msg["From"] = formataddr((sender_display_name, sender_email))
        msg["To"] = to
        msg.set_content(body)
        if html:
            msg.add_alternative(html, subtype="html")

        port = int(getattr(settings, "mail_port", 587) or 587)
        timeout_sec = int(getattr(settings, "mail_timeout", 15) or 15)
        use_ssl = getattr(settings, "mail_use_ssl", False) or port == 465

        if use_ssl:
            ssl_context = ssl.create_default_context()
            with smtplib.SMTP_SSL(settings.mail_server, port, timeout=timeout_sec, context=ssl_context) as server:
                server.login(settings.mail_username, settings.mail_password)
                server.send_message(msg)
                logger.info("Real email successfully sent to %s via SMTP SSL (port %s)", to, port)
        else:
            with smtplib.SMTP(settings.mail_server, port, timeout=timeout_sec) as server:
                server.ehlo()
                if getattr(settings, "mail_use_tls", True) or port == 587:
                    ssl_context = ssl.create_default_context()
                    server.starttls(context=ssl_context)
                    server.ehlo()
                if settings.mail_username and settings.mail_password:
                    server.login(settings.mail_username, settings.mail_password)
                server.send_message(msg)
                logger.info("Real email successfully sent to %s via SMTP TLS (port %s)", to, port)
    except Exception as exc:
        logger.warning("SMTP delivery failed for recipient %s: %s", to, exc)


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
                    DbEmailMessage(
                        # pyrefly: ignore [unexpected-keyword]
                        user_id=user.id,
                        # pyrefly: ignore [unexpected-keyword]
                        recipient_email=clean_to,
                        # pyrefly: ignore [unexpected-keyword]
                        sender_email=settings.mail_from or "noreply@internship.local",
                        # pyrefly: ignore [unexpected-keyword]
                        subject=subject,
                        # pyrefly: ignore [unexpected-keyword]
                        message_type=message_type,
                        # pyrefly: ignore [unexpected-keyword]
                        body=body,
                        # pyrefly: ignore [unexpected-keyword]
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