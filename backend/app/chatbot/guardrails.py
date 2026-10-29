"""Input/output safety checks; this module has no application dependencies."""

import re

from .redaction import contains_secret


OUT_OF_SCOPE_REPLY = "I can help with InternSphere questions."
ADMIN_ONLY_REPLY = "Audit events are available only to InternSphere administrators."
INJECTION_REPLY = "I can’t follow instructions to ignore my safety rules or reveal private configuration. I can help with InternSphere."
SECRET_REPLY = "Please don’t share passwords, verification codes, tokens, or personal information here. I can’t process that message."
ABUSE_REPLY = "I can’t help with that request. I can only help with using InternSphere."

INJECTION_PATTERNS = (
    re.compile(r"\b(ignore|disregard|forget|bypass|override)\b.{0,60}\b(instructions|rules|safety|prompt|system|policy)\b", re.I),
    re.compile(r"\b(reveal|show|print|repeat|leak)\b.{0,60}\b(system prompt|instructions|configuration|api key|secret)\b", re.I),
    re.compile(r"\b(run|execute|query)\b.{0,30}\b(arbitrary|raw|unsanitized)\s+(sql|queries?)\b", re.I),
    re.compile(r"\b(role[- ]?play|pretend|act as|you are now|translate)\b.{0,70}\b(unrestricted|developer|system|outside|everything)\b", re.I),
    re.compile(r"\b(role[- ]?play|pretend|act as)\b.{0,70}\b(no|without)\b.{0,20}\b(safety|rules|restrictions)\b", re.I),
    re.compile(r"\btranslate\b.{0,80}\b(system prompt|instructions|rules|configuration)\b", re.I),
    re.compile(r"\b(jailbreak|DAN mode|developer message)\b", re.I),
)

PRIVATE_CROSS_ACCOUNT_PATTERN = re.compile(
    r"\b(another|other|someone else)\b.{0,40}\b(user|student|account|person|applicant)s?\b"
    r".{0,40}\b(data|application|profile|notification|interview)s?\b"
    r"|\b(show|tell|give|find|list)\b.{0,30}\b(another|other|someone else)\b.{0,30}"
    r"\b(user|student|company|account|person|applicant)s?\b.{0,30}"
    r"\b(data|application|profile|notification|interview)s?\b"
    r"|\b(?:show|list|find|give me)\b.{0,30}\b(?:all|every)\b.{0,20}\b(?:students?|users?|applicants?)\b"
    r"|\b(?:show|list|find|tell me about)\b.{0,30}\b[a-z][a-z'-]{1,30}'s\b.{0,20}"
    r"\b(?:applications?|profiles?|interviews?|notifications?)\b",
    re.I,
)

OUT_OF_SCOPE_PATTERNS = (
    re.compile(r"\b(write|draft|compose)\b.{0,40}\b(cover letter|essay|resume|cv)\b", re.I),
    re.compile(r"\b(write|compose|create|make)\b.{0,30}\b(poem|poetry|story|fiction)\b", re.I),
    re.compile(r"\b(medical|diagnos\w*|headache|medicine|politic\w*|election|vote|legal advice|lawyer|weather|recipe|joke|cryptocurrency|crypto prices)\b", re.I),
    re.compile(r"\b(history of|capital of|ancient history)\b", re.I),
    re.compile(r"\b(code|debug|programming help|python script|javascript function)\b", re.I),
    re.compile(r"\b(other website|another company|different company|google|facebook|linkedin)\b", re.I),
)

ACCOUNT_PATTERNS = (
    re.compile(r"\b(my|my own)\b.{0,50}\b(application|interview|message|profile|account|status|resume|internship)\b", re.I),
    re.compile(r"\bwhat is my\b", re.I),
)

ABUSE_PATTERNS = (re.compile(r"\b(kill|hurt|threaten)\b.{0,30}\b(recruiter|applicant|user|company)\b", re.I),)


def detect_injection(text: str) -> bool:
    return any(pattern.search(text) for pattern in INJECTION_PATTERNS)


def detect_account_specific(text: str) -> bool:
    if re.search(r"\bhow (?:do|can|should) i\b|\bhow to\b|\bsteps to\b", text, re.I):
        return False
    return any(pattern.search(text) for pattern in ACCOUNT_PATTERNS)


def detect_cross_account_request(text: str) -> bool:
    return bool(PRIVATE_CROSS_ACCOUNT_PATTERN.search(text))


def is_chatbot_capability_question(text: str) -> bool:
    return bool(
        re.search(r"\b(can|does|will)\b.{0,30}\b(chatbot|assistant)\b", text, re.I)
        and re.search(r"\b(cover letter|resume|account data)\b", text, re.I)
    )


def is_role_capability_question(text: str) -> bool:
    return bool(
        re.search(r"\bwhat is my role\b", text, re.I)
        or re.search(
            r"\bwhat can i do(?: here| on (?:this )?platform| with (?:my )?account)?\b",
            text,
            re.I,
        )
    )


def detect_abuse(text: str) -> bool:
    return any(pattern.search(text) for pattern in ABUSE_PATTERNS)


def output_is_safe(answer: str, allowed_routes: set[str]) -> bool:
    if (
        len(answer.split()) > 150
        or contains_secret(answer)
        or re.search(r"</?[A-Za-z][^>]*>", answer)
        or re.search(r"\]\(\s*(?:javascript|data):", answer, re.I)
    ):
        return False
    for url in re.findall(r"https?://\S+", answer, re.I):
        return False
    for route in re.findall(r"(?<![\w])/(?:[A-Za-z0-9._~-]+/?)+(?:\?[^\s]*)?", answer):
        if route.rstrip(".,)") not in allowed_routes:
            return False
    return True
