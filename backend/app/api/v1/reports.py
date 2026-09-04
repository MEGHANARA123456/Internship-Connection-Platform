from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.dependencies import DbSession, get_current_user
from app.models import Report, User
from app.schemas.admin import ReportCreate, ReportResponse

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
    await db.commit()
    await db.refresh(report)
    return report
