# -----------------------------------------------------------------------------
# Reporting endpoints used to generate or fetch reports for administrators and users.
# -----------------------------------------------------------------------------

from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy import select

from app.api.v1.dependencies import DbSession, get_current_user
from app.models import Report, User, UserRole
from app.schemas.admin import ReportCreate, ReportResponse
from app.services.notify import notify

router = APIRouter(prefix="/reports", tags=["reports"])


@router.post("", response_model=ReportResponse, status_code=status.HTTP_201_CREATED)
async def submit_report(
    data: ReportCreate,
    user: Annotated[User, Depends(get_current_user)],
    db: DbSession,
) -> Report:
    report = Report(
        reporter_id=user.id,
        reported_user_id=data.reported_user_id,
        internship_id=data.internship_id,
        reason=data.reason,
        status="OPEN",
    )
    db.add(report)
    admins = await db.scalars(select(User).where(User.role == UserRole.ADMIN))
    for admin in admins:
        await notify(
            db,
            admin.id,
            "ABUSE_REPORT",
            "New abuse report",
            "A new abuse report has been submitted for review.",
        )
    await db.commit()
    await db.refresh(report)
    return report
