"""Deterministic intent and retrieval-based scope decisions."""

from dataclasses import dataclass
import re

from .guardrails import (
    ABUSE_REPLY,
    ADMIN_ONLY_REPLY,
    INJECTION_REPLY,
    OUT_OF_SCOPE_REPLY,
    SECRET_REPLY,
    detect_abuse,
    detect_account_specific,
    detect_cross_account_request,
    detect_injection,
    is_chatbot_capability_question,
    OUT_OF_SCOPE_PATTERNS,
)
from .redaction import contains_secret
from .providers.base import Passage

INTENT_TERMS = {
    "internsphere", "internship", "internships", "application", "applications", "interview",
    "interviews", "notification", "notifications", "mailbox", "message", "messages", "profile",
    "resume", "saved", "company", "companies", "posting", "postings", "recruiter", "admin",
    "verification", "verify", "login", "log", "password", "privacy", "cookie", "cookies",
    "status", "timeline", "applicant", "applicants", "search", "filter", "assessment", "badge",
    "skills", "account", "register", "registration", "mfa", "multifactor", "sign", "out",
    "platform", "student", "students", "employer", "employers", "opportunity", "opportunities",
    "chatbot", "help",
}
ADMIN_INTENT_TERMS = {
    "audit", "audits", "event", "events", "action", "actions", "approval", "approvals",
    "rejection", "rejections", "analytics", "report", "reports", "setting", "settings",
    "management", "manage", "blocked", "unblocked", "reinstated", "moderation",
}
ADMIN_AUDIT_PATTERN = re.compile(
    r"\b(audits?|admin(?:istrator)?[- ]actions?|admin[- ]events?)\b", re.I
)
ADMIN_ONLY_PATTERNS = (
    re.compile(r"\b(?:admin|administrator)\s+(?:dashboard|pages?|tools?|reports?|settings?)\b", re.I),
    re.compile(r"\b(?:moderate|moderation|pending posting approvals?|pending company verification requests?|company verification queue|user management)\b", re.I),
    re.compile(
        r"\b(?:archive|restore|permanently delete|delete|import|manage|edit)\b.{0,40}"
        r"\b(?:skill assessment )?(?:topics?|question bank|assessment questions?)\b"
        r"|\b(?:skill assessment )?(?:topics?|question bank|assessment questions?)\b.{0,40}"
        r"\b(?:archive|restore|permanently delete|delete|import|manage|edit)\b",
        re.I,
    ),
)


@dataclass(frozen=True)
class ScopeDecision:
    category: str
    in_scope: bool
    refused: bool
    refusal_reason: str | None = None
    account_specific: bool = False


def is_admin_audit_query(text: str) -> bool:
    """Return whether text refers to administrator audit records or actions."""
    return bool(ADMIN_AUDIT_PATTERN.search(text))


def is_how_to_question(text: str) -> bool:
    """Distinguish workflow instructions from requests for live records."""
    return bool(
        re.search(
            r"\bhow\s+do\b|\bhow\s+(?:can|should)\s+i\b|\bwhere\s+can\s+i\b|"
            r"\bwhere\s+(?:are|is)\b|\bwhen\s+can\s+i\b|\bcan\s+i\b|\bsteps?\s+to\b",
            text,
            re.I,
        )
    )


def is_admin_only_query(text: str) -> bool:
    """Identify administrative workflows that must not be answered for other roles."""
    return bool(ADMIN_AUDIT_PATTERN.search(text) or any(pattern.search(text) for pattern in ADMIN_ONLY_PATTERNS))


def decide_scope(
    text: str,
    passages: list[Passage],
    minimum_score: float,
    role: str = "guest",
) -> ScopeDecision:
    """Classify safety, role, account-specific, and knowledge-match scope in precedence order."""
    if contains_secret(text):
        return ScopeDecision("credential", False, True, "credential_detected")
    if detect_abuse(text):
        return ScopeDecision("abuse", False, True, "abusive_request")
    if detect_injection(text):
        return ScopeDecision("injection", False, True, "prompt_injection")
    if detect_cross_account_request(text):
        return ScopeDecision("privacy", False, True, "cross_account_request")
    if (
        not is_chatbot_capability_question(text)
        and any(pattern.search(text) for pattern in OUT_OF_SCOPE_PATTERNS)
    ):
        return ScopeDecision("out_of_scope", False, True, "outside_product_scope")

    tokens = set(re.findall(r"[a-z0-9]+", text.lower()))
    role_name = role.lower()
    if is_admin_only_query(text) and role_name != "admin":
        return ScopeDecision("admin_only", False, True, "role_restricted")
    has_intent = bool(tokens & INTENT_TERMS) or (
        role_name == "admin" and bool(tokens & ADMIN_INTENT_TERMS)
    )
    has_retrieval = bool(passages and passages[0].score >= minimum_score)
    account_specific = detect_account_specific(text)
    if account_specific:
        return ScopeDecision("account_specific", True, False, account_specific=True)
    if has_intent or has_retrieval:
        return ScopeDecision("in_scope", True, False)
    return ScopeDecision("out_of_scope", False, True, "no_product_intent_or_knowledge_match")


def fixed_reply(decision: ScopeDecision, role: str = "guest") -> str:
    """Choose the deterministic refusal or role-specific guidance for a scope decision."""
    if decision.category == "credential":
        return SECRET_REPLY
    if decision.category == "injection":
        return INJECTION_REPLY
    if decision.category == "abuse":
        return ABUSE_REPLY
    if decision.category == "admin_only":
        return ADMIN_ONLY_REPLY
    if decision.category == "privacy":
        return "I can only retrieve information for your own account and your role. Try asking about your own applications, profile, or notifications."
    role_examples = {
        "admin": "Try “Explain recent audit events,” “How do I review pending postings?” or “Show company verification status.”",
        "company": "Try asking how to manage postings, review applicants, or update your company profile.",
        "student": "Try asking how to apply, manage notifications, or update your student profile.",
    }
    examples = role_examples.get(role.lower(), "Try asking about applications, profiles, or platform features.")
    if role.lower() == "admin":
        return f"I can help with InternSphere admin tasks. {examples}"
    return f"{OUT_OF_SCOPE_REPLY} {examples}"
