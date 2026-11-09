# -----------------------------------------------------------------------------
# Mailbox-related APIs for reading and processing user messages.
# -----------------------------------------------------------------------------

from html import escape
from html.parser import HTMLParser
from typing import Annotated
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select

from app.api.v1.dependencies import get_current_user
from app.api.v1.dependencies import DbSession
from app.models import EmailMessage, User
from app.services.mail import visible_gmail_url

router = APIRouter(tags=["mailbox"])

_ALLOWED_HTML_TAGS = {
    "a", "b", "blockquote", "br", "caption", "code", "dd", "div", "dl", "dt",
    "em", "h1", "h2", "h3", "h4", "hr", "i", "li", "ol", "p", "pre", "s",
    "small", "span", "strong", "sub", "sup", "table", "tbody", "td", "th",
    "thead", "tr", "u", "ul",
}
_VOID_HTML_TAGS = {"br", "hr"}
_BLOCKED_HTML_TAGS = {"iframe", "object", "script", "style", "svg", "template"}


class _EmailHTMLSanitizer(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.output: list[str] = []
        self.open_tags: list[str] = []
        self.blocked_tags: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        if self.blocked_tags:
            if tag in _BLOCKED_HTML_TAGS:
                self.blocked_tags.append(tag)
            return
        if tag in _BLOCKED_HTML_TAGS:
            self.blocked_tags.append(tag)
            return
        if tag not in _ALLOWED_HTML_TAGS:
            return
        safe_attrs: list[tuple[str, str]] = []
        for name, value in attrs:
            if value is None:
                continue
            name = name.lower()
            if tag == "a" and name == "href":
                if value.strip().lower().startswith(("https://", "http://", "mailto:")):
                    safe_attrs.append(("href", value))
            elif name in {"title", "colspan", "rowspan"}:
                safe_attrs.append((name, value))
        if tag == "a" and any(name == "href" for name, _ in safe_attrs):
            safe_attrs.extend((("rel", "noopener noreferrer"), ("target", "_blank")))
        rendered_attrs = "".join(
            f' {name}="{escape(value, quote=True)}"'
            for name, value in safe_attrs
        )
        self.output.append(f"<{tag}{rendered_attrs}>")
        if tag not in _VOID_HTML_TAGS:
            self.open_tags.append(tag)

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.handle_starttag(tag, attrs)
        if tag.lower() in self.open_tags:
            self.handle_endtag(tag)

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if self.blocked_tags:
            if tag == self.blocked_tags[-1]:
                self.blocked_tags.pop()
            return
        if tag not in self.open_tags:
            return
        while self.open_tags:
            opened = self.open_tags.pop()
            self.output.append(f"</{opened}>")
            if opened == tag:
                break

    def handle_data(self, data: str) -> None:
        if not self.blocked_tags:
            self.output.append(escape(data))

    def close(self) -> None:
        super().close()
        while self.open_tags:
            self.output.append(f"</{self.open_tags.pop()}>")


def _sanitize_email_html(value: str | None) -> str | None:
    if not value:
        return None
    sanitizer = _EmailHTMLSanitizer()
    sanitizer.feed(value)
    sanitizer.close()
    return "".join(sanitizer.output)


async def _get_user_emails(user: User, db: DbSession) -> list[dict]:
    """Return the current user?s mailbox messages in the API shape, including their visible Gmail links."""
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
            "gmail_url": visible_gmail_url(message, user.email),
            "created_at": message.created_at,
        }
        for message in messages
    ]


@router.get("/me/emails")
async def get_my_emails(user: Annotated[User, Depends(get_current_user)], db: DbSession) -> list[dict]:
    """Return only email records owned by the authenticated user."""
    return await _get_user_emails(user, db)


@router.get("/emails/{email_id}")
async def get_my_email(
    email_id: int,
    user: Annotated[User, Depends(get_current_user)],
    db: DbSession,
) -> dict:
    """Return one sanitized email only when it belongs to the authenticated user."""
    email = await db.scalar(
        select(EmailMessage).where(
            EmailMessage.id == email_id,
            EmailMessage.user_id == user.id,
        )
    )
    if email is None:
        raise HTTPException(status_code=404, detail="Email not found")
    return {
        "id": email.id,
        "to": email.recipient_email,
        "from": email.sender_email,
        "subject": email.subject,
        "message_type": email.message_type,
        "body": email.body,
        "html": _sanitize_email_html(email.html),
        "gmail_url": visible_gmail_url(email, user.email),
        "created_at": email.created_at,
    }


@router.get("/mailbox/my", include_in_schema=False)
async def get_legacy_my_emails(user: Annotated[User, Depends(get_current_user)], db: DbSession) -> list[dict]:
    """Compatibility alias for the user-scoped mailbox endpoint."""
    return await _get_user_emails(user, db)
