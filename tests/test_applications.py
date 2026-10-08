import pytest

from app.api.v1.applications import TRANSITIONS, application_transition_allowed


def test_all_application_status_transitions_are_explicit() -> None:
    assert application_transition_allowed("APPLIED", "UNDER_REVIEW")
    assert application_transition_allowed("UNDER_REVIEW", "SHORTLISTED")
    assert application_transition_allowed("SHORTLISTED", "INTERVIEW_SCHEDULED")
    assert application_transition_allowed("INTERVIEW_SCHEDULED", "SELECTED")
    assert application_transition_allowed("UNDER_REVIEW", "REJECTED")
    assert application_transition_allowed("INTERVIEW_SCHEDULED", "REJECTED")
    assert application_transition_allowed("APPLIED", "WITHDRAWN")


@pytest.mark.parametrize("current,target", [
    ("APPLIED", "SHORTLISTED"),
    ("APPLIED", "SELECTED"),
    ("SHORTLISTED", "SELECTED"),
    ("SELECTED", "REJECTED"),
    ("REJECTED", "UNDER_REVIEW"),
    ("WITHDRAWN", "UNDER_REVIEW"),
])
def test_invalid_application_transitions_are_rejected(current: str, target: str) -> None:
    assert not application_transition_allowed(current, target)
    assert current in TRANSITIONS