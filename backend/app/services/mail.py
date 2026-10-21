# -----------------------------------------------------------------------------
# Service for sending email messages through the configured SMTP backend.
# -----------------------------------------------------------------------------

import asyncio
from datetime import datetime, timezone
from email.message import EmailMessage as SmtpEmailMessage
from email.utils import formataddr, make_msgid
import logging
import smtplib
import ssl
import threading
from itertools import count
from typing import Any
from urllib.parse import quote

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models import EmailMessage as DbEmailMessage, User

logger = logging.getLogger(__name__)

# In-memory email cache for instant in-app mailbox retrieval
SENT_EMAILS: list[dict[str, Any]] = []
_SENT_EMAILS_LOCK = threading.Lock()
_EMAIL_IDS = count(1)
_MAX_LOCAL_EMAILS = 2000
FAKE_EMAIL_DOMAINS = {
    "example.com",
    "example.org",
    "example.net",
    "test.com",
    "internship.local",
    "sample.com",
    "mailinator.com",
}


def record_email_locally(to: str, subject: str, body: str, html: str | None = None) -> dict[str, Any]:
    email_entry = {
        "id": f"mail-{next(_EMAIL_IDS)}",
        "to": to.strip().lower(),
        "from": "noreply@internship.local",
        "subject": subject,
        "body": body,
        "html": html or body,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    with _SENT_EMAILS_LOCK:
        SENT_EMAILS.insert(0, email_entry)
        del SENT_EMAILS[_MAX_LOCAL_EMAILS:]
    return email_entry


def get_emails_for_recipient(recipient_email: str) -> list[dict[str, Any]]:
    clean = recipient_email.strip().lower()
    with _SENT_EMAILS_LOCK:
        return [dict(email) for email in SENT_EMAILS if email["to"] == clean]


def visible_gmail_url(email: DbEmailMessage, recipient_email: str) -> str | None:
    """Return a Gmail search URL only for Gmail recipients and configured SMTP."""
    stored_recipient = (email.recipient_email or "").strip().lower()
    recipient = (recipient_email or "").strip().lower()
    if not recipient or stored_recipient != recipient:
        return None
    if recipient.rpartition("@")[2] not in {"gmail.com", "googlemail.com"}:
        return None

    if email.message_id:
        query = f"rfc822msgid:{email.message_id}"
    else:
        settings = get_settings()
        if not (settings.mail_server and settings.mail_username and settings.mail_password):
            return None
        sender = (email.sender_email or "").strip()
        subject = (email.subject or "").strip()
        if not sender or not subject or sender.rpartition("@")[2].lower() in FAKE_EMAIL_DOMAINS:
            return None
        query = f'from:{sender} subject:"{subject}"'

    return (
        "https://mail.google.com/mail/?authuser="
        + quote(recipient, safe="")
        + "#search/"
        + quote(query, safe="")
    )


def _send_real_smtp(settings: Any, to: str, subject: str, body: str, html: str | None = None) -> tuple[str | None, bool]:
    """Sends real email via SMTP if credentials are configured in .env."""
    if not settings.mail_server or not settings.mail_username or not settings.mail_password:
        return None, False

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
        return None, False

    try:
        msg = SmtpEmailMessage()
        sender_email = settings.mail_from or settings.mail_username
        sender_domain = sender_email.rpartition("@")[2] or None
        message_id = make_msgid(domain=sender_domain)
        msg["Message-ID"] = message_id
        msg["Subject"] = subject
        sender_display_name = getattr(settings, "mail_from_name", "Internship Platform") or "Internship Platform"
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
                refused = server.send_message(msg)
                if refused:
                    raise smtplib.SMTPRecipientsRefused(refused)
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
                refused = server.send_message(msg)
                if refused:
                    raise smtplib.SMTPRecipientsRefused(refused)
                logger.info("Real email successfully sent to %s via SMTP TLS (port %s)", to, port)
        return message_id, True
    except Exception as exc:
        logger.warning("SMTP delivery failed for recipient %s: %s", to, exc)
        return None, False


async def send_dev_email(
    to: str,
    subject: str,
    body: str,
    html: str | None = None,
    message_type: str = "GENERAL",
    db: AsyncSession | None = None,
    application_id: int | None = None,
) -> None:
    settings = get_settings()
    clean_to = to.strip().lower()
    record_email_locally(clean_to, subject, body, html)

    email_record: DbEmailMessage | None = None
    if db is not None:
        try:
            user = await db.scalar(select(User).where(User.email == clean_to))
            if user is not None:
                email_record = DbEmailMessage(
                    user_id=user.id,
                    recipient_email=clean_to,
                    sender_email=settings.mail_from or "noreply@internship.local",
                    subject=subject,
                    message_type=message_type,
                    body=body,
                    html=html,
                    application_id=application_id,
                )
                db.add(email_record)
                await db.commit()
                await db.refresh(email_record)
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
            except Exception as exc:
                logger.warning("Mailpit delivery attempt failed for %s via %s: %s", clean_to, host, exc)
                continue

    if not mailpit_sent:
        logger.info("Mailpit not reachable at port 8025, recorded email in local in-memory store for %s", clean_to)

    # 2. Optionally deliver via real SMTP if configured
    if settings.mail_server and settings.mail_username and settings.mail_password:
        message_id, delivered = await asyncio.to_thread(
            _send_real_smtp, settings, clean_to, subject, body, html
        )
        if delivered and email_record is not None and db is not None:
            email_record.message_id = message_id
            email_record.delivered_via_smtp = True
            try:
                await db.commit()
            except Exception as exc:
                logger.warning("Could not persist SMTP delivery metadata for %s: %s", clean_to, exc)
                await db.rollback()