"""Stateless, privacy-preserving chatbot decision pipeline."""

import json
import logging
import re
import time
from collections import defaultdict, deque
from dataclasses import dataclass
from datetime import timezone
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession

from ..chatbot.chatbot_config import ChatbotConfig, load_config
from ..chatbot.guardrails import (
    _output_safety_failure,
    is_role_capability_question,
    output_is_safe,
)
from ..chatbot.providers import create_answer_provider
from ..chatbot.providers.base import (
    AnswerProvider,
    ChatbotRouterProvider,
    Passage,
    ProviderPayload,
)
from ..chatbot.providers.retrieval_only import RetrievalOnlyProvider
from ..chatbot.rag.retriever import HybridRetriever
from ..chatbot.redaction import contains_secret, redact
from ..chatbot.retriever import QUERY_STOPWORDS, BM25Retriever, _section_slug, _tokens
from ..chatbot.scope import (
    ScopeDecision,
    decide_scope,
    fixed_reply,
    is_admin_audit_query,
    is_how_to_question,
)
from ..models import ChatbotLowConfidenceLog
from .audit import AuditEventSummary, audit_action_label

logger = logging.getLogger("internsphere.chatbot")
PAGE_ROUTES = {
    "home": "/",
    "student-dashboard": "/opportunities",
    "opportunities": "/opportunities",
    "applications": "/applications",
    "profile": "/profile/student",
    "interviews": "/interviews",
    "messages": "/messages",
    "notifications": "/notifications",
    "company": "/company",
    "company-dashboard": "/company",
    "company-jobs": "/company/jobs",
    "company-applicants": "/company/applicants",
    "company-analytics": "/company/analytics",
    "company-shortlisted": "/company/shortlisted",
    "company-pipeline": "/company/pipeline",
    "company-settings": "/company/settings",
    "company-profile": "/profile/company",
    "admin": "/admin",
    "admin-dashboard": "/admin",
    "admin-moderation": "/admin/moderation",
    "admin-skills": "/admin/skill-assessments",
    "admin-verifications": "/admin/verifications",
    "admin-reports": "/admin/reports",
    "admin-audit-logs": "/admin/audit-logs",
    "admin-companies": "/admin/companies",
    "admin-users": "/admin/users",
    "privacy": "/privacy-security",
    "privacy-policy": "/privacy",
    "privacy-center": "/privacy-center",
    "saved": "/saved",
    "login": "/login",
    "register-student": "/register-student",
    "register-company": "/register-company",
    "verify": "/verify",
}
GUIDANCE = {
    "applications": "Open Applications to review your submissions and timelines. Ask “What is my application status?” to request a live summary.",
    "interviews": "Open Interviews to review your schedule. Ask “Any interviews coming up?” to request a live summary.",
    "messages": "Open Messages to review your conversations.",
    "profile": "Open your Profile page to review or update your information.",
    "notifications": "Open Notifications & Mailbox to review your alerts.",
    "account": "Open your account settings to review your InternSphere account information.",
}
WORD_LIMIT = 120
NO_EVIDENCE_ANSWER = "I don't have sufficient data to answer this question."
CURATED_ANSWERS_PATH = Path(__file__).resolve().parents[2] / "kb" / "curated_answers.yaml"
CURATED_IGNORED_TOKENS = QUERY_STOPWORDS | {
    "help", "please", "page", "platform", "internsphere", "want", "need", "get",
    "show", "find", "see", "open", "use", "go", "tell", "give", "me", "my",
    "i", "we", "you", "the", "a", "an", "to", "how", "what", "where", "when",
    "can", "do", "does", "is", "are", "for", "on", "in", "of", "and", "about",
}
SAFE_QUESTION_WORDS = set(
    "a about account accounts active activity admin applications apply are audit badges "
    "best by can candidate candidates company companies completed count current data delete "
    "deleted did do does email events failed for from help how in internship internships is "
    "it its last live login many messages most new number of open or other platform posting "
    "postings recent registered registration registrations report reports role security show "
    "sign suspicious student students the today total verified verification what when where "
    "which who why with".split()
)
COMMON_ROUTES = {
    "/", "/opportunities", "/login", "/register-student", "/register-company",
    "/forgot-password", "/reset-password", "/verify", "/privacy", "/privacy-center",
    "/privacy-security", "/#faq",
}
ROLE_ROUTES = {
    "guest": COMMON_ROUTES,
    "student": COMMON_ROUTES | {
        "/applications", "/profile/student", "/interviews", "/messages",
        "/notifications", "/saved", "/student/analytics", "/skills/history",
    },
    "company": COMMON_ROUTES | {
        "/company", "/company/jobs", "/company/internships/new", "/company/applicants",
        "/company/jobs/:id/applicants",
        "/company/interviews", "/company/pipeline", "/company/shortlisted", "/company/analytics",
        "/company/settings", "/profile/company", "/interviews", "/messages", "/notifications",
    },
    "admin": COMMON_ROUTES | {
        "/admin", "/admin/moderation", "/admin/companies", "/admin/users",
        "/admin/verifications", "/admin/reports", "/admin/audit-logs",
        "/admin/skill-assessments", "/admin/students", "/notifications",
    },
}


@dataclass(frozen=True)
class ChatResult:
    answer: str
    links: tuple[tuple[str, str], ...]
    sources: tuple[tuple[str, str, str], ...]
    source_type: str
    suggested_followups: tuple[str, ...]
    category: str
    refused: bool
    matched_ids: tuple[str, ...]
    refusal_reason: str | None
    needs_clarification: str | None = None


@dataclass(frozen=True)
class CuratedAnswer:
    id: str
    audience: str
    questions: tuple[str, ...]
    answer: str
    source: str
    label: str
    route: str


