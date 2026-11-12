"""Role-aware routing between help retrieval and approved live-data tools."""

from dataclasses import dataclass
from functools import lru_cache
import math
import re
import asyncio
import logging

from fastapi import HTTPException

from app.chatbot.guardrails import (
    OUT_OF_SCOPE_PATTERNS,
    detect_cross_account_request,
    is_chatbot_capability_question,
)
from app.chatbot.scope import is_admin_only_query, is_how_to_question
from app.chatbot.rag.embeddings import embed_texts

logger = logging.getLogger("internsphere.chatbot.intent")
_FOLLOWUP = re.compile(
    r"^(and|also|what about|how about|why|what if|then|so)\b"
    r"|\b(that|it|this|those|these|them|same)\b",
    re.IGNORECASE,
)

def _edit_distance_at_most_one(left: str, right: str) -> bool:
    """Match one insertion, deletion, or substitution without fuzzy-matching short words."""
    if left == right:
        return True
    if len(left) < 5 or len(right) < 5 or abs(len(left) - len(right)) > 1:
        return False
    if len(left) > len(right):
        left, right = right, left
    previous = 0
    for index, character in enumerate(left):
        if character == right[index + previous]:
            continue
        if previous:
            return False
        previous = 1
        if len(left) == len(right):
            continue
    return True


def _normalize_intent_text(message: str) -> str:
    """Normalize common informal terms and one-character typos for stable intent routing."""
    words = re.findall(r"[a-z0-9]+", message.casefold())
    canonical = {
        "shortlisted": "shortlist",
        "scheduled": "schedule",
        "scheduling": "schedule",
        "interviews": "interview",
        "notifications": "notification",
        "alerts": "notification",
        "bell": "notification",
        "attended": "completed",
        "taken": "completed",
        "took": "completed",
        "apps": "application",
        "saved": "save",
        "shortlistd": "shortlist",
        "intervew": "interview",
        "notifcation": "notification",
    }
    known_terms = {"shortlist", "interview", "notification", "application", "assessment"}
    normalized = []
    for word in words:
        value = canonical.get(word, word)
        if value == word:
            value = next(
                (term for term in known_terms if _edit_distance_at_most_one(word, term)),
                value,
            )
        normalized.append(value)
    return " ".join(normalized)
@dataclass(frozen=True)
class Intent:
    category: str
    tool_name: str | None = None
    args: tuple[tuple[str, int], ...] = ()
    refusal_reason: str | None = None
    needs_clarification: str | None = None


def resolve_followup(
    message: str,
    history: list[tuple[str, str]],
    page: str,
) -> str:
    """Use only the last user question to resolve a short, genuine follow-up."""
    if (
        not history
        or len(message.split()) > 7
        or re.match(
            r"^\s*(how do i|how can i|where can i|when can i|can i)\b",
            message,
            re.IGNORECASE,
        )
        or not _FOLLOWUP.search(message)
    ):
        return message
    last_user = next(
        (content[:200] for role, content in reversed(history) if role == "user"),
        "",
    )
    return f"{last_user} Follow-up: {message}" if last_user else message


