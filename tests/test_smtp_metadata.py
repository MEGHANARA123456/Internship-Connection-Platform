from datetime import date, timedelta
from types import SimpleNamespace
from urllib.parse import quote

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.models import Application, EmailMessage, Internship, User, UserRole
from app.models.base import Base
from app.services import mail


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


class SuccessfulSMTP:
    message_id: str | None = None

    def __init__(self, *args, **kwargs):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def ehlo(self):
        pass

    def starttls(self, **kwargs):
        pass

    def login(self, *args):
        pass

    def send_message(self, message):
        type(self).message_id = message["Message-ID"]


class FailedSMTP(SuccessfulSMTP):
    def send_message(self, message):
        raise OSError("SMTP unavailable")


class FakeResponse:
    status_code = 200


class FakeHttpClient:
    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def post(self, *args, **kwargs):
        return FakeResponse()


@pytest.mark.anyio
async def test_smtp_metadata_is_persisted_only_after_success(monkeypatch) -> None:
    settings = SimpleNamespace(
        mail_server="smtp.example.com",
        mail_username="sender@example.com",
        mail_password="secret",
        mail_from="sender@example.com",
        mail_from_name="Test",
        mail_port=587,
        mail_timeout=3,
        mail_use_ssl=False,
        mail_use_tls=True,
        mailpit_host="mailpit",
    )
    monkeypatch.setattr(mail, "get_settings", lambda: settings)
    monkeypatch.setattr(mail.httpx, "AsyncClient", FakeHttpClient)
    monkeypatch.setattr(mail.smtplib, "SMTP", SuccessfulSMTP)

    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    async with sessions() as db:
        user = User(email="candidate@gmail.com", password_hash="fake", role=UserRole.STUDENT)
        company = User(email="company@example.com", password_hash="fake", role=UserRole.COMPANY)
        db.add_all([user, company])
        await db.flush()
        internship = Internship(
            company_id=company.id,
            title="Intern",
            description="Test",
            location="Remote",
            industry="Technology",
            duration_months=3,
            work_mode="REMOTE",
            deadline=date.today() + timedelta(days=30),
            status="PUBLISHED",
        )
        db.add(internship)
        await db.flush()
        application = Application(internship_id=internship.id, student_id=user.id)
        db.add(application)
        await db.commit()
        await db.refresh(application)

        await mail.send_dev_email(
            user.email,
            "Interview update",
            "An interview was scheduled.",
            db=db,
            application_id=application.id,
        )
        sent = await db.scalar(select(EmailMessage).where(EmailMessage.user_id == user.id))
        assert sent is not None
        assert sent.application_id == application.id
        assert sent.delivered_via_smtp is True
        assert sent.message_id == SuccessfulSMTP.message_id
        assert sent.message_id.startswith("<") and sent.message_id.endswith(">")
        assert mail.visible_gmail_url(sent, user.email) == (
            "https://mail.google.com/mail/?authuser=candidate%40gmail.com"
            "#search/rfc822msgid%3A" + quote(sent.message_id, safe="")
        )

        monkeypatch.setattr(mail.smtplib, "SMTP", FailedSMTP)
        await mail.send_dev_email(
            user.email,
            "Failed interview update",
            "SMTP will fail.",
            db=db,
            application_id=application.id,
        )
        failed = await db.scalar(
            select(EmailMessage)
            .where(EmailMessage.user_id == user.id)
            .order_by(EmailMessage.id.desc())
        )
        assert failed is not None
        assert failed.delivered_via_smtp is False
        assert failed.message_id is None
        assert mail.visible_gmail_url(failed, user.email) is None

    await engine.dispose()


def test_fake_domains_are_skipped_for_smtp(monkeypatch) -> None:
    settings = SimpleNamespace(
        mail_server="smtp.example.com",
        mail_username="sender@example.com",
        mail_password="secret",
    )

    def unexpected_smtp(*args, **kwargs):
        raise AssertionError("SMTP must be skipped for placeholder domains")

    monkeypatch.setattr(mail.smtplib, "SMTP", unexpected_smtp)
    message_id, delivered = mail._send_real_smtp(
        settings, "student@example.com", "Subject", "Body"
    )
    assert message_id is None
    assert delivered is False


def test_gmail_links_require_google_recipient_domain_and_smtp_delivery() -> None:
    from app.models import EmailMessage

    email = EmailMessage(
        user_id=1,
        recipient_email="candidate@googlemail.com",
        sender_email="sender@example.com",
        subject="Test",
        body="Test",
        message_id="<message@example.com>",
        delivered_via_smtp=True,
    )
    assert mail.visible_gmail_url(email, "candidate@googlemail.com") == (
        "https://mail.google.com/mail/?authuser=candidate%40googlemail.com"
        "#search/rfc822msgid%3A%3Cmessage%40example.com%3E"
    )
    email.recipient_email = "candidate@example.com"
    assert mail.visible_gmail_url(email, "candidate@example.com") is None
    email.recipient_email = "candidate@gmail.com"
    email.delivered_via_smtp = False
    assert mail.visible_gmail_url(email, "candidate@gmail.com") == (
        "https://mail.google.com/mail/?authuser=candidate%40gmail.com"
        "#search/rfc822msgid%3A%3Cmessage%40example.com%3E"
    )
    email.delivered_via_smtp = True
    email.message_id = None
    assert mail.visible_gmail_url(email, "candidate@gmail.com") is None


def test_legacy_gmail_message_uses_safe_sender_and_subject_search(monkeypatch) -> None:
    settings = SimpleNamespace(
        mail_server="smtp.example.test",
        mail_username="sender@example.test",
        mail_password="configured",
    )
    monkeypatch.setattr(mail, "get_settings", lambda: settings)
    email = EmailMessage(
        user_id=1,
        recipient_email="candidate@gmail.com",
        sender_email="recruiter@company.com",
        subject='Interview "next steps"',
        body="This private body must not be included",
        message_id=None,
        delivered_via_smtp=False,
    )
    url = mail.visible_gmail_url(email, "candidate@gmail.com")
    assert url == (
        "https://mail.google.com/mail/?authuser=candidate%40gmail.com"
        "#search/from%3Arecruiter%40company.com%20subject%3A%22Interview%20%22next%20steps%22%22"
    )
    assert "private" not in url

    monkeypatch.setattr(mail, "get_settings", lambda: SimpleNamespace(
        mail_server=None, mail_username=None, mail_password=None
    ))
    assert mail.visible_gmail_url(email, "candidate@gmail.com") is None