def _load_curated_answers(path: Path = CURATED_ANSWERS_PATH) -> tuple[CuratedAnswer, ...]:
    """Load and validate curated, role-specific help answers from the KB."""
    data = json.loads(path.read_text(encoding="utf-8"))
    entries = data.get("answers") if isinstance(data, dict) else None
    if not isinstance(entries, list):
        raise TypeError(f"Curated chatbot answers are invalid: {path.name}")
    answers = []
    for entry in entries:
        if (
            not isinstance(entry, dict)
            or entry.get("audience") not in {"guest", "student", "company", "admin"}
            or not all(isinstance(entry.get(key), str) and entry[key].strip() for key in (
                "id", "answer", "source", "label", "route",
            ))
            or not isinstance(entry.get("questions"), list)
            or not entry["questions"]
            or not all(isinstance(question, str) and question.strip() for question in entry["questions"])
        ):
            raise ValueError(f"Curated chatbot answer entry is invalid: {path.name}")
        answers.append(CuratedAnswer(
            id=entry["id"],
            audience=entry["audience"],
            questions=tuple(entry["questions"]),
            answer=entry["answer"],
            source=entry["source"],
            label=entry["label"],
            route=entry["route"],
        ))
    return tuple(answers)


def _curated_tokens(text: str) -> set[str]:
    tokens = set(_tokens(text)) - CURATED_IGNORED_TOKENS
    normalized = {
        {"job": "posting", "jobs": "posting", "role": "internship", "roles": "internship"}.get(
            token,
            token,
        )
        for token in tokens
    }
    return normalized - CURATED_IGNORED_TOKENS


def _curated_match_score(query: str, example: str) -> float:
    query_tokens = _curated_tokens(query)
    example_tokens = _curated_tokens(example)
    if not query_tokens or not example_tokens:
        return 0.0
    overlap = len(query_tokens & example_tokens)
    return 2 * overlap / (len(query_tokens) + len(example_tokens))


def _match_curated_question(
    message: str,
    role: str,
    answers: tuple[CuratedAnswer, ...],
) -> tuple[CuratedAnswer, ...]:
    """Match one or two distinct help questions to unambiguous role-visible answers."""
    parts = [
        part.strip(" ,;")
        for part in re.split(
            r"\?\s*|\s*;\s*|\s+\band\s+(?=(?:what|how|where|when|who|why|can|do|is|are)\b)",
            message,
            flags=re.IGNORECASE,
        )
        if part.strip(" ,;")
    ]
    if not parts:
        return ()
    selected: list[CuratedAnswer] = []
    for part in parts[:2]:
        ranked = sorted(
            (
                (_curated_match_score(part, example), answer)
                for answer in answers
                if answer.audience == role
                for example in answer.questions
            ),
            key=lambda item: item[0],
            reverse=True,
        )
        if not ranked or ranked[0][0] < 0.68:
            return ()
        if (
            len(ranked) > 1
            and ranked[0][0] - ranked[1][0] < 0.04
            and ranked[0][1].id != ranked[1][1].id
        ):
            return ()
        answer = ranked[0][1]
        if answer not in selected:
            selected.append(answer)
    return tuple(selected)


def _curated_source(answer: CuratedAnswer, query: str, retriever: BM25Retriever) -> tuple[str, str]:
    """Resolve a curated answer to its closest audience-visible KB section."""
    for document in getattr(retriever, "documents", ()):
        if document.id != answer.source:
            continue
        section = max(
            document.sections,
            key=lambda value: (
                _curated_match_score(query, value.splitlines()[0]),
                _curated_match_score(query, value),
            ),
            default="",
        )
        if section:
            return f"{document.id}#{_section_slug(section)}", document.title
    return f"{answer.source}#curated-answer", answer.label


def _truncate_answer(text: str) -> str:
    """Keep complete sentences or list items up to the configured word limit, stopping at the first overflow."""
    accepted: list[str] = []
    word_count = 0
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        if re.match(r"^(?:\d+[.)]|[-*])\s+", stripped):
            units = [stripped]
        elif stripped.endswith(":") or re.search(r"\.[A-Z][^.!?]*:\s*$", stripped):
            units = [stripped]
        else:
            units = re.split(r"(?<=[.!?])\s+", stripped)
            units = [unit for unit in units if unit.endswith((".", "!", "?"))]
        for unit in units:
            unit_words = len(unit.split())
            if word_count + unit_words > WORD_LIMIT:
                return "\n".join(accepted)
            accepted.append(unit)
            word_count += unit_words
    return "\n".join(accepted)


def _render_retrieval_answer(passages: list[Passage]) -> str:
    """Clean and truncate the first retrieved passage to at most its first two nonempty paragraphs."""
    if not passages:
        return ""
    content = passages[0].text
    content = re.sub(r"!\[([^\]]*)\]\([^)]+\)", r"\1", content)
    content = re.sub(
        r"\[([^\]]+)\]\(([^)]+)\)",
        lambda match: (
            f"{match.group(1)} ({match.group(2)})"
            if match.group(2).startswith("/")
            else match.group(1)
        ),
        content,
    )
    content = re.sub(r"^#{1,6}\s+.*$", "", content, flags=re.M)
    content = re.sub(r"```[\w-]*\s*|\s*```", "", content)
    content = re.sub(r"(`{1,2}|\*\*|__|~~|(?<!\w)[*_](?!\w))", "", content)
    content = re.sub(r"<[^>]*>", "", content)
    paragraphs = [
        paragraph.strip()
        for paragraph in re.split(r"\n\s*\n", content)
        if paragraph.strip()
    ]
    return _truncate_answer("\n\n".join(paragraphs[:2]))