INTENT_EXAMPLES = {
    "admin": {
        "admin_company_counts": (
            "How many companies are registered?",
            "Show verified and pending company accounts.",
            "How many companies are on the platform?",
        ),
        "admin_student_counts": (
            "How many students are active?",
            "Show the total student account count.",
            "How many student users are registered?",
        ),
        "admin_posting_counts": (
            "What is the total number of internship postings?",
            "How many published, pending and rejected jobs are there?",
            "Count live internship posts.",
        ),
        "admin_today_activity": (
            "Show today's platform activity.",
            "How many applications and signups happened today?",
            "Summarize activity for today.",
        ),
        "admin_recent_registrations": (
            "What are the most recent user registrations?",
            "Show the last five signups.",
            "List new accounts created recently.",
        ),
        "admin_recent_posting_changes": (
            "What changes were made to internship postings recently?",
            "Show recent job posting audit changes.",
        ),
        "admin_recent_posting_deletions": (
            "Has an internship been deleted recently?",
            "Were any draft internships deleted?",
            "Can Audit Logs confirm recent internship deletions?",
        ),
        "admin_security_events": (
            "Are there any suspicious activities or failed login attempts?",
            "Show security events and unsuccessful sign-ins.",
            "Are failed logins recorded?",
        ),
        "admin_chatbot_low_confidence_questions": (
            "Which chatbot questions did not get a confident answer?",
            "Show recent unanswered chatbot questions.",
            "What low-confidence questions need help content?",
        ),
        "admin_audit_events": (
            "Show recent admin activities.",
            "What did administrators change recently?",
            "Show recent audit events.",
        ),
    },
    "student": {
        "student_applications": (
            "How many applications do I have?",
            "Show my application status.",
            "Where can I see my submissions?",
        ),
        "student_interviews": (
            "Any interviews coming up?",
            "Show my upcoming interviews.",
            "Do I have a scheduled interview?",
        ),
        "student_saved_internships": (
            "How many internships have I saved?",
            "Show my saved opportunities.",
            "List my bookmarked internships.",
        ),
        "public_open_internships_count": (
            "How many open internships are currently available?",
            "Show live opportunities from verified companies.",
            "How many current postings can students apply to?",
        ),
    },
    "guest": {
        "public_open_internships_count": (
            "How many open internships are currently available?",
            "Show live opportunities from verified companies.",
            "How many current postings are on the platform?",
        ),
    },
    "company": {
        "company_applicants": (
            "How many applicants do I have?",
            "Show applicants for my internship.",
            "Which candidates applied to my posting?",
        ),
        "company_shortlisted": (
            "How many candidates have I shortlisted?",
            "Show my shortlisted applicants.",
            "List shortlisted candidates.",
        ),
        "company_pipeline": (
            "Show my hiring pipeline counts.",
            "How many applications are in each stage?",
            "Summarize my candidate pipeline.",
        ),
        "company_internships": (
            "Show my active internship postings.",
            "How many postings do I have?",
            "List the status of my internships.",
        ),
        "company_interviews": (
            "Show my upcoming interviews.",
            "How many interviews have I scheduled?",
            "List my scheduled interviews.",
        ),
    },
}


@lru_cache(maxsize=2)
def _intent_examples_vectors(model_name: str) -> tuple[tuple[str, str, tuple[float, ...]], ...]:
    flattened = tuple(
        (role, tool_name, example)
        for role, tools in INTENT_EXAMPLES.items()
        for tool_name, questions in tools.items()
        for example in questions
    )
    vectors = embed_texts([question for _, _, question in flattened], model_name)
    return tuple(
        (role, tool_name, tuple(vector))
        for (role, tool_name, _), vector in zip(flattened, vectors)
    )


def _internship_id(message: str) -> int | None:
    """Extract a positive signed-32-bit internship/posting/role identifier, if present."""
    match = re.search(
        r"\b(?:internship|posting|role)\s*#?\s*(\d+)\b",
        message,
        re.IGNORECASE,
    )
    if not match:
        return None
    value = int(match.group(1))
    if value < 1 or value > 2_147_483_647:
        raise HTTPException(status_code=422, detail="Invalid internship identifier.")
    return value


def _requests_public_open_internships(text: str) -> bool:
    """Recognize public inventory questions without matching a user's saved list."""
    inventory = r"(?:internships?|opportunities|roles?|postings?)"
    availability = r"(?:open|available|current|currently|live|published|active|browse|platform|guests?)"
    return bool(re.search(
        rf"\b(?:how many|count|number of)\b.{{0,35}}\b(?:open|available|current|currently|live|published|active)\b.{{0,15}}\b(?:open|available|current|currently|live|published|active)\b.{{0,20}}\b{inventory}\b"
        rf"|\b(?:how many|count|number of)\b.{{0,35}}\b(?:open|available|current|currently|live|published|active)\b.{{0,20}}\b{inventory}\b"
        rf"|\b(?:how many|count|number of)\b.{{0,45}}\b{inventory}\b.{{0,40}}\b{availability}\b"
        rf"|\b(?:show|list|find)\b.{{0,30}}\b(?:open|available|current|live|published)\b.{{0,20}}\b{inventory}\b"
        rf"|\b(?:what|which)\b.{{0,30}}\b(?:open|available|current|currently|live|published|active)\b.{{0,20}}\b{inventory}\b"
        rf"|\b(?:open|available|current|currently|live|published|active)\b.{{0,30}}\b{inventory}\b"
        rf"|\b{inventory}\b.{{0,45}}\b(?:open|available|current|live|published)\b"
        rf"|\b(?:are there any|are any)\b.{{0,15}}\b(?:open|available|current|live)\b.{{0,20}}\b{inventory}\b"
        rf"|\b(?:are there any|are any)\b.{{0,30}}\b{inventory}\b.{{0,25}}\b(?:open|available)\b",
        text,
    ))


