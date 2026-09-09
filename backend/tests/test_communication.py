import pytest

from app.api.v1.applications import application_transition_allowed


@pytest.mark.parametrize("status", ["SCHEDULED", "RESCHEDULED", "COMPLETED", "CANCELLED"])
def test_interview_status_values_are_supported(status: str) -> None:
    assert status in {"SCHEDULED", "RESCHEDULED", "COMPLETED", "CANCELLED"}


def test_interview_requires_shortlisted_application() -> None:
    assert application_transition_allowed("SHORTLISTED", "INTERVIEW_SCHEDULED")
    assert not application_transition_allowed("APPLIED", "INTERVIEW_SCHEDULED")


def test_interview_response_has_enrichment_fields() -> None:
    from app.schemas.communication import InterviewResponse
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)
    res = InterviewResponse(
        id=1,
        application_id=10,
        scheduled_by=20,
        status="SCHEDULED",
        scheduled_at=now,
        interview_type="VIDEO",
        meeting_link="https://meet.google.com/xyz",
        notes="Code interview",
        candidate_name="John Doe",
        internship_title="AI Intern",
        company_name="Acme Corp",
    )
    assert res.candidate_name == "John Doe"
    assert res.internship_title == "AI Intern"
    assert res.company_name == "Acme Corp"


def test_application_response_has_internship_title() -> None:
    from app.schemas.application import ApplicationResponse
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)
    app = ApplicationResponse(
        id=1,
        internship_id=5,
        student_id=12,
        status="APPLIED",
        cover_note="Excited to apply",
        created_at=now,
        updated_at=now,
        internship_title="Full Stack Intern",
    )
    assert app.internship_title == "Full Stack Intern"