def _closest_supported_questions(
    retriever: BM25Retriever,
    query: str,
    role: str,
    page: str,
) -> tuple[str, ...]:
    """Return up to three role-visible, example questions nearest to the current message."""
    fallback = {
        "student": (
            "How do I search internships?",
            "How do I track my applications?",
            "How do I take a skill assessment?",
        ),
        "company": (
            "How do I create an internship posting?",
            "How do I review applicants?",
            "How do I schedule an interview?",
        ),
        "admin": (
            "How do I review pending postings?",
            "How do I verify a company?",
            "How do I manage assessment questions?",
        ),
        "guest": (
            "How do I search internships?",
            "How do I register?",
            "How does InternSphere work?",
        ),
    }
    passages = retriever.retrieve(
        query,
        role,
        top_k=8,
        minimum_score=0,
        minimum_margin=0,
        page_route=PAGE_ROUTES.get(page),
    )
    documents = {
        document.id: document
        for document in getattr(retriever, "documents", ())
    }
    questions = []
    for passage in passages:
        if passage.score <= 0:
            continue
        document = documents.get(passage.doc_id or passage.id.split("#", 1)[0])
        if document is None:
            continue
        question = next(
            (example.strip() for example in document.examples if example.strip()),
            "",
        )
        if question and question.casefold() not in {item.casefold() for item in questions}:
            questions.append(question)
        if len(questions) == 3:
            break
    for question in fallback[role]:
        if len(questions) == 3:
            break
        if question.casefold() not in {item.casefold() for item in questions}:
            questions.append(question)
    return tuple(questions)


def _no_evidence_reply() -> str:
    """Return the exact response used when retrieval does not meet its relevance threshold."""
    return NO_EVIDENCE_ANSWER


def _privacy_reduced_question(question: str) -> str:
    """Keep only general question language and platform terms before storing for review."""
    words = re.findall(r"[A-Za-z]+|\d+|[?.!,]", redact(question).casefold())
    safe = [
        word if word in SAFE_QUESTION_WORDS or word in {"?", ".", ",", "!"} else "[redacted]"
        for word in words
    ]
    return re.sub(r"(?:\[redacted\]\s*){2,}", "[redacted] ", " ".join(safe))[:500].strip()


def _role_routes(role: str) -> set[str]:
    """Return the routes permitted for a role, defaulting unknown roles to guest routes."""
    return ROLE_ROUTES.get(role, COMMON_ROUTES)


def _is_allowed_live_route(route: str, role: str) -> bool:
    """Check role access for static and parameterized frontend routes."""
    if route == "/#faq":
        route = "/"
    if role != "guest" and route in {
        "/login", "/register-student", "/register-company",
        "/forgot-password", "/reset-password", "/verify",
    }:
        return False
    if route in _role_routes(role):
        return True
    if role == "student":
        return bool(re.fullmatch(r"/(?:opportunities|applications)/[1-9]\d*", route))
    if role == "company":
        return bool(re.fullmatch(
            r"/company/interviews|/company/(?:jobs|companies)/[1-9]\d+(?:/applicants)?|/company/internships/[1-9]\d+/(?:edit|applicants)",
            route,
        ))
    if role == "admin":
        return bool(re.fullmatch(
            r"/admin/(?:companies|students)/[1-9]\d+(?:/postings)?",
            route,
        ))
    return False


def _allowed_routes(passages: list[Passage], role: str) -> set[str]:
    """Collect role-authorized routes referenced by retrieved passages."""
    return {
        route
        for passage in passages
        for _, route in (
            passage.links or tuple((passage.title, item) for item in passage.related_routes)
        )
        if _is_allowed_live_route(route, role)
    }


def _links_for(passages: list[Passage], role: str) -> tuple[tuple[str, str], ...]:
    """Build up to two unique, role-authorized links from the selected passage only."""
    links = []
    seen_routes: set[str] = set()
    seen_labels: set[str] = set()
    for passage in passages[:1]:
        passage_links = passage.links or tuple((passage.title, route) for route in passage.related_routes)
        for label, route in passage_links:
            if (
                route not in seen_routes
                and label.casefold() not in seen_labels
                and _is_allowed_live_route(route, role)
            ):
                seen_routes.add(route)
                seen_labels.add(label.casefold())
                links.append((label, route))
                if len(links) == 2:
                    return tuple(links)
    return tuple(links)


def _sources_for(passages: list[Passage], role: str) -> tuple[tuple[str, str, str], ...]:
    """Return the selected passage paired with its first role-authorized route."""
    sources = []
    for passage in passages[:1]:
        route = next(
            (
                route for _, route in (
                    passage.links or tuple((passage.title, item) for item in passage.related_routes)
                )
                if _is_allowed_live_route(route, role)
            ),
            None,
        )
        if route:
            sources.append((passage.id, passage.title, route))
    return tuple(sources)


def _sectioned_passages(passages: list[Passage]) -> list[Passage]:
    """Give hybrid-retrieval passages the same stable IDs as BM25 section chunks."""
    sectioned = []
    for passage in passages:
        heading = re.match(r"^##\s+([^\r\n]+)", passage.text)
        if passage.doc_id and heading:
            passage = Passage(
                id=f"{passage.doc_id}#{_section_slug(f'## {heading.group(1)}')}",
                title=passage.title,
                audience=passage.audience,
                text=passage.text,
                related_routes=passage.related_routes,
                score=passage.score,
                doc_id=passage.doc_id,
                links=passage.links,
            )
        sectioned.append(passage)
    return sectioned


def _counts_only_summary(answer: str) -> str:
    counts = re.findall(r"(?<!\w)\d+(?:\.\d+)?%?(?!\w)", answer)
    return f"Live result counts: {', '.join(counts[:8])}." if counts else ""


def _dedupe_links(links: tuple[tuple[str, str], ...]) -> tuple[tuple[str, str], ...]:
    """Keep the first link per route and label, with no more than two destinations."""
    unique = []
    seen_routes: set[str] = set()
    for link in links:
        if link[1] not in seen_routes:
            seen_routes.add(link[1])
            unique.append(link)
        if len(unique) == 2:
            break
    return tuple(unique)


