import pytest

from app.api.v1.applications import (
    TRANSITIONS,
    allowed_actions_for_status,
    allowed_next_statuses,
    application_transition_allowed,
)


def test_all_application_status_transitions_are_explicit() -> None:
    assert application_transition_allowed("APPLIED", "UNDER_REVIEW")
    assert application_transition_allowed("UNDER_REVIEW", "SHORTLISTED")
    assert application_transition_allowed("SHORTLISTED", "INTERVIEW_SCHEDULED")
    assert application_transition_allowed("INTERVIEW_SCHEDULED", "SELECTED")
    assert application_transition_allowed("UNDER_REVIEW", "REJECTED")
    assert application_transition_allowed("INTERVIEW_SCHEDULED", "REJECTED")
    assert application_transition_allowed("APPLIED", "WITHDRAWN")


def test_allowed_actions_are_derived_from_application_transition_map() -> None:
    assert allowed_actions_for_status("APPLIED") == ["MOVE_TO_REVIEW"]
    assert allowed_actions_for_status("UNDER_REVIEW") == ["SHORTLIST", "REJECT"]
    assert allowed_actions_for_status("SHORTLISTED") == ["SCHEDULE_INTERVIEW", "REJECT"]
    assert allowed_actions_for_status("INTERVIEW_SCHEDULED") == ["SELECT", "REJECT"]
    assert allowed_actions_for_status("SELECTED") == []
    assert allowed_actions_for_status("ACCEPTED") == []


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


@pytest.mark.parametrize("current,transitions", TRANSITIONS.items())
def test_allowed_next_statuses_match_transition_table(current: str, transitions: set[str]) -> None:
    assert set(allowed_next_statuses(current)) == transitions


@pytest.mark.parametrize("current", ["ACCEPTED", "REJECTED", "WITHDRAWN"])
def test_terminal_statuses_have_no_allowed_next_statuses(current: str) -> None:
    assert allowed_next_statuses(current) == []