def classify_intent(message: str, role: str) -> Intent:
    """Choose one supported route; never infer or construct arbitrary tool names."""
    normalized_role = role.lower()
    if detect_cross_account_request(message):
        return Intent("out_of_scope", refusal_reason="cross_account_request")
    if role.lower() != "admin" and is_admin_only_query(message):
        return Intent("out_of_scope", refusal_reason="role_restricted")
    if (
        not is_chatbot_capability_question(message)
        and any(pattern.search(message) for pattern in OUT_OF_SCOPE_PATTERNS)
    ):
        return Intent("out_of_scope", refusal_reason="outside_product_scope")
    if re.match(
        r"^\s*(?:how do i|how can i|where can i|where do i|can i)\b",
        message,
        re.IGNORECASE,
    ):
        return Intent("rag_help")

    text = _normalize_intent_text(message)
    if re.search(r"\b(?:which|what)\s+(?:date )?period\b|\b(?:last|past) period\b", text):
        return Intent(
            "rag_help",
            needs_clarification="Which date range should I use?",
        )
    if (
        normalized_role == "company"
        and _internship_id(message) is None
        and re.search(r"\b(?:this|that|the)\s+(?:internship|posting)\b", text)
        and re.search(r"\b(applicants?|candidates?|shortlist(?:ed)?|applications?)\b", text)
    ):
        return Intent(
            "rag_help",
            needs_clarification="Which internship should I check? Please provide its posting ID.",
        )
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
        if re.search(r"\bfollow up\s+(?:(?:and|also)\s+)?interview\b", text):
            return live_or_both("student_interviews")
        if re.search(
            r"\b(retake|retry|take again)\b.{0,50}\b(skill )?assessments?\b"
            r"|\b(when|how soon|how long)\b.{0,40}\b(retake|retry|take again)\b",
            text,
        ):
            return Intent("both", "student_skill_retake")
        if re.search(
            r"\bskill gap\b|\bwhat are my skills\b"
            r"|\bwhere\b.{0,45}\b(?:do i need to|i need to|have to|can i)\s+improve\b"
            r"|\bmy skills\b.{0,50}\b(?:weak|where|improve)\b",
            text,
        ):
            return live_or_both("student_skill_gap")
        if re.search(
            r"\b(my|show my|list my)\b.{0,50}\bskills?\b"
            r".{0,80}\b(improve|improvement|weak|assessment|results?)\b",
            text,
        ):
            return live_or_both("student_skills_improvement")
        if re.search(
            r"\b(?:how many|count|number of)\b.{0,40}\bapplications?\b"
            r"|\b(?:shortlisted|applied|under review|interview|offers?)\b.{0,35}"
            r"\b(?:count|number of|applications?)\b"
            r"|\bany offers?\b",
            text,
        ):
            return live_or_both("student_application_counts")
        if re.search(
            r"\b(find|recommend|suggest|show|list)\b.{0,50}\b(internships?|roles?|opportunities)\b"
            r".{0,50}\b(match(?:ing)?|fit)\b.{0,30}\b(my profile|my skills|my background)\b"
            r"|\b(internships?|roles?)\b.{0,40}\b(match(?:ing)?|fit)\b.{0,30}\bmy profile\b",
            text,
        ):
            return live_or_both("student_recommended_internships")
        if re.search(r"\b(my (?:saved|save)|(?:saved|save) internships?|(?:saved|save) roles?|my bookmarks)\b", text):
            return live_or_both("student_saved_internships")
        if re.search(
            r"\bhow many\b.{0,30}\binternships?\b.{0,25}\b(i have )?saved\b"
            r"|\bnumber of\b.{0,30}\binternships?\b.{0,25}\bsaved\b",
            text,
        ):
            return live_or_both("student_saved_internships")
        if re.search(
            r"\b(how many|number of|count)\b.{0,30}\b(saved|save)\b.{0,30}\b(internships?|roles?)\b"
            r"|\b(my|show my|list my)\b.{0,25}\b(skill )?(assessments?|badges?)\b"
            r"|\b(how many|number of|count)\b.{0,30}\b(assessments?|badges?)\b",
            text,
        ):
            return live_or_both("student_skill_assessments")
        if re.search(
            r"\b(what is|show|list|check|tell me|give me)\b.{0,40}\bmy\b.{0,50}"
            r"\b(application|applications|submission|status|timeline)\b"
            r"|\b(where can i see|where do i see|where are|where can i find)\b.{0,30}\bmy\b.{0,30}\bapplications?\b"
            r"|\bhow many\b.{0,40}\bapplications?\b.{0,30}\b(i have|i submitted|are|do i have)?\b"
            r"|\b(shortlist|interview|offer|rejected|applied|under review)\b.{0,35}"
            r"\b(count|number|status)?\b.{0,25}\bapplications?\b"
            r"|\bapplications?\b.{0,40}\b(shortlist|interview|offer|rejected|applied|under review)\b"
            r"|\bstatus of my\b.{0,30}\b(application|submission)\b",
            text,
        ):
            if re.search(
                r"\b(show|list|what is|check|tell me|give me|how many|status of|where are|"
                r"count|number|shortlist|interview|offer|rejected|applied|under review)\b",
                text,
            ):
                return live_or_both("student_applications")
        if re.search(
            r"\b(my|mine|what are my|which)\b.{0,40}\b(interview|interviews)\b"
            r"|\b(any|what|which)\b.{0,30}\b(interviews?)\b.{0,30}\b(coming up|upcoming|scheduled)\b"
            r"|\bdo i have\b.{0,30}\b(upcoming|scheduled)\b.{0,20}\binterviews?\b"
            r"|\bupcoming interviews\b|\bshow my upcoming interviews\b|\bany interviews?\b",
            text,
        ):
            return live_or_both("student_interviews")
        if re.search(r"\b(my|mine|show my)\b.{0,40}\b(notification|notifications|alerts)\b", text):
            return live_or_both("student_notifications")
        if re.search(
            r"\b(unread|new)\b.{0,25}\b(messages?|inbox)\b"
            r"|\bmessages?\b.{0,25}\b(unread|unread count)\b",
            text,
        ):
            return live_or_both("student_unread_messages")
        if re.search(r"\b(profile completeness|how complete is my profile|what is missing from my profile)\b", text):
            return live_or_both("student_profile_completeness")
        if _requests_public_open_internships(text):
            return live_or_both("public_open_internships_count")

    if normalized_role == "company":
        if re.search(
            r"\b(unread|new)\b.{0,25}\b(messages?|inbox)\b"
            r"|\bmessages?\b.{0,25}\b(unread|unread count)\b",
            text,
        ):
            return live_or_both("company_unread_messages")
        if re.search(
            r"\b(my|our)\b.{0,30}\b(company )?verification status\b"
            r"|\b(is|am) my company verified\b|\bhas my company been verified\b",
            text,
        ):
            return live_or_both("company_verification_status")
        if re.search(
            r"\b(my (?:shortlisted|shortlist)|show (?:shortlisted|shortlist)|who did i shortlist|"
            r"how many candidates did i shortlist|"
            r"(?:shortlisted|shortlist) candidates?|(?:shortlisted|shortlist) applicants?|"
            r"how many (?:shortlisted|shortlist)|number of (?:shortlisted|shortlist)|shortlist count)\b",
            text,
        ):
            args = (("internship_id", value),) if (value := _internship_id(message)) else ()
            return live_or_both("company_shortlisted", args)
        if re.search(
            r"\b(how many|number of|count)\b.{0,35}\b(interviews?|schedule)\b"
            r"|\b(show|list)\b.{0,25}\bmy upcoming interviews\b",
            text,
        ):
            return live_or_both("company_interviews")
        if re.search(
            r"\b(my hiring pipeline|pipeline counts|how many in each stage|"
            r"how many applications? are in each stage)\b",
            text,
        ):
            return live_or_both("company_pipeline")
        if re.search(
            r"\b(my internships|my internship postings|my internship posting statuses?|my postings|how many internships? do i have|how many postings? do i have|"
            r"count my postings|my active postings|active postings|status of my (?:internship|posting)|"
            r"status of (?:internship|posting)|internship status)\b",
            text,
        ):
            args = (("internship_id", value),) if (value := _internship_id(message)) else ()
            return live_or_both("company_internships", args)
        if re.search(
            r"\b(?:who|which|show|list|how many|total|count|number of|status of|what)\b.{0,40}\b(?:applicant|applicants|candidate|candidates|application|applications)\b"
            r"|\b(?:show|list|summary)\b.{0,25}\b(?:applicant|applicants|candidate|candidates|application|applications)\b.{0,25}\b(?:status|count|summary|by stage)\b"
            r"|\bwho\b.{0,20}\b(?:has|have|did|was|were)?\b.{0,20}\b(?:applied|applies)\b"
            r"|\bwho\b.{0,20}\bapplied\b"
            r"|\b(?:my|this|the)\b.{0,20}\b(?:applicants?|candidates?)\b",
            text,
        ):
            args = (("internship_id", value),) if (value := _internship_id(message)) else ()
            return live_or_both("company_applicants", args)
        if re.search(
            r"\b(?:(?:my|show my)\s+(?:(?:scheduled|schedule|upcoming)\s+)?interviews?|"
            r"which interviews? have i (?:scheduled|schedule))\b",
            text,
        ):
            return live_or_both("company_interviews")

    if normalized_role == "admin":
        if re.search(
            r"\b(today|today's|this day)\b.{0,35}\b(activity|signups?|applications?|audit|platform)\b"
            r"|\b(show|summari[sz]e)\b.{0,25}\b(today|today's)\b.{0,20}\b(platform )?activity\b",
            text,
        ):
            return live_or_both("admin_today_activity")
        if re.search(
            r"\b(most recent|recent|latest|last five|last 5)\b.{0,35}\b(registrations?|signups?|registered users?)\b"
            r"|\b(show|list)\b.{0,30}\b(newest|recent)\b.{0,20}\b(users?|registrations?)\b",
            text,
        ):
            return live_or_both("admin_recent_registrations")
        if re.search(
            r"\b(has|have|was|were)\b.{0,30}\b(internship|posting)\b.{0,30}\b(deleted|removed)\b.{0,30}\b(recently|lately)\b"
            r"|\b(has|have)\b.{0,25}\b(any|an|a)\b.{0,20}\b(internship|posting)\b.{0,20}\b(deleted|removed)\b.{0,25}\b(recently|lately)\b",
            text,
        ):
            return live_or_both("admin_recent_posting_deletions")
        if re.search(
            r"\b(recent|latest|last)\b.{0,45}\b(posting|internship)\b.{0,30}\b(changes?|edits?|updates?|deletions?)\b"
            r"|\b(changes?|edits?|updates?|deletions?)\b.{0,45}\b(posting|internship)\b.{0,30}\b(recently|lately)\b",
            text,
        ):
            return live_or_both("admin_recent_posting_changes")
        if re.search(
            r"\b(recent|latest|last)\b.{0,30}\b(admin )?(activities|actions|events)\b"
            r"|\b(show|summari[sz]e)\b.{0,25}\b(recent|latest)\b.{0,20}\b(admin )?(activities|actions|events)\b",
            text,
        ):
            return live_or_both("admin_audit_events")
        if re.search(
            r"\b(suspicious|failed|unsuccessful)\b.{0,30}\b(login|sign[- ]?in|security|activity|attempts?)\b"
            r"|\bsecurity events?\b|\bfailed login attempts?\b",
            text,
        ):
            return live_or_both("admin_security_events")
        if re.search(
            r"\b(chatbot|assistant)\b.{0,40}\b(low confidence|unanswered|not sure|questions?)\b"
            r"|\b(low confidence|unanswered)\b.{0,30}\b(chatbot|assistant|questions?)\b",
            text,
        ):
            return live_or_both("admin_chatbot_low_confidence_questions")
        if re.search(
            r"\b(company|companies)\b.{0,30}\b(need|needs|pending)\b.{0,20}\bverification\b"
            r"|\bverification counts?\b",
            text,
        ):
            return live_or_both("admin_verification_counts")
        if re.search(
            r"\b(how many|count|number of|total)\b.{0,50}\b(companies|company accounts)\b"
            r".{0,60}\b(posts?|postings?|internships?)\b.{0,35}\b(active|published|live)\b"
            r"|\b(companies|company accounts)\b.{0,40}\b(and|with)\b.{0,25}\b(active|live)\b.{0,20}\b(posts?|postings?|internships?)\b",
            text,
        ):
            return live_or_both("admin_company_and_posting_counts")
        if re.search(
            r"\b(how many users and companies|user and company counts|platform counts|"
            r"platform analytics|show platform user counts|users count|user count|user counts by role)\b"
            r"|\bhow many users\b|\busers and companies\b",
            text,
        ):
            return live_or_both("admin_analytics")
        if re.search(
            r"\b(how many|count|number of|total)\b.{0,40}\b(companies|company accounts)\b"
            r"|\b(companies|company accounts)\b.{0,30}\b(registered|verified|pending)\b",
            text,
        ):
            return live_or_both("admin_company_counts")
        if re.search(
            r"\b(how many|count|number of|total)\b.{0,45}\b(students|student accounts)\b"
            r"|\b(students|student accounts)\b.{0,30}\b(active|registered)\b",
            text,
        ):
            return live_or_both("admin_student_counts")
        if re.search(
            r"\b(how many|count|number of)\b.{0,60}\b(postings?|internships?)\b.{0,40}\b(pending|await(?:ing)?)\b"
            r"|\b(how many|count|number of)\b.{0,60}\b(pending|await(?:ing)?)\b.{0,40}\b(postings?|internships?)\b"
            r"|\bpending posting count\b",
            text,
        ):
            return live_or_both("admin_pending_approvals")
        if re.search(
            r"\b(how many|count|number of|total)\b.{0,55}\b(postings?|internships?)\b"
            r"|\b(postings?|internships?)\b.{0,25}\b(total|published|active|expired|pending|rejected)\b",
            text,
        ):
            return live_or_both("admin_posting_counts")
        if re.search(
            r"\b(how many|count|number of|show|list)\b.{0,60}\b(topics?|skill assessment topics?)\b"
            r"|\b(topics?)\b.{0,40}\b(skill assessments?|assessment)\b",
            text,
        ):
            return live_or_both("admin_skill_assessment_stats")
        if re.search(
            r"\b(show|list)\b.{0,35}\b(pending|awaiting)\b.{0,25}\b(postings?|internships?)\b"
            r"|\b(show|list)\b.{0,25}\b(postings?|internships?)\b.{0,25}\b(pending|awaiting)\b",
            text,
        ):
            return live_or_both("admin_pending_approvals")
        if re.search(
            r"\b(how many|count|number of|pending verification)\b.{0,60}\bverifications?\b"
            r"|\b(company|companies)\b.{0,30}\bverification counts?\b"
            r"|\b(show|list)\b.{0,30}\b(company|companies)\b.{0,30}\bverification\b.{0,20}\b(counts?|status|totals?)\b"
            r"|\bverification counts?\b",
            text,
        ):
            return live_or_both("admin_verification_counts")
        if re.search(
            r"\b(platform analytics|how many users|user and company counts|platform counts|"
            r"show platform user counts|users count|user count|user counts by role)\b",
            text,
        ):
            return live_or_both("admin_analytics")
        if re.search(
            r"\b(how many|show|list|count|number of)\b.{0,50}\b(assessments?|attempts?)\b"
            r".{0,30}\b(attended|taken|completed|stats?|statistics)?\b"
            r"|\b(skill assessment|assessment) stats?\b",
            text,
        ):
            return live_or_both("admin_skill_assessment_stats")
        if re.search(
            r"\b(open|pending|unresolved)\b.{0,25}\b(reports?|disputes?)\b"
            r"|\b(show|how many|count)\b.{0,25}\b(open )?(reports?|disputes?)\b",
            text,
        ):
            return live_or_both("admin_open_reports")

    if normalized_role in {"guest", "student"} and _requests_public_open_internships(text):
        return Intent("live_data", "public_open_internships_count")
    return Intent("rag_help")