def _role_capabilities(role: str) -> tuple[str, str]:
    """Describe the role's main platform capabilities and return its primary route."""
    if role == "student":
        return (
            "Your role is Student. You can discover internships, apply and track applications, save opportunities, update your profile, and review interviews.",
            "/opportunities",
        )
    if role == "company":
        return (
            "Your role is Company. You can manage internship postings, review and shortlist applicants, schedule interviews, and track your hiring pipeline.",
            "/company",
        )
    if role == "admin":
        return (
            "Your role is Admin. You can review platform moderation, verify companies, manage users, and inspect platform reports and audit events.",
            "/admin",
        )
    return (
        "You are browsing as a guest. You can explore public internships or register; sign in to use student or company features.",
        "/opportunities",
    )


def _suggested_followups(
    role: str,
    message: str,
    page: str,
    history: list[tuple[str, str]],
    source_ids: tuple[str, ...],
    previous_suggestions: list[str],
    matched_examples: tuple[str, ...] = (),
    matched_intent: str | None = None,
) -> tuple[str, ...]:
    """Offer answerable questions related to the page/topic without repeating recent content."""
    text = message.casefold()
    topic = source_ids[0] if source_ids else ""
    suggestions: tuple[str, ...]
    if role == "student":
        if topic in {"application-statuses-timeline", "applying"} or page == "applications":
            suggestions = (
                "How do I withdraw an application?",
                "How do I understand application statuses?",
                "How do notifications work?",
                "Any interviews coming up?",
                "How do I save an internship?",
                "How do I update my profile and resume?",
                "How do I search internships by skills and location?",
            )
        elif topic in {"skill-assessments", "assessment-badges"} or page in {"profile", "student-dashboard"}:
            suggestions = (
                "How do I take a skill assessment?",
                "When can I retake a skill assessment?",
                "How long do verified skill badges last?",
                "How do I update my profile skills?",
                "Where can I see my assessment results?",
                "How do I download an assessment report?",
                "How do I search internships by skills and location?",
            )
        elif "interview" in text or page == "interviews":
            suggestions = (
                "Where can I see my applications?",
                "How do I understand application statuses?",
                "How do notifications work?",
                "How do I withdraw an application?",
                "How do I update my profile and resume?",
                "How do I save an internship?",
                "How do skill assessments and badges work?",
            )
        elif "notification" in text or page == "notifications":
            suggestions = (
                "Where can I see my applications?",
                "Any interviews coming up?",
                "How do I update my profile and resume?",
                "How do I save an internship?",
                "How do I withdraw an application?",
                "How do I search internships by skills and location?",
                "How do skill assessments and badges work?",
            )
        else:
            suggestions = (
                "How do I search internships by skills and location?",
                "How do I apply for an internship?",
                "Where can I see my applications?",
                "How do skill assessments and badges work?",
                "How do I save an internship?",
                "How do notifications work?",
                "How do I update my profile and resume?",
            )
    if role == "company":
        if topic in {"company-applicant-review", "company-hiring-pipeline"} or page in {
            "company-applicants", "company-pipeline", "company-shortlisted",
        }:
            suggestions = (
                "How do I shortlist a candidate?",
                "Show my hiring pipeline counts.",
                "How do I schedule an interview?",
                "How do I update an application status?",
                "Who applied to my internship?",
                "How do I create an internship posting?",
                "How do I verify my company?",
                "Show my upcoming interviews.",
            )
        elif "interview" in text or page == "interviews":
            suggestions = (
                "Who applied to my internship?",
                "How do I update an application status?",
                "How do I shortlist a candidate?",
                "Show my hiring pipeline counts.",
                "How do I create an internship posting?",
                "How do I verify my company?",
                "Show my internships.",
            )
        else:
            suggestions = (
                "How do I create an internship posting?",
                "How do I review applicants?",
                "How do I schedule an interview?",
                "How do I verify my company?",
                "Show my hiring pipeline counts.",
                "Show my upcoming interviews.",
                "How do I close an internship posting?",
            )
    if role == "admin":
        if topic in {"admin-skill-assessments"} or page == "admin-skills":
            suggestions = (
                "How do I archive a skill topic?",
                "How do I import assessment questions?",
                "How do I review assessment analytics?",
                "How do I restore an archived topic?",
                "How do I manage assessment questions?",
                "How do I review company verification requests?",
                "How do I review pending postings?",
            )
        elif "audit" in text or "event" in text or page == "admin-audit-logs":
            suggestions = (
                "How many postings are pending approval?",
                "Show company verification counts.",
                "How do I manage users?",
                "How do I review platform reports?",
                "How do I manage assessment questions?",
                "How do I review pending postings?",
                "How do I verify a company?",
            )
        elif "posting" in text or page == "admin-moderation":
            suggestions = (
                "Explain recent audit events.",
                "Show company verification counts.",
                "How do I manage skill assessments?",
                "How do I manage users?",
                "How do I verify a company?",
                "How do I review pending postings?",
                "How do I review platform reports?",
            )
        else:
            suggestions = (
                "How do I review pending postings?",
                "Show company verification counts.",
                "How do I manage skill assessments?",
                "Explain recent audit events.",
                "How do I review platform reports?",
                "How do I manage users?",
                "How do I moderate postings?",
            )
    if role == "guest":
        suggestions = (
            "How do I register as a student?",
            "How do companies register?",
            "How do I search internships?",
            "How does InternSphere work?",
            "How do I sign in if I forgot my password?",
            "How do I verify my email?",
            "Where can I find the Privacy Center?",
        )
    intent_suggestions = {
        "admin_company_counts": (
            "How many companies are verified?",
            "How many companies are pending verification?",
            "Show recent company registrations.",
        ),
        "admin_student_counts": (
            "How many students are active?",
            "What were today's student signups?",
            "Show recent user registrations.",
        ),
        "admin_posting_counts": (
            "How many postings are pending approval?",
            "Show recent posting changes.",
            "How many postings were approved today?",
        ),
        "admin_today_activity": (
            "Show recent admin activities.",
            "How many internship postings are active?",
            "Are there any open reports?",
        ),
        "admin_recent_registrations": (
            "How many companies are registered?",
            "How many students are active?",
            "Show today's platform activity.",
        ),
        "admin_recent_posting_changes": (
            "Show recent admin activities.",
            "How many postings are pending approval?",
            "Are there any suspicious activities?",
        ),
        "admin_recent_posting_deletions": (
            "What posting changes were recorded recently?",
            "Show recent admin activities.",
            "How many postings are pending approval?",
        ),
        "admin_security_events": (
            "Show recent admin activities.",
            "What changes were made to postings recently?",
            "How many reports are open?",
        ),
        "admin_audit_events": (
            "What changes were made to postings recently?",
            "Show today's platform activity.",
            "Are there any suspicious activities?",
        ),
        "admin_chatbot_low_confidence_questions": (
            "How do I add an article to the help knowledge base?",
            "Show recent admin activities.",
            "How do I check chatbot retrieval quality?",
        ),
        "admin_company_and_posting_counts": (
            "How many students are active?",
            "Show today's platform activity.",
            "Show recent posting changes.",
        ),
        "public_open_internships_count": (
            "How do I find internships matching my skills?",
            "How do I check whether a company is verified?",
            "How do I report a suspicious internship?",
        ),
        "student_applications": (
            "How do I understand application statuses?",
            "How do I withdraw an application?",
            "How do I follow up with a recruiter?",
        ),
        "student_interviews": (
            "How do I review an interview invitation?",
            "What happens when an interview is rescheduled?",
            "Where can I see past interviews?",
        ),
        "student_saved_internships": (
            "How do I apply to a saved internship?",
            "How do I remove a saved internship?",
            "How do I search internships by skills?",
        ),
        "student_skill_assessments": (
            "How long do skill badges last?",
            "When can I retake an assessment?",
            "Where can I review assessment results?",
        ),
        "company_applicants": (
            "How do I shortlist an applicant?",
            "How do I update an application status?",
            "How do I schedule an interview?",
        ),
        "company_shortlisted": (
            "How do I move a candidate through the hiring pipeline?",
            "How do I schedule an interview?",
            "How do I update an application status?",
        ),
        "company_pipeline": (
            "What does each hiring stage mean?",
            "How do I shortlist a candidate?",
            "How do I schedule an interview?",
        ),
        "company_internships": (
            "How do I create or edit an internship posting?",
            "How do I close a posting?",
            "How do I review applicants?",
        ),
        "company_interviews": (
            "How do I reschedule an interview?",
            "How do I cancel an interview?",
            "How do interview reminders work?",
        ),
    }
    if matched_intent == "public_open_internships_count":
        suggestions = (
            (
                "How do I search internships?",
                "How does InternSphere work?",
                "How do I register as a student?",
            )
            if role == "guest"
            else (
                "How do I search internships by skills and location?",
                "How do I apply for an internship?",
                "Where can I see my applications?",
            )
        )
    elif matched_intent in intent_suggestions:
        suggestions = intent_suggestions[matched_intent]
    topic_suggestions = {
        "internship-verification-and-moderation": (
            "What does a verified company badge mean?",
            "How can I report a suspicious internship?",
            "What warning signs should I look for?",
        ),
        "spotting-internship-scams": (
            "How do I know internships are real?",
            "What does the verified company badge mean?",
            "How do I report a suspicious internship?",
        ),
        "reporting-unfair-treatment": (
            "How do I message a recruiter about my application?",
            "Where do I report a misleading internship?",
            "How do I review my application timeline?",
        ),
        "verified-companies": (
            "How are internship postings moderated?",
            "Can I report a verified company's posting?",
            "How do I spot a suspicious offer?",
        ),
        "match-percentage": (
            "How can I improve my profile match?",
            "Do skill badges affect the match percentage?",
            "Does a high match guarantee an interview?",
        ),
        "interview-invites-and-expiry": (
            "Where can I see upcoming interviews?",
            "What happens if an interview is rescheduled?",
            "Where do cancelled or past interviews appear?",
        ),
        "assessment-badges": (
            "How long do verified skill badges last?",
            "When can I retake a skill assessment?",
            "Where can I see my assessment results?",
        ),
    }
    if source_ids and source_ids[0] in topic_suggestions:
        suggestions = topic_suggestions[source_ids[0]]
    if matched_examples:
        suggestions = (*matched_examples, *suggestions)

    excluded = {message.casefold().strip()}
    excluded.update(content.casefold().strip() for _, content in history)
    excluded.update(item.casefold().strip() for item in previous_suggestions)
    selected = []
    for candidate in suggestions:
        normalized = candidate.casefold().strip()
        if normalized not in excluded and normalized not in {item.casefold() for item in selected}:
            selected.append(candidate)
        if len(selected) == 3:
            break
    return tuple(selected)


