"""Database-backed operational settings for the Interview Studio."""

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import InterviewStudioSetting


DEFAULT_INTERVIEW_STUDIO_SETTINGS: dict[str, Any] = {
    "voice_enabled": True,
    "video_enabled": True,
    "recording_enabled": True,
    "retention_days": 30,
    "sessions_per_day": 5,
}


async def get_interview_studio_setting(
    db: AsyncSession,
    key: str,
) -> Any:
    row = await db.get(InterviewStudioSetting, key)
    if row is not None:
        return row.value
    return DEFAULT_INTERVIEW_STUDIO_SETTINGS[key]


async def interview_studio_feature_enabled(
    db: AsyncSession,
    key: str,
) -> bool:
    return bool(await get_interview_studio_setting(db, key))


async def list_interview_studio_settings(
    db: AsyncSession,
) -> dict[str, Any]:
    rows = (await db.execute(select(InterviewStudioSetting))).scalars().all()
    values = DEFAULT_INTERVIEW_STUDIO_SETTINGS.copy()
    values.update({row.key: row.value for row in rows})
    return values
