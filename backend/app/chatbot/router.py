"""Optional-auth HTTP boundary for the stateless chatbot."""

import asyncio
import hashlib
import hmac
import logging
import secrets
from dataclasses import replace
from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request

from app.api.v1.dependencies import DbSession, get_current_user, get_current_user_optional, require_roles
from app.models import User, UserRole
from .chatbot_config import load_config, provider_configured
from .guardrails import is_role_capability_question
from ..schemas.chatbot import ChatAskRequest, ChatAskResponse, ChatFeedbackRequest, ChatLink, ChatSource
from .orchestrator import classify_intent
from .rag.ingest import ingest_knowledge
from .scope import ScopeDecision, decide_scope
from .tools.read_only import execute_read_tool
from ..services.chatbot_service import ChatbotService
from .redaction import contains_secret

logger = logging.getLogger("internsphere.chatbot")
router = APIRouter(prefix="/chatbot", tags=["chatbot"])
_service = ChatbotService()
_settings = load_config()
_rate_limit_salt = secrets.token_bytes(32)
_reindex_last_requested: dict[int, float] = {}
_reindex_rate_limit_seconds = 60

logger.info(
    "chatbot startup: provider configured: %s",
    "yes" if provider_configured(_settings) else "no",
)


def _rate_key(request: Request, user, role: str) -> tuple[str, bool]:
    """Build a salted stable key for signed-in users or fall back to the client's IP for guests."""
    authorization = request.headers.get("authorization", "")
    stable_id = getattr(user, "id", None)
    if role != "guest" and stable_id is not None:
        fingerprint = hmac.new(
            _rate_limit_salt,
            f"user:{stable_id}".encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()
        return f"user-token:{fingerprint}", True
    if role != "guest" and authorization.lower().startswith("bearer "):
        fingerprint = hmac.new(
            _rate_limit_salt,
            authorization[7:].encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()
        return f"user-token:{fingerprint}", True
    client_ip = request.client.host if request.client else "unknown"
    return f"guest-ip:{client_ip}", False


@router.post("/ask", response_model=ChatAskResponse)
async def ask(
    body: ChatAskRequest,
    request: Request,
    db: DbSession,
    user: Annotated[object | None, Depends(get_current_user_optional)],
) -> ChatAskResponse:
    """Apply availability, role, rate, scope, intent, and live-tool checks before returning an answer."""
    config = _service.config
    if not config.enabled:
        raise HTTPException(status_code=404, detail="Not found")
    role_value = getattr(getattr(user, "role", None), "value", "guest")
    role = str(role_value).lower()
    if role not in {"student", "company", "admin"}:
        role = "guest"

    # Never pass identity fields to the chatbot pipeline.
    rate_key, authenticated = _rate_key(request, user, role)
    retry_after = _service.check_rate_limit(rate_key, authenticated=authenticated)
    if retry_after is not None:
        raise HTTPException(
            status_code=429,
            detail=f"Chatbot limit reached. Try again in {retry_after} seconds.",
            headers={"Retry-After": str(retry_after)},
        )
    history = [(turn.role.value, turn.content) for turn in body.history]
    threshold = config.rag_min_score if config.rag_enabled else config.min_score
    preflight = decide_scope(body.message, [], threshold, role)
    if any(contains_secret(content) for _, content in history) and not contains_secret(body.message):
        preflight = ScopeDecision("credential", False, True, "credential_detected")
    live_answer: str | None = None
    live_route: str | None = None
    live_links: tuple[tuple[str, str], ...] = ()
    intent = classify_intent(body.message, role)
    router_intent = None
    if (
        config.mode == "llm"
        and not preflight.refused
        and not is_role_capability_question(body.message)
    ):
        router_intent = await _service.classify_intent_hint(body.message, role)
        if router_intent == "both" and intent.tool_name:
            intent = replace(intent, category="both")
    if (
        not preflight.refused
        or preflight.refusal_reason == "no_product_intent_or_knowledge_match"
    ) and intent.category in {"live_data", "both"}:
        if intent.tool_name and isinstance(user, User):
            try:
                tool_result = await execute_read_tool(
                    intent.tool_name,
                    dict(intent.args),
                    user,
                    db,
                )
                live_answer = tool_result.answer
                live_route = tool_result.route
                live_links = tool_result.links
            except asyncio.TimeoutError:
                logger.warning("chatbot_tool_timeout")
                live_answer = "Live platform data is taking longer than expected. Please retry."
        elif intent.tool_name and user is None:
            live_answer = (
                "Sign in to InternSphere to view live information for your own account."
            )
            live_route = "/login"

    result = await _service.ask(
        body.message,
        history,
        role,
        body.page.value,
        db=db,
        include_docs=intent.category in {"rag_help", "both"},
        live_answer=live_answer,
        live_route=live_route,
        live_links=live_links,
    )
    return ChatAskResponse(
        answer=result.answer,
        links=[ChatLink(label=label, route=route) for label, route in result.links],
        sources=[
            ChatSource(id=source_id, title=title, route=route)
            for source_id, title, route in result.sources
        ],
        source_type=result.source_type,
        suggested_followups=list(result.suggested_followups),
        category=result.category,
        refused=result.refused,
    )


@router.get("/status")
async def chatbot_status(db: DbSession) -> dict[str, bool | str | int | None]:
    """Report chatbot configuration and, when RAG is enabled, indexed chunk totals and latest update."""
    from sqlalchemy import text

    indexed_chunks = 0
    last_indexed_at = None
    if _settings.rag_enabled:
        row = (await db.execute(
            text("SELECT count(*) AS chunk_count, max(updated_at) AS indexed_at FROM kb_chunks")
        )).mappings().one()
        indexed_chunks = int(row["chunk_count"])
        last_indexed_at = row["indexed_at"].isoformat() if row["indexed_at"] else None
    return {
        "enabled": _settings.enabled,
        "mode": _settings.mode,
        "provider_configured": provider_configured(_settings),
        "rag_enabled": _settings.rag_enabled,
        "indexed_chunk_count": indexed_chunks,
        "last_indexed_at": last_indexed_at,
    }


@router.post("/reindex")
async def reindex_chatbot_knowledge(
    user: Annotated[User, Depends(require_roles(UserRole("ADMIN")))],
) -> dict[str, int]:
    """Rate-limit administrator-triggered knowledge reindexing and return its chunk counts."""
    config = load_config()
    if not config.enabled or not config.rag_enabled:
        raise HTTPException(status_code=404, detail="Knowledge indexing is not available.")
    now = asyncio.get_running_loop().time()
    previous = _reindex_last_requested.get(user.id)
    if previous is not None and now - previous < _reindex_rate_limit_seconds:
        retry_after = int(_reindex_rate_limit_seconds - (now - previous) + 0.999)
        raise HTTPException(
            status_code=429,
            detail=f"Reindex limit reached. Try again in {retry_after} seconds.",
            headers={"Retry-After": str(retry_after)},
        )
    _reindex_last_requested[user.id] = now
    result = await ingest_knowledge(config)
    return result


@router.post("/feedback", status_code=204)
async def chatbot_feedback(
    body: ChatFeedbackRequest,
    user: Annotated[User, Depends(get_current_user)],
) -> None:
    """Log a feedback rating and non-sensitive turn metadata without storing message content."""
    correlation_id = uuid4().hex
    logger.info(
        "chatbot_feedback",
        extra={
            "chatbot_meta": {
                "correlation_id": correlation_id,
                "user_id": user.id,
                "role": user.role.value.lower(),
                "rating": body.rating,
                "source_type": body.source_type,
                "turn_id": body.turn_id,
            }
        },
    )