def _admin_audit_summary(events: list[AuditEventSummary]) -> str:
    """Render recent audit summaries with UTC timestamps and truncate the combined text to the chatbot limit."""
    if not events:
        return "There are no recent audit events to summarize."

    action_verbs = {
        "company_rejected": "rejected",
        "company_verified": "verified",
        "posting_approved": "approved",
        "posting_removed": "removed",
        "posting_rejected": "rejected",
        "user_reinstated": "unblocked",
        "user_suspended": "blocked",
    }
    target_names = {
        "company": "company",
        "internship": "internship",
        "posting": "posting",
        "report": "report",
        "user": "user",
    }
    summaries = []
    for event in events:
        actor_role = (event.actor_role or "").upper()
        actor_label = {
            "ADMIN": "Admin",
            "COMPANY": "Company",
            "STUDENT": "Student",
        }.get(actor_role, "User")
        actor = f"{actor_label} #{event.actor_id}" if event.actor_id is not None else "System"
        target_type = (event.target_type or "").lower()
        target = (
            f"{target_names.get(target_type, 'platform item')} #{event.target_id}"
            if event.target_id is not None
            else "platform settings"
        )
        verb = action_verbs.get(event.action.lower())
        action = verb if verb else f"recorded {audit_action_label(event.action).lower()}"
        timestamp = event.created_at
        if timestamp.tzinfo is None:
            timestamp = timestamp.replace(tzinfo=timezone.utc)
        else:
            timestamp = timestamp.astimezone(timezone.utc)
        summaries.append(
            f"{actor} {action} {target} on {timestamp.strftime('%b %d, %Y at %H:%M UTC')}."
        )
    return _truncate_answer("Recent audit events: " + " ".join(summaries))


