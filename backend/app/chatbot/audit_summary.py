"""Privacy-preserving summaries of recent administrator audit actions."""

from collections import Counter
from collections.abc import Iterable


_AUDIT_LABELS = {
    "posting_approved": ("posting approved", "postings approved"),
    "posting_rejected": ("posting rejected", "postings rejected"),
    "posting_removed": ("posting removed", "postings removed"),
    "company_verified": ("company verified", "companies verified"),
    "company_rejected": ("company rejected", "companies rejected"),
    "admin_downloaded_company_document": (
        "company document downloaded",
        "company documents downloaded",
    ),
    "skill_topic_restored": ("skill topic restored", "skill topics restored"),
    "skill_topic_archived": ("skill topic archived", "skill topics archived"),
    "skill_questions_imported": ("skill question set imported", "skill question sets imported"),
    "report_resolved": ("report resolved", "reports resolved"),
    "user_suspended": ("user suspended", "users suspended"),
    "user_reinstated": ("user reinstated", "users reinstated"),
}


def summarize_audit_actions(actions: Iterable[str]) -> str:
    """Return a short aggregate without actor, target, or other personal identifiers."""
    counts = Counter(action.casefold() for action in actions)
    items = []
    for action, (singular, plural) in _AUDIT_LABELS.items():
        count = counts.get(action, 0)
        if count:
            items.append(f"{count} {singular if count == 1 else plural}")
    if not items:
        return "No tracked admin changes in the last 7 days."
    return "Last 7 days: " + ", ".join(items) + "."
