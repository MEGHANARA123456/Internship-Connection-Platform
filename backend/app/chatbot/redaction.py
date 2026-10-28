"""Conservative PII and credential detection for model-bound text."""

import re


REDACTIONS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("URL_TOKEN", re.compile(r"https?://[^\s/?#]+(?:[/?#][^\s]*)?(?:token|key|code|secret)=[^\s&#]+", re.I)),
    ("JWT", re.compile(r"\beyJ[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\b")),
    ("EMAIL", re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.I)),
    ("IP", re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")),
    ("PHONE", re.compile(r"(?<!\w)(?:\+?\d[\d ().-]{7,}\d)(?!\w)")),
    ("CARD", re.compile(r"(?<!\d)(?:\d[ -]*?){13,19}(?!\d)")),
    ("LONG_RANDOM", re.compile(r"\b(?=[A-Za-z0-9_-]{24,}\b)(?=.*[A-Z])(?=.*[a-z])(?=.*\d)[A-Za-z0-9_-]+\b")),
)

SECRET_CONTEXTS = (
    re.compile(r"\b(?:password|passwd|pwd)\s*(?:is|:|=)\s*\S+", re.I),
    re.compile(r"\b(?:otp|one[- ]time (?:password|code)|verification code|security code)\s*(?:is|:|=)?\s*\d{4,10}\b", re.I),
    re.compile(r"\b(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|secret)\s*(?:is|:|=)\s*\S+", re.I),
    re.compile(r"\b(?:ssn|national id|passport number)\s*(?:is|:|=)?\s*[A-Z0-9 -]{6,}\b", re.I),
    re.compile(r"\b(?:cookie|session cookie)\s*(?:is|:|=)\s*\S+", re.I),
    re.compile(r"\bBearer\s+[A-Za-z0-9._~+/=-]{12,}", re.I),
    re.compile(r"\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,})\b"),
    re.compile(r"\b\d{3}-\d{2}-\d{4}\b"),
)


def _is_luhn_card(value: str) -> bool:
    digits = re.sub(r"\D", "", value)
    if not 13 <= len(digits) <= 19:
        return False
    total = 0
    parity = len(digits) % 2
    for index, char in enumerate(digits):
        digit = int(char)
        if index % 2 == parity:
            digit *= 2
            if digit > 9:
                digit -= 9
        total += digit
    return total % 10 == 0


def contains_secret(text: str) -> bool:
    if any(pattern.search(text) for pattern in SECRET_CONTEXTS):
        return True
    for name, pattern in REDACTIONS:
        for match in pattern.finditer(text):
            if name != "CARD" or _is_luhn_card(match.group()):
                return True
    return False


def redact(text: str) -> str:
    result = text
    result = re.sub(r"\b(?:password|passwd|pwd)\s*(?:is|:|=)\s*\S+", "[PASSWORD]", result, flags=re.I)
    result = re.sub(
        r"\b(?:otp|one[- ]time (?:password|code)|verification code|security code)\s*(?:is|:|=)?\s*\d{4,10}\b",
        "[OTP]",
        result,
        flags=re.I,
    )
    result = re.sub(r"\b(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|secret)\s*(?:is|:|=)\s*\S+", "[TOKEN]", result, flags=re.I)
    result = re.sub(r"\b(?:ssn|national id|passport number)\s*(?:is|:|=)?\s*[A-Z0-9 -]{6,}\b", "[NATIONAL_ID]", result, flags=re.I)
    result = re.sub(r"\b(?:cookie|session cookie)\s*(?:is|:|=)\s*\S+", "[COOKIE]", result, flags=re.I)
    result = re.sub(r"\bBearer\s+[A-Za-z0-9._~+/=-]{12,}", "Bearer [TOKEN]", result, flags=re.I)
    result = re.sub(r"\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,})\b", "[API_KEY]", result)
    result = re.sub(r"\b\d{3}-\d{2}-\d{4}\b", "[NATIONAL_ID]", result)
    for name, pattern in REDACTIONS:
        if name == "CARD":
            result = pattern.sub(lambda match: "[CARD]" if _is_luhn_card(match.group()) else match.group(), result)
        else:
            result = pattern.sub(f"[{name}]", result)
    return result
