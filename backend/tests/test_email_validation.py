import pytest

from app.services.email_validation import (
    classify_email,
    validate_email_format,
    validate_organization_email,
    validate_student_email,
)


@pytest.mark.parametrize("email", ["student@gmail.com", "student@yahoo.com", "student@college.edu", "student@university.edu"])
def test_student_email_policy_accepts_personal_and_institutional(email: str):
    assert validate_student_email(email).email == email


@pytest.mark.parametrize("email", ["student@disposable-domain.com", "student@tempmail.com", "invalid-email"])
def test_student_email_policy_rejects_disposable_or_invalid(email: str):
    with pytest.raises(ValueError):
        validate_student_email(email)


@pytest.mark.parametrize("email", ["hr@gmail.com", "recruiter@yahoo.com", "recruiter@tempmail.com"])
def test_organization_email_policy_rejects_personal_or_disposable(email: str):
    with pytest.raises(ValueError):
        validate_organization_email(email)


@pytest.mark.parametrize("email", ["recruiter@company.com", "hr@company.com", "contact@company.com", "admin@university.edu", "recruitment@institute.ac.in"])
def test_organization_email_policy_accepts_organization_domains(email: str):
    assert validate_organization_email(email).email == email


def test_email_normalization_and_classification():
    assert validate_email_format("  Meghana@Gmail.com ") == "meghana@gmail.com"
    assert classify_email("hr@company.com").recruiter_signal is True
    assert classify_email("contact@company.com").recruiter_signal is False