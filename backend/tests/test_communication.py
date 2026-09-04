import pytest

from app.api.v1.applications import application_transition_allowed


@pytest.mark.parametrize("status", ["SCHEDULED", "RESCHEDULED", "COMPLETED", "CANCELLED"])
def test_interview_status_values_are_supported(status: str) -> None:
    assert status in {"SCHEDULED", "RESCHEDULED", "COMPLETED", "CANCELLED"}


def test_interview_requires_shortlisted_application() -> None:
    assert application_transition_allowed("SHORTLISTED", "INTERVIEW_SCHEDULED")
    assert not application_transition_allowed("APPLIED", "INTERVIEW_SCHEDULED")