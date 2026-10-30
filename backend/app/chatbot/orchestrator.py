"""Role-aware routing between help retrieval and approved live-data tools."""

from dataclasses import dataclass
import re

from fastapi import HTTPException

from app.chatbot.guardrails import (
    OUT_OF_SCOPE_PATTERNS,
    detect_cross_account_request,
    is_chatbot_capability_question,
)
@dataclass(frozen=True)
class Intent:
    category: str
    tool_name: str | None = None
    args: tuple[tuple[str, int], ...] = ()
    refusal_reason: str | None = None


def _internship_id(message: str) -> int | None:
    """Extract a positive signed-32-bit internship/posting/role identifier, if present."""
    match = re.search(r"\b(?:internship|posting|role)\s*#?\s*(\d+)\b", message, re.I)
    if not match:
        return None
    value = int(match.group(1))
    if value < 1 or value > 2_147_483_647:
        raise HTTPException(status_code=422, detail="Invalid internship identifier.")
    return value


def classify_intent(message: str, role: str) -> Intent:
    """Choose one supported route; never infer or construct arbitrary tool names."""
    normalized_role = role.lower()
    if detect_cross_account_request(message):
        return Intent("out_of_scope", refusal_reason="cross_account_request")
    if (
        not is_chatbot_capability_question(message)
        and any(pattern.search(message) for pattern in OUT_OF_SCOPE_PATTERNS)
    ):
        return Intent("out_of_scope", refusal_reason="outside_product_scope")

    text = message.casefold()
    if re.search(r"\b(audits?|admin(?:istrator)?[- ]actions?|admin[- ]events?)\b", text):
        requests_events = re.search(
            r"\b(recent|latest|last|explain|summarize|show|what happened|who did)\b",
            text,
        )
        if requests_events:
            if normalized_role != "admin":
                return Intent("out_of_scope", refusal_reason="role_restricted")
            return Intent("live_data", "admin_audit_events")

    def live_or_both(name: str, args: tuple[tuple[str, int], ...] = ()) -> Intent:
        """Select live-data routing and include docs when the wording asks for explanation too."""
        combined = re.search(
            r"\b(and also|also explain|and explain|and how|and what|what does .* mean|along with)\b",
            text,
        )
        return Intent("both" if combined else "live_data", name, args)

    if normalized_role == "student":
        if re.search(
            r"\b(find|recommend|suggest|show|list)\b.{0,50}\b(internships?|roles?|opportunities)\b"
            r".{0,50}\b(match(?:ing)?|fit)\b.{0,30}\b(my profile|my skills|my background)\b"
            r"|\b(internships?|roles?)\b.{0,40}\b(match(?:ing)?|fit)\b.{0,30}\bmy profile\b",
            text,
        ):
            return live_or_both("student_recommended_internships")
        if re.search(r"\b(my saved|saved internships|saved roles|my bookmarks)\b", text):
            return live_or_both("student_saved_internships")
        if re.search(
            r"\b(what is|show|list|check|tell me|give me)\b.{0,40}\bmy\b.{0,50}"
            r"\b(application|applications|submission|status|timeline)\b"
            r"|\bwhere\b.{0,30}\bmy\b.{0,30}\bapplications?\b"
            r"|\bhow many\b.{0,30}\bapplications?\b.{0,30}\b(i have|i submitted)\b"
            r"|\bstatus of my\b.{0,30}\b(application|submission)\b",
            text,
        ):
            return live_or_both("student_applications")
        if re.search(
            r"\b(my|mine|what are my|which)\b.{0,40}\b(interview|interviews)\b"
            r"|\b(any|what|which)\b.{0,30}\b(interviews?)\b.{0,30}\b(coming up|upcoming|scheduled)\b"
            r"|\bupcoming interviews\b",
            text,
        ):
            return live_or_both("student_interviews")
        if re.search(r"\b(my|mine|show my)\b.{0,40}\b(notification|notifications|alerts)\b", text):
            return live_or_both("student_notifications")
        if re.search(r"\b(profile completeness|how complete is my profile|what is missing from my profile)\b", text):
            return live_or_both("student_profile_completeness")

    if normalized_role == "company":
        if re.search(
            r"\b(who applied|who are my applicants|list applicants|show applicants|applicants for|"
            r"candidates for|show applications to my)\b",
            text,
        ):
            args = (("internship_id", value),) if (value := _internship_id(message)) else ()
            return live_or_both("company_applicants", args)
        if re.search(r"\b(my shortlisted|show shortlisted|who did i shortlist|shortlisted candidates?|shortlisted applicants?)\b", text):
            args = (("internship_id", value),) if (value := _internship_id(message)) else ()
            return live_or_both("company_shortlisted", args)
        if re.search(
            r"\b(my hiring pipeline|pipeline counts|how many in each stage|"
            r"how many applications are in each stage)\b",
            text,
        ):
            return live_or_both("company_pipeline")
        if re.search(
            r"\b(my internships|my internship postings|my postings|status of my (?:internship|posting)|"
            r"status of (?:internship|posting)|internship status)\b",
            text,
        ):
            args = (("internship_id", value),) if (value := _internship_id(message)) else ()
            return live_or_both("company_internships", args)
        if re.search(
            r"\b(my scheduled interviews|my interviews|which interviews have i scheduled)\b",
            text,
        ):
            return live_or_both("company_interviews")

    if normalized_role == "admin":
        if re.search(
            r"\b(how many|count|number of)\b.{0,60}\b(postings?|internships?)\b.{0,40}\b(pending|await(?:ing)?)\b"
            r"|\b(how many|count|number of)\b.{0,60}\b(pending|await(?:ing)?)\b.{0,40}\b(postings?|internships?)\b"
            r"|\bpending posting count\b",
            text,
        ):
            return live_or_both("admin_pending_approvals")
        if re.search(
            r"\b(how many|count|number of|pending verification)\b.{0,60}\bverifications?\b"
            r"|\b(company|companies)\b.{0,30}\b(verification|verified)\b"
            r"|\b(company|companies)\b.{0,30}\bverification counts?\b"
            r"|\bverification counts?\b",
            text,
        ):
            return live_or_both("admin_verification_counts")
        if re.search(r"\b(platform analytics|how many users|user and company counts|platform counts)\b", text):
            return live_or_both("admin_analytics")

    return Intent("rag_help")
