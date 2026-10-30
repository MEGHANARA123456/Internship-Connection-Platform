"""Stateless, privacy-preserving chatbot decision pipeline."""

import logging
import re
import time
from collections import defaultdict, deque
from dataclasses import dataclass
from datetime import timezone

from sqlalchemy.ext.asyncio import AsyncSession

from ..chatbot.chatbot_config import ChatbotConfig, load_config
from ..chatbot.guardrails import is_role_capability_question, output_is_safe
from ..chatbot.providers import create_answer_provider
from ..chatbot.providers.base import AnswerProvider, ChatbotRouterProvider, Passage, ProviderPayload
from ..chatbot.providers.retrieval_only import RetrievalOnlyProvider
from ..chatbot.rag.retriever import HybridRetriever
from ..chatbot.redaction import contains_secret, redact
from ..chatbot.retriever import BM25Retriever
from ..chatbot.scope import ScopeDecision, decide_scope, fixed_reply, is_admin_audit_query
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
COMMON_ROUTES = {
    "/", "/opportunities", "/login", "/register-student", "/register-company",
    "/forgot-password", "/reset-password", "/verify", "/privacy", "/privacy-center",
    "/privacy-security",
}
ROLE_ROUTES = {
    "guest": COMMON_ROUTES,
    "student": COMMON_ROUTES | {
        "/applications", "/profile/student", "/interviews", "/messages",
        "/notifications", "/saved", "/student/analytics",
    },
    "company": COMMON_ROUTES | {
        "/company", "/company/jobs", "/company/internships/new", "/company/applicants",
        "/company/pipeline", "/company/shortlisted", "/company/analytics",
        "/company/settings", "/profile/company", "/interviews", "/messages", "/notifications",
    },
    "admin": COMMON_ROUTES | {
        "/admin", "/admin/moderation", "/admin/companies", "/admin/users",
        "/admin/verifications", "/admin/reports", "/admin/audit-logs",
        "/admin/skill-assessments", "/notifications",
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


def _no_evidence_reply(role: str) -> str:
    """Return a role-specific help-guide fallback when retrieval provides no usable evidence."""
    suggestions = {
        "student": "I can help with finding internships, applications, or skill assessments.",
        "company": "I can help with internship postings, applicants, or your hiring pipeline.",
        "admin": "I can help with moderation, company verification, or audit reports.",
        "guest": "I can help with registration, finding internships, or general platform features.",
    }
    return f"I couldn’t find that in the help guide. {suggestions.get(role, suggestions['guest'])}"


def _role_routes(role: str) -> set[str]:
    """Return the routes permitted for a role, defaulting unknown roles to guest routes."""
    return ROLE_ROUTES.get(role, COMMON_ROUTES)


def _is_allowed_live_route(route: str, role: str) -> bool:
    """Check role route access, allowing students to open numeric opportunity-detail routes."""
    if route in _role_routes(role):
        return True
    return role == "student" and re.fullmatch(r"/opportunities/[1-9]\d*", route) is not None


def _allowed_routes(passages: list[Passage], role: str) -> set[str]:
    """Collect role-authorized routes referenced by retrieved passages."""
    role_routes = _role_routes(role)
    return {
        route
        for passage in passages
        for route in passage.related_routes
        if route in role_routes
    }


def _links_for(passages: list[Passage], role: str) -> tuple[tuple[str, str], ...]:
    """Build up to four unique, role-authorized passage-title links."""
    links = []
    seen = set()
    role_routes = _role_routes(role)
    for passage in passages:
        for route in passage.related_routes:
            if route not in seen and route in role_routes:
                seen.add(route)
                links.append((passage.title, route))
    return tuple(links[:4])


def _sources_for(passages: list[Passage], role: str) -> tuple[tuple[str, str, str], ...]:
    """Return up to five distinct passage IDs paired with titles and each passage's first allowed route."""
    sources = []
    seen: set[str] = set()
    role_routes = _role_routes(role)
    for passage in passages:
        route = next(
            (item for item in passage.related_routes if item in role_routes),
            None,
        )
        if route and passage.id not in seen:
            seen.add(passage.id)
            sources.append((passage.id, passage.title, route))
    return tuple(sources[:5])


def _dedupe_links(links: tuple[tuple[str, str], ...]) -> tuple[tuple[str, str], ...]:
    """Keep the first link for each route while preserving input order."""
    unique = []
    seen_routes: set[str] = set()
    for link in links:
        if link[1] not in seen_routes:
            seen_routes.add(link[1])
            unique.append(link)
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


def _suggested_followups(role: str, message: str) -> tuple[str, ...]:
    """Choose canned follow-up questions from role and message keywords, with a role-specific default set."""
    text = message.casefold()
    if role == "student":
        if any(term in text for term in ("application", "submission")):
            return (
                "How do I withdraw an application?",
                "Any interviews coming up?",
                "How do I understand application statuses?",
            )
        if any(term in text for term in ("match", "recommend", "internships")) and "profile" in text:
            return (
                "Show my saved internships.",
                "How do I apply to an internship?",
                "How do I update my profile skills?",
            )
        if "interview" in text:
            return (
                "How do I prepare for an interview?",
                "Where can I see my applications?",
                "How do notifications work?",
            )
    if role == "company":
        if any(term in text for term in ("applicant", "candidate", "shortlist")):
            return (
                "How do I shortlist a candidate?",
                "Show my hiring pipeline counts.",
                "How do I schedule an interview?",
            )
        if "interview" in text:
            return (
                "How do I schedule an interview?",
                "How do I update an application status?",
                "Show applicants for my internships.",
            )
    if role == "admin":
        if any(term in text for term in ("audit", "event", "action")):
            return (
                "How do I review pending postings?",
                "How many postings are pending approval?",
                "Show company verification counts.",
            )
        if any(term in text for term in ("posting", "approval")):
            return (
                "How do I approve or reject a posting?",
                "Explain recent audit events.",
                "Show company verification counts.",
            )
    return {
        "student": (
            "How do I withdraw an application?",
            "What is my application status?",
            "How do I update my resume?",
        ),
        "company": (
            "How do I shortlist a candidate?",
            "Who applied to my internship?",
            "How do I schedule an interview?",
        ),
        "admin": (
            "Explain recent audit events.",
            "How many postings are pending approval?",
            "How do I verify a company?",
        ),
    }.get(role, (
        "How do I register?",
        "How do I reset my password?",
        "How do I search internships?",
    ))


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
        self.provider = provider or (
            create_answer_provider(self.config)
            if self.config.mode == "llm"
            else RetrievalOnlyProvider()
        )
        self._now = now
        self._requests: dict[str, deque[float]] = defaultdict(deque)

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
    ) -> ChatResult:
        """Retrieve and scope help/live context, construct a safe role-aware answer, and attach allowed sources and links."""
        started = time.monotonic()
        normalized_message = " ".join(message.split())
        role_name = role.lower() if role.lower() in {"student", "company", "admin"} else "guest"
        retrieval_role = "guest" if role_name == "guest" else role_name
        secret_in_request = contains_secret(normalized_message) or any(
            contains_secret(content) for _, content in history
        )
        score_threshold = self.config.rag_min_score if self.config.rag_enabled and db else self.config.min_score
        preflight = decide_scope(normalized_message, [], score_threshold, role_name)
        passages: list[Passage] = []
        if not secret_in_request and (
            not preflight.refused
            or preflight.refusal_reason == "no_product_intent_or_knowledge_match"
        ) and include_docs:
            if self.config.rag_enabled and db is not None:
                passages = await HybridRetriever(self.config).retrieve(
                    db,
                    normalized_message,
                    retrieval_role,
                    history,
                )
            else:
                passages = self.retriever.retrieve(
                    normalized_message,
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

        answer = ""
        links: tuple[tuple[str, str], ...] = ()
        sources: tuple[tuple[str, str, str], ...] = ()
        source_type = "docs"
        answer_path = "retrieval"
        if decision.refused:
            answer = (
                _no_evidence_reply(role_name)
                if decision.refusal_reason == "no_product_intent_or_knowledge_match"
                else fixed_reply(decision, role_name)
            )
            answer_path = "refusal"
        elif is_role_capability_question(normalized_message):
            answer, role_route = _role_capabilities(role_name)
            links = (("Your InternSphere role", role_route),)
        elif live_answer is not None:
            source_type = "live data"
            if self.config.mode == "llm":
                answer, sources, links, provider_fallback = await self._answer_with_provider(
                    normalized_message,
                    history,
                    role_name,
                    page,
                    passages if include_docs else [],
                    live_data=live_answer,
                )
                answer_path = "fallback" if provider_fallback else "model"
                if include_docs and passages:
                    source_type = "docs + live data"
            else:
                answer = live_answer
                answer_path = "tool"
                if include_docs and passages:
                    docs_answer, sources, doc_links = (
                        _render_retrieval_answer(passages),
                        _sources_for(passages, role_name),
                        _links_for(passages, role_name),
                    )
                    if docs_answer:
                        answer = f"{answer} Help docs: {docs_answer}"
                        source_type = "docs + live data"
                    links = doc_links
            if live_route:
                if _is_allowed_live_route(live_route, role_name):
                    links = tuple(dict.fromkeys((*links, (live_route.rsplit("/", 1)[-1].replace("-", " ").title(), live_route))))
            safe_live_links = tuple(
                (label, route)
                for label, route in live_links
                if _is_allowed_live_route(route, role_name)
                and output_is_safe(label, _role_routes(role_name))
            )
            links = tuple(dict.fromkeys((*links, *safe_live_links)))
        elif role_name == "admin" and is_admin_audit_query(normalized_message):
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
            answer = _no_evidence_reply(role_name)
        elif self.config.mode == "llm":
            answer, sources, links, provider_fallback = await self._answer_with_provider(
                normalized_message,
                history,
                role_name,
                page,
                passages,
            )
            answer_path = "fallback" if provider_fallback else "model"
        else:
            answer = _render_retrieval_answer(passages)
            sources = _sources_for(passages, role_name)
            links = _links_for(passages, role_name)

        allowed_routes = _allowed_routes(passages, role_name) | _role_routes(role_name)
        if live_route and _is_allowed_live_route(live_route, role_name):
            allowed_routes.add(live_route)
        allowed_routes.update(
            route for _, route in live_links if _is_allowed_live_route(route, role_name)
        )
        answer = _truncate_answer(answer)
        if not output_is_safe(answer, allowed_routes):
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
                answer = _render_retrieval_answer(passages) or "I couldn’t find a safe answer in the help guide."
                sources = _sources_for(passages, role_name)
                links = _links_for(passages, role_name)
                source_type = "docs"
                if not output_is_safe(answer, allowed_routes):
                    answer = "I couldn’t find a safe answer in the help guide."
                    links = ()
                    sources = ()
                    answer_path = "fallback"
        links = _dedupe_links(links)
        if not answer.strip():
            answer = _render_retrieval_answer(passages) or "I couldn’t find an answer in the help guide."
            answer_path = "fallback"
        elapsed_ms = round((time.monotonic() - started) * 1000)
        logger.info(
            "chatbot_request",
            extra={
                "chatbot_meta": {
                    "path": answer_path,
                    "latency_ms": elapsed_ms,
                }
            },
        )
        return ChatResult(
            answer=answer,
            links=links,
            sources=sources,
            source_type=source_type,
            suggested_followups=_suggested_followups(role_name, normalized_message),
            category=decision.category,
            refused=decision.refused,
            matched_ids=tuple(passage.id for passage in passages),
            refusal_reason=decision.refusal_reason,
        )

    async def _answer_with_provider(
        self,
        message: str,
        history: list[tuple[str, str]],
        role: str,
        page: str,
        passages: list[Passage],
        live_data: str | None = None,
    ) -> tuple[
        str,
        tuple[tuple[str, str, str], ...],
        tuple[tuple[str, str], ...],
        bool,
    ]:
        """Request a redacted provider answer and validate its length, citations, and routes, falling back to retrieved text."""
        payload = ProviderPayload(
            question=redact(message),
            history=tuple((turn_role, redact(content)) for turn_role, content in history),
            role=role,
            page=page,
            passages=tuple(passages),
            live_data=live_data,
        )
        allowed_ids = {passage.id for passage in passages}
        try:
            result = await self.provider.rewrite(payload)
            if (
                not result.answerable
                or not result.answer.strip()
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
                (item.id, item.title, next(
                    route for route in item.related_routes if route in _role_routes(role)
                ))
                for item in passages
                if item.id in result.sources
                and any(route in _role_routes(role) for route in item.related_routes)
            )
            return result.answer.strip(), sources, _links_for(passages, role), False
        except (OSError, RuntimeError, TimeoutError, ValueError):
            fallback_answer = _render_retrieval_answer(passages) or live_data or ""
            fallback_answer = _truncate_answer(fallback_answer)
            notice = "I couldn’t reach the answer service, so this is the help-guide answer."
            answer = f"{fallback_answer} {notice}".strip()
            if not fallback_answer:
                answer = "I couldn’t reach the answer service or find a matching help article. Please try a specific platform feature."
            return (
                answer,
                _sources_for(passages, role),
                _links_for(passages, role),
                True,
            )