async def classify_intent_with_examples(message: str, role: str, model_name: str) -> Intent:
    """Use allow-listed semantic examples only when deterministic keyword routing is inconclusive."""
    intent = classify_intent(message, role)
    if intent.category != "rag_help" or intent.needs_clarification or is_how_to_question(message):
        return intent
    examples = INTENT_EXAMPLES.get(role.lower(), {})
    if not examples:
        return intent

    try:
        query_vector, = await asyncio.to_thread(
            lambda: embed_texts([message], model_name, queries=True)
        )
        candidates = await asyncio.to_thread(_intent_examples_vectors, model_name)
    except Exception:
        logger.exception("chatbot_semantic_intent_fallback")
        return intent
    query_norm = math.sqrt(sum(value * value for value in query_vector))
    best: tuple[float, str] | None = None
    for candidate_role, tool_name, vector in candidates:
        if candidate_role != role.lower() or tool_name not in examples:
            continue
        vector_norm = math.sqrt(sum(value * value for value in vector))
        if not query_norm or not vector_norm:
            continue
        similarity = sum(left * right for left, right in zip(query_vector, vector)) / (
            query_norm * vector_norm
        )
        if best is None or similarity > best[0]:
            best = (similarity, tool_name)
    if best is None or best[0] < 0.72:
        return intent
    return Intent("live_data", best[1])