class ChatbotService:
    def __init__(
        self,
        *,
        config: ChatbotConfig | None = None,
        retriever: BM25Retriever | None = None,
        provider: AnswerProvider | None = None,
        now=time.monotonic,
    ):
        """Configure retrieval and answer providers, accepting injected dependencies for deterministic use."""
        self.config = config or load_config()
        self.retriever = retriever or BM25Retriever()
        self.curated_answers = _load_curated_answers()
        self.provider = provider or (
            create_answer_provider(self.config)
            if self.config.mode == "llm"
            else RetrievalOnlyProvider()
        )
        self.vector_available = self.config.uses_vector
        self._now = now
        self._requests: dict[str, deque[float]] = defaultdict(deque)
        self.metrics: dict[str, int] = defaultdict(int)

    async def classify_intent_hint(self, message: str, role: str) -> str | None:
        """Ask a router provider for a redacted intent hint, returning ``None`` if routing is unavailable."""
        if not isinstance(self.provider, ChatbotRouterProvider):
            return None
        try:
            return await self.provider.classify_intent(redact(message), role)
        except RuntimeError:
            logger.warning("chatbot_router_fallback")
            return None

    def check_rate_limit(self, key: str, *, authenticated: bool) -> int | None:
        """Record a request if within role-specific rolling limits; otherwise return retry seconds."""
        now = self._now()
        entries = self._requests[key]
        if authenticated:
            per_minute, per_day = self.config.user_per_minute, self.config.user_per_day
            cutoff_minute, cutoff_day = now - 60, now - 86400
            while entries and entries[0] <= cutoff_day:
                entries.popleft()
            if len(entries) >= per_day:
                return max(1, int(entries[0] + 86400 - now + 0.999))
            recent_minute = [stamp for stamp in entries if stamp > cutoff_minute]
            if len(recent_minute) >= per_minute:
                return max(1, int(recent_minute[0] + 60 - now + 0.999))
        else:
            per_minute = self.config.guest_per_minute
            cutoff_minute = now - 60
            while entries and entries[0] <= cutoff_minute:
                entries.popleft()
            if len(entries) >= per_minute:
                return max(1, int(entries[0] + 60 - now + 0.999))
        entries.append(now)
        return None

    async def ask(
        self,
        message: str,
        history: list[tuple[str, str]],
        role: str,
        page: str,
        audit_events: list[AuditEventSummary] | None = None,
        *,
        db: AsyncSession | None = None,
        include_docs: bool = True,
        live_answer: str | None = None,
        live_route: str | None = None,
        live_links: tuple[tuple[str, str], ...] = (),
        previous_suggestions: list[str] | None = None,
        matched_intent: str | None = None,
    ) -> ChatResult:
        """Retrieve and scope help/live context, construct a safe role-aware answer, and attach allowed sources and links."""
        started = time.monotonic()
        normalized_message = " ".join(message.split())
        role_name = role.lower() if role.lower() in {"student", "company", "admin"} else "guest"
        retrieval_role = "guest" if role_name == "guest" else role_name
        secret_in_request = contains_secret(normalized_message) or any(
            contains_secret(content) for _, content in history
        )
        score_threshold = (
            self.config.rag_min_score
            if self.config.uses_vector and self.vector_available and db
            else self.config.min_score
        )
        retrieval_query = normalized_message
        preflight = decide_scope(retrieval_query, [], score_threshold, role_name)
        curated_matches = (
            _match_curated_question(normalized_message, role_name, self.curated_answers)
            if (
                live_answer is None
                and not preflight.account_specific
                and not is_role_capability_question(normalized_message)
            )
            else ()
        )
        passages: list[Passage] = []
        if not secret_in_request and (
            not preflight.refused
            or preflight.refusal_reason == "no_product_intent_or_knowledge_match"
        ) and include_docs:
            if self.config.uses_vector and self.vector_available and db is not None:
                try:
                    passages = _sectioned_passages(await HybridRetriever(self.config).retrieve(
                        db,
                        retrieval_query,
                        retrieval_role,
                        [],
                    ))
                except Exception as error:
                    self.vector_available = False
                    logger.warning(
                        "chatbot_vector_fallback",
                        extra={
                            "chatbot_meta": {
                                "reason": type(error).__name__,
                                "retrieval": "bm25",
                            }
                        },
                    )
                    passages = self.retriever.retrieve(
                        retrieval_query,
                        retrieval_role,
                        top_k=self.config.top_k,
                        minimum_score=self.config.min_score,
                        page_route=PAGE_ROUTES.get(page),
                    )
            else:
                passages = self.retriever.retrieve(
                    retrieval_query,
                    retrieval_role,
                    top_k=self.config.top_k,
                    minimum_score=self.config.min_score,
                    page_route=PAGE_ROUTES.get(page),
                )
        decision = decide_scope(normalized_message, passages, score_threshold, role_name)
        if secret_in_request:
            decision = ScopeDecision("credential", False, True, "credential_detected")
        elif (
            live_answer is not None
            and decision.refusal_reason == "no_product_intent_or_knowledge_match"
        ):
            decision = ScopeDecision("live_data", True, False)
        elif (
            curated_matches
            and decision.refusal_reason == "no_product_intent_or_knowledge_match"
        ):
            decision = ScopeDecision("in_scope", True, False)

        if (
            db is not None
            and not secret_in_request
            and not passages
            and decision.refusal_reason == "no_product_intent_or_knowledge_match"
        ):
            db.add(ChatbotLowConfidenceLog(
                role=role_name,
                question=_privacy_reduced_question(normalized_message),
            ))
            await db.commit()

        answer = ""
        links: tuple[tuple[str, str], ...] = ()
        sources: tuple[tuple[str, str, str], ...] = ()
        source_type = "docs"
        answer_path = "retrieval"
        low_confidence = False
        needs_clarification: str | None = None
        if decision.refused:
            low_confidence = decision.refusal_reason == "no_product_intent_or_knowledge_match"
            answer = _no_evidence_reply() if low_confidence else fixed_reply(decision, role_name)
            answer_path = "fallback" if low_confidence else "refusal"
            if low_confidence:
                source_type = "none"
                links = (("Help docs", "/#faq"),)
        elif curated_matches:
            answer = _truncate_answer("\n\n".join(item.answer for item in curated_matches))
            links = tuple(
                (item.label, item.route)
                for item in curated_matches
                if _is_allowed_live_route(item.route, role_name)
            )
            sources = tuple(
                (
                    *_curated_source(item, normalized_message, self.retriever),
                    item.route,
                )
                for item in curated_matches
                if _is_allowed_live_route(item.route, role_name)
            )
            answer_path = "curated"
        elif is_role_capability_question(normalized_message):
            answer, role_route = _role_capabilities(role_name)
            links = (("Your InternSphere role", role_route),)
        elif live_answer is not None:
            source_type = "live data"
            answer = live_answer
            answer_path = "tool"
            docs_links: tuple[tuple[str, str], ...] = ()
            if include_docs and passages:
                docs_answer = _render_retrieval_answer(passages)
                sources = _sources_for(passages[:1], role_name)
                docs_links = _links_for(passages[:1], role_name)
                if docs_answer:
                    answer = f"{answer}\n\nHelp docs: {docs_answer}"
                    source_type = "docs + live data"
            safe_live_links = tuple(
                (label, route)
                for label, route in live_links
                if _is_allowed_live_route(route, role_name)
                and output_is_safe(label, _role_routes(role_name))
            )
            primary_live_link = (
                ((live_route.rsplit("/", 1)[-1].replace("-", " ").title(), live_route),)
                if live_route and _is_allowed_live_route(live_route, role_name)
                else ()
            )
            links = tuple(dict.fromkeys((*safe_live_links, *primary_live_link, *docs_links)))
        elif (
            role_name == "admin"
            and is_admin_audit_query(normalized_message)
            and not is_how_to_question(normalized_message)
        ):
            answer = _admin_audit_summary(audit_events or [])
            links = (("Recent audit events", PAGE_ROUTES["admin-audit-logs"]),)
            source_type = "live data"
            answer_path = "tool"
        elif decision.account_specific:
            if role_name == "guest":
                answer = "Sign in to InternSphere to request live information for your own account. I can explain the steps, but account data requires an authenticated session."
                links = (("Sign in", "/login"),)
                account_key = None
            else:
                account_terms = {
                    "applications": ("application", "submission", "status"),
                    "interviews": ("interview",),
                    "messages": ("message", "conversation"),
                    "profile": ("profile", "resume"),
                    "notifications": ("notification", "mailbox"),
                }
                account_key = next(
                    (
                        key for key, terms in account_terms.items()
                        if any(term in normalized_message.lower() for term in terms)
                    ),
                    "account",
                )
                answer = GUIDANCE[account_key]
                route = PAGE_ROUTES.get(account_key, "/profile/student")
                links = ((account_key.replace("-", " ").title(), route),)
        elif not passages:
            answer = _no_evidence_reply()
            source_type = "none"
            links = (("Help docs", "/#faq"),)
            low_confidence = True
            answer_path = "fallback"
        elif self.config.mode == "llm":
            answer, sources, links, provider_fallback, needs_clarification = await self._answer_with_provider(
                normalized_message,
                [],
                role_name,
                page,
                passages,
            )
            answer_path = "fallback" if provider_fallback else "model"
            if needs_clarification:
                source_type = "none"
            elif answer == NO_EVIDENCE_ANSWER:
                low_confidence = True
                source_type = "none"
                links = (("Help docs", "/#faq"),)
                if db is not None:
                    db.add(ChatbotLowConfidenceLog(
                        role=role_name,
                        question=_privacy_reduced_question(normalized_message),
                    ))
                    await db.commit()
        else:
            answer = _render_retrieval_answer(passages)
            sources = _sources_for(passages[:1], role_name)
            links = _links_for(passages[:1], role_name)

        allowed_routes = _allowed_routes(passages, role_name) | _role_routes(role_name)
        if live_route and _is_allowed_live_route(live_route, role_name):
            allowed_routes.add(live_route)
        allowed_routes.update(
            route for _, route in live_links if _is_allowed_live_route(route, role_name)
        )
        answer = _truncate_answer(answer)
        if not output_is_safe(answer, allowed_routes):
            safety_failure = _output_safety_failure(answer, allowed_routes)
            safe_live_answer = _truncate_answer(live_answer or "")
            if live_answer is not None and output_is_safe(safe_live_answer, allowed_routes):
                answer = safe_live_answer
                sources = ()
                links = tuple(
                    dict.fromkeys(
                        (
                            *(
                                ((live_route.rsplit("/", 1)[-1].replace("-", " ").title(), live_route),)
                                if live_route and _is_allowed_live_route(live_route, role_name)
                                else ()
                            ),
                            *(
                                (label, route)
                                for label, route in live_links
                                if _is_allowed_live_route(route, role_name)
                                and output_is_safe(label, _role_routes(role_name))
                            ),
                        )
                    )
                )
                source_type = "live data"
            else:
                docs_answer = _render_retrieval_answer(passages)
                if docs_answer and output_is_safe(docs_answer, allowed_routes):
                    answer = docs_answer
                    sources = _sources_for(passages[:1], role_name)
                    links = _links_for(passages[:1], role_name)
                    source_type = "docs"
                elif live_answer is not None and safety_failure != "secret_detection" and (
                    safe_summary := _counts_only_summary(live_answer)
                ) and output_is_safe(safe_summary, _role_routes(role_name)):
                    answer = safe_summary
                    links = ()
                    sources = ()
                    source_type = "live data"
                elif live_answer is not None and live_route and _is_allowed_live_route(
                    live_route,
                    role_name,
                ):
                    answer = "Your live result is available in InternSphere."
                    links = ((live_route.rsplit("/", 1)[-1].replace("-", " ").title(), live_route),)
                    sources = ()
                    source_type = "live data"
                else:
                    answer = "I couldn’t find a safe answer in the help guide."
                    links = ()
                    sources = ()
                    answer_path = "fallback"
                    source_type = "none"
        links = _dedupe_links(links)
        if not answer.strip():
            answer = _no_evidence_reply()
            sources = ()
            source_type = "none"
            links = (("Help docs", "/#faq"),)
            low_confidence = True
            answer_path = "fallback"
        elapsed_ms = round((time.monotonic() - started) * 1000)
        category = "low_confidence" if low_confidence else decision.category
        self.metrics["answered" if answer_path not in {"fallback", "refusal"} else answer_path] += 1
        refused = decision.refused and not low_confidence
        if refused:
            self.metrics["refused"] += 1
        logger.info(
            "chatbot_request",
            extra={
                "chatbot_meta": {
                    "path": answer_path,
                    "category": category,
                    "latency_ms": elapsed_ms,
                    "source_ids": [passage.id for passage in passages[:2]],
                    "retrieval": "hybrid" if self.vector_available else "bm25",
                }
            },
        )
        return ChatResult(
            answer=answer,
            links=links,
            sources=sources,
            source_type=source_type,
            suggested_followups=(
                ()
                if needs_clarification
                else _closest_supported_questions(
                    self.retriever,
                    normalized_message,
                    role_name,
                    page,
                )
                if low_confidence
                else _suggested_followups(
                    role_name,
                    normalized_message,
                    page,
                    history[-3:],
                    tuple(passage.doc_id or passage.id.split("#", 1)[0] for passage in passages),
                    previous_suggestions or [],
                    tuple(
                        example
                        for passage in passages
                        for document in getattr(self.retriever, "documents", ())
                        if document.id == (passage.doc_id or passage.id.split("#", 1)[0])
                        for example in document.examples
                    ),
                    matched_intent,
                )
            ),
            category=category,
            refused=refused,
            matched_ids=tuple(dict.fromkeys((
                *(
                    passage.doc_id or passage.id.split("#", 1)[0]
                    for passage in passages
                ),
                *(item.source for item in curated_matches),
            ))),
            refusal_reason=decision.refusal_reason,
            needs_clarification=needs_clarification,
        )

    async def _answer_with_provider(
        self,
        message: str,
        history: list[tuple[str, str]],
        role: str,
        page: str,
        passages: list[Passage],
    ) -> tuple[
        str,
        tuple[tuple[str, str, str], ...],
        tuple[tuple[str, str], ...],
        bool,
        str | None,
    ]:
        """Request a redacted provider answer and validate its length, citations, and routes, falling back to retrieved text."""
        payload = ProviderPayload(
            question=redact(message),
            history=tuple((turn_role, redact(content)) for turn_role, content in history),
            role=role,
            page=page,
            passages=tuple(passages),
        )
        allowed_ids = {passage.id for passage in passages}
        try:
            result = await self.provider.rewrite(payload)
            clarification = (
                result.needs_clarification.strip()
                if isinstance(result.needs_clarification, str)
                else ""
            )
            if clarification:
                if (
                    result.answerable
                    or len(clarification.split()) > 20
                    or not clarification.endswith("?")
                    or not output_is_safe(
                        clarification,
                        _allowed_routes(passages, role) | _role_routes(role),
                    )
                ):
                    raise ValueError("Provider clarification failed chatbot validation.")
                return clarification, (), (), False, clarification
            if not result.answerable or result.confidence < self.config.rag_min_score:
                return NO_EVIDENCE_ANSWER, (), (("Help docs", "/#faq"),), False, None
            if (
                not result.answer.strip()
                or (passages and not result.sources)
                or len(result.answer.split()) > WORD_LIMIT
                or not set(result.sources).issubset(allowed_ids)
                or not output_is_safe(
                    result.answer,
                    _allowed_routes(passages, role) | _role_routes(role),
                )
            ):
                raise ValueError("Provider output failed chatbot validation.")
            sources = tuple(
                (
                    item.id,
                    item.title,
                    next(route for _, route in (
                        item.links or tuple((item.title, route) for route in item.related_routes)
                    ) if _is_allowed_live_route(route, role)),
                )
                for item in passages
                if item.id in result.sources
                and any(
                    _is_allowed_live_route(route, role)
                    for _, route in (
                        item.links or tuple((item.title, route) for route in item.related_routes)
                    )
                )
            )
            return result.answer.strip(), sources, _links_for(passages, role), False, None
        except (OSError, RuntimeError, TimeoutError, ValueError):
            fallback_answer = _render_retrieval_answer(passages)
            fallback_answer = _truncate_answer(fallback_answer)
            if fallback_answer:
                answer = fallback_answer
            else:
                questions = _closest_supported_questions(
                    self.retriever,
                    payload.question,
                    role,
                    page,
                )
                answer = "I'm not sure about that yet. I can help with:\n" + "\n".join(
                    f"- {question}" for question in questions[:3]
                )
            return (
                answer,
                _sources_for(passages, role),
                _links_for(passages, role),
                True,
                None,
            )
