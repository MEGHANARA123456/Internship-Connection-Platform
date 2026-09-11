from dataclasses import dataclass
import re


PERSONAL_EMAIL_DOMAINS = frozenset(
    {
        "gmail.com",
        "yahoo.com",
        "outlook.com",
        "hotmail.com",
        "live.com",
        "icloud.com",
        "proton.me",
        "protonmail.com",
        "rediffmail.com",
    }
)

DISPOSABLE_EMAIL_DOMAINS = frozenset(
    {
        "10minutemail.com",
        "disposable-domain.com",
        "guerrillamail.com",
        "mailinator.com",
        "tempmail.com",
        "throwawaymail.com",
        "yopmail.com",
    }
)

RECRUITER_EMAIL_KEYWORDS = frozenset(
    {"recruiter", "recruitment", "hr", "hiring", "careers", "career", "talent", "admin"}
)

_EMAIL_PATTERN = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
_INSTITUTION_SUFFIXES = (".edu", ".edu.", ".ac.", ".ac.uk", ".ac.in", ".res.in")


@dataclass(frozen=True)
class EmailValidationResult:
    email: str
    domain: str
    classification: str
    recruiter_signal: bool


def validate_email_format(email: str) -> str:
    clean_email = email.strip().lower()
    if len(clean_email) > 254 or not _EMAIL_PATTERN.fullmatch(clean_email):
        raise ValueError("Please enter a valid email address.")
    local_part, domain = clean_email.rsplit("@", 1)
    if len(local_part) > 64 or domain.startswith(".") or domain.endswith(".") or ".." in clean_email:
        raise ValueError("Please enter a valid email address.")
    return clean_email


def _domain(email: str) -> str:
    return email.rsplit("@", 1)[1]


def is_personal_email(email: str) -> bool:
    return _domain(validate_email_format(email)) in PERSONAL_EMAIL_DOMAINS


def is_disposable_email(email: str) -> bool:
    return _domain(validate_email_format(email)) in DISPOSABLE_EMAIL_DOMAINS


def is_institution_email(email: str) -> bool:
    domain = _domain(validate_email_format(email))
    return domain.endswith(_INSTITUTION_SUFFIXES) or any(
        marker in domain for marker in ("college", "university", "campus", "institute")
    )


def is_organization_email(email: str) -> bool:
    return not is_personal_email(email) and not is_disposable_email(email)


def classify_email(email: str) -> EmailValidationResult:
    clean_email = validate_email_format(email)
    domain = _domain(clean_email)
    if is_disposable_email(clean_email):
        classification = "DISPOSABLE_EMAIL"
    elif is_personal_email(clean_email):
        classification = "PERSONAL_EMAIL"
    elif is_institution_email(clean_email):
        classification = "INSTITUTION_EMAIL"
    else:
        classification = "UNKNOWN_ORGANIZATION_EMAIL"
    local_part = clean_email.split("@", 1)[0]
    recruiter_signal = any(keyword in local_part.split(".") for keyword in RECRUITER_EMAIL_KEYWORDS)
    return EmailValidationResult(clean_email, domain, classification, recruiter_signal)


def validate_student_email(email: str) -> EmailValidationResult:
    result = classify_email(email)
    if result.classification == "DISPOSABLE_EMAIL":
        raise ValueError("Please use a valid personal or institutional email address.")
    return result


def validate_organization_email(email: str) -> EmailValidationResult:
    result = classify_email(email)
    if result.classification in {"PERSONAL_EMAIL", "DISPOSABLE_EMAIL"}:
        raise ValueError("Please use your official company or institute email address.")
    return result