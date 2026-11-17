from datetime import date
from typing import Literal

SavedAvailability = Literal["OPEN", "CLOSED", "EXPIRED", "UNAVAILABLE"]


def saved_internship_availability(
    status: str,
    deadline: date,
    company_verified: bool,
    *,
    today: date | None = None,
) -> SavedAvailability:
    """Classify a saved internship for display and application eligibility."""
    if status == "CLOSED":
        return "CLOSED"
    if deadline < (today or date.today()):
        return "EXPIRED"
    if status == "PUBLISHED" and company_verified:
        return "OPEN"
    return "UNAVAILABLE"
