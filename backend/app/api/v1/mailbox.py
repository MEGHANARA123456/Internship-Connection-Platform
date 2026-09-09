from typing import Annotated
from fastapi import APIRouter, Depends, Query

from app.api.v1.dependencies import get_current_user
from app.models import User
from app.services.mail import get_emails_for_recipient

router = APIRouter(prefix="/mailbox", tags=["mailbox"])


@router.get("/my")
async def get_my_emails(user: Annotated[User, Depends(get_current_user)]) -> list[dict]:
    """Retrieve all simulated and delivered emails addressed to the authenticated user."""
    return get_emails_for_recipient(user.email)


@router.get("/public")
async def get_public_emails(email: str = Query(..., description="Recipient email to query")) -> list[dict]:
    """Query recent emails by recipient address for OTP retrieval during forgot password."""
    return get_emails_for_recipient(email)
