import pytest

from app.api.v1.internships import transition_allowed


@pytest.mark.parametrize("current,target,allowed", [
    ("DRAFT", "PENDING_APPROVAL", True),
    ("PENDING_APPROVAL", "PUBLISHED", True),
    ("PUBLISHED", "CLOSED", True),
    ("DRAFT", "PUBLISHED", False),
    ("CLOSED", "PUBLISHED", False),
])
def test_internship_lifecycle(current: str, target: str, allowed: bool) -> None:
    assert transition_allowed(current, target) is allowed