import logging
import httpx

from app.core.config import get_settings

logger = logging.getLogger(__name__)


async def send_dev_email(to: str, subject: str, body: str) -> None:
    settings = get_settings()
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"http://{settings.mailpit_host}:8025/api/v1/send",
                json={
                    "From": {"Email": "noreply@internship.local", "Name": "Internship Platform"},
                    "To": [{"Email": to}],
                    "Subject": subject,
                    "Text": body,
                },
            )
            if resp.status_code >= 400:
                logger.warning("Mailpit returned status %s: %s", resp.status_code, resp.text)
    except Exception as exc:
        logger.warning("Failed to send email to %s: %s", to, exc)