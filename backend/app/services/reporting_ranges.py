"""Shared UTC lookback boundaries for dashboard and report queries."""

from datetime import datetime, timedelta, timezone


_RANGE_DAYS = {
    "7": 7,
    "7d": 7,
    "14d": 14,
    "30": 30,
    "30d": 30,
    "90": 90,
    "90d": 90,
}


def reporting_range_cutoff(
    range_value: str | None,
    *,
    now: datetime | None = None,
) -> datetime | None:
    """Return the UTC start of a supported rolling range, or None for all time."""
    if range_value in (None, "", "all"):
        return None
    days = _RANGE_DAYS.get(range_value)
    if days is None:
        raise ValueError(f"Unsupported reporting range: {range_value}")
    reference = now or datetime.now(timezone.utc)
    if reference.tzinfo is None:
        reference = reference.replace(tzinfo=timezone.utc)
    return reference - timedelta(days=days)
