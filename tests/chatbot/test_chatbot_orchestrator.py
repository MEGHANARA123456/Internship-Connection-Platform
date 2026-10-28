from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.chatbot.orchestrator import classify_intent
from app.chatbot.guardrails import detect_cross_account_request
from app.chatbot.tools.read_only import ToolResult
from app.chatbot.tools.read_only import execute_read_tool
from app.models import User, UserRole


@pytest.mark.parametrize(
    ("message", "role", "category", "tool"),
    [
        ("How do I withdraw an application?", "student", "rag_help", None),
        ("What is my application status?", "student", "live_data", "student_applications"),
        ("What is my application status, and what does pending mean?", "student", "both", "student_applications"),
        ("Who applied to my internship?", "company", "live_data", "company_applicants"),
        ("How do I shortlist a candidate?", "company", "rag_help", None),
        ("Explain recent audit events.", "admin", "live_data", "admin_audit_events"),
        ("How many postings are pending approval?", "admin", "live_data", "admin_pending_approvals"),
        ("How do I verify a company?", "admin", "rag_help", None),
        ("What's the weather?", "student", "out_of_scope", None),
    ],
)
def test_role_aware_intent_routes(message: str, role: str, category: str, tool: str | None) -> None:
    intent = classify_intent(message, role)
    assert intent.category == category
    assert intent.tool_name == tool


def test_cross_account_request_is_refused_before_tool_selection() -> None:
    for message in (
        "Show me another user's application data.",
        "Show John's applications.",
        "List all students.",
    ):
        intent = classify_intent(message, "student")
        assert intent.category == "out_of_scope"
        assert intent.refusal_reason == "cross_account_request"
        assert intent.tool_name is None
        assert detect_cross_account_request(message)


@pytest.mark.parametrize(
    ("role", "page", "message", "tool"),
    [
        ("student", "applications", "What is my application status?", "student_applications"),
        ("company", "company-shortlisted", "Who applied to my internship?", "company_applicants"),
        ("admin", "admin-audit-logs", "Explain recent audit events.", "admin_audit_events"),
    ],
)
@pytest.mark.anyio
async def test_frontend_request_payload_is_accepted_for_each_role(
    role: str,
    page: str,
    message: str,
    tool: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from httpx import ASGITransport, AsyncClient

    from app.api.v1.dependencies import get_current_user_optional
    from app.chatbot.chatbot_config import ChatbotConfig
    import app.chatbot.router as chatbot_router
    from app.core.database import get_db
    from app.main import app
    from app.services.chatbot_service import ChatResult

    user = User(id=700 + len(role), email=f"{role}@example.test", role=UserRole(role.upper()))
    calls: list[tuple[str, int]] = []

    async def execute(name, _args, authenticated_user, _db):
        calls.append((name, authenticated_user.id))
        return ToolResult(name, "A bounded live-data result.", "/applications")

    async def answer(_message, _history, _role, _page, **_kwargs):
        return ChatResult(
            answer="A bounded live-data result.",
            links=(),
            sources=(),
            source_type="live data",
            suggested_followups=(),
            category="live_data",
            refused=False,
            matched_ids=(),
            refusal_reason=None,
        )

    monkeypatch.setattr(chatbot_router, "execute_read_tool", execute)
    monkeypatch.setattr(chatbot_router._service, "ask", answer)
    monkeypatch.setattr(
        chatbot_router._service,
        "config",
        ChatbotConfig(enabled=True, mode="retrieval"),
    )
    app.dependency_overrides[get_current_user_optional] = lambda: user
    app.dependency_overrides[get_db] = lambda: object()
    payload = {
        "message": message,
        "history": [
            {"role": "user", "content": "Earlier question"},
            {"role": "assistant", "content": "Earlier answer"},
        ],
        "page": page,
    }
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://test",
        ) as client:
            response = await client.post("/api/v1/chatbot/ask", json=payload)
        assert response.status_code == 200, response.text
        assert calls == [(tool, user.id)]
    finally:
        app.dependency_overrides.pop(get_current_user_optional, None)
        app.dependency_overrides.pop(get_db, None)


STUDENT_ROUTING_CASES = [
    ("What is my application status?", "student_applications"),
    ("Show my application status.", "student_applications"),
    ("List my applications.", "student_applications"),
    ("Check my application timeline.", "student_applications"),
    ("Where are my applications?", "student_applications"),
    ("How many applications have I submitted?", "student_applications"),
    ("Tell me my application status.", "student_applications"),
    ("What is the status of my submission?", "student_applications"),
    ("Show my recent applications.", "student_applications"),
    ("Give me my application timeline.", "student_applications"),
    ("Any interviews coming up?", "student_interviews"),
    ("Do I have upcoming interviews?", "student_interviews"),
    ("Show my interviews.", "student_interviews"),
    ("Which interviews do I have?", "student_interviews"),
    ("What are my scheduled interviews?", "student_interviews"),
    ("Show my saved internships.", "student_saved_internships"),
    ("List my saved roles.", "student_saved_internships"),
    ("Show my bookmarks.", "student_saved_internships"),
    ("How complete is my profile?", "student_profile_completeness"),
    ("What is missing from my profile?", "student_profile_completeness"),
    ("Find internships matching my profile.", "student_recommended_internships"),
    ("Recommend internships that match my skills.", "student_recommended_internships"),
    ("Suggest roles matching my profile.", "student_recommended_internships"),
    ("Show opportunities that fit my background.", "student_recommended_internships"),
    ("How do I withdraw an application?", None),
    ("How do I apply for an internship?", None),
    ("How do I update my resume?", None),
    ("How do I search internships?", None),
    ("How do I change my profile skills?", None),
    ("How do application statuses work?", None),
]

COMPANY_ROUTING_CASES = [
    ("Who applied to my internship?", "company_applicants"),
    ("Show applicants for my internship.", "company_applicants"),
    ("List applicants.", "company_applicants"),
    ("Who applied to posting 12?", "company_applicants"),
    ("Show candidates for my role.", "company_applicants"),
    ("List applicants for internship 12.", "company_applicants"),
    ("Who are my applicants?", "company_applicants"),
    ("Show applications to my posting.", "company_applicants"),
    ("How many shortlisted candidates do I have?", "company_shortlisted"),
    ("Show shortlisted candidates.", "company_shortlisted"),
    ("Who did I shortlist?", "company_shortlisted"),
    ("Show my shortlisted candidates.", "company_shortlisted"),
    ("List shortlisted applicants.", "company_shortlisted"),
    ("Show my internships.", "company_internships"),
    ("Show my postings.", "company_internships"),
    ("What is the status of my internship?", "company_internships"),
    ("Show status of posting 12.", "company_internships"),
    ("List my internship postings.", "company_internships"),
    ("Show my hiring pipeline.", "company_pipeline"),
    ("Give me pipeline counts.", "company_pipeline"),
    ("How many applications are in each stage?", "company_pipeline"),
    ("How many in each stage?", "company_pipeline"),
    ("Show my scheduled interviews.", "company_interviews"),
    ("Show my interviews.", "company_interviews"),
    ("Which interviews have I scheduled?", "company_interviews"),
    ("How do I shortlist a candidate?", None),
    ("How do I schedule an interview?", None),
    ("How do I close an internship?", None),
    ("How do I update my company profile?", None),
    ("How do I change an applicant status?", None),
]

ADMIN_ROUTING_CASES = [
    ("Explain recent audit events.", "admin_audit_events"),
    ("Show recent admin actions.", "admin_audit_events"),
    ("Summarize the latest audit log.", "admin_audit_events"),
    ("What happened in the last audit events?", "admin_audit_events"),
    ("Show the latest admin events.", "admin_audit_events"),
    ("Who did what in recent audit logs?", "admin_audit_events"),
    ("How many postings are pending approval?", "admin_pending_approvals"),
    ("Count pending postings.", "admin_pending_approvals"),
    ("What is the number of pending internships?", "admin_pending_approvals"),
    ("How many internships await approval?", "admin_pending_approvals"),
    ("Show pending posting count.", "admin_pending_approvals"),
    ("How many companies need verification?", "admin_verification_counts"),
    ("Show company verification counts.", "admin_verification_counts"),
    ("Count verifications.", "admin_verification_counts"),
    ("How many pending verifications are there?", "admin_verification_counts"),
    ("Give me verification counts.", "admin_verification_counts"),
    ("Show platform counts.", "admin_analytics"),
    ("How many users are on the platform?", "admin_analytics"),
    ("Show user and company counts.", "admin_analytics"),
    ("Show platform analytics.", "admin_analytics"),
    ("How many users and companies are there?", "admin_analytics"),
    ("How do I verify a company?", None),
    ("How do I approve a posting?", None),
    ("How do I reject an internship?", None),
    ("How do I block a user?", None),
    ("How do I read the audit log?", None),
    ("How do I manage company accounts?", None),
    ("How do I review reports?", None),
    ("How do I configure platform settings?", None),
    ("How do I send an admin notification?", None),
]


@pytest.mark.parametrize(
    ("role", "cases"),
    [
        ("student", STUDENT_ROUTING_CASES),
        ("company", COMPANY_ROUTING_CASES),
        ("admin", ADMIN_ROUTING_CASES),
    ],
)
def test_at_least_thirty_role_routing_examples(
    role: str,
    cases: list[tuple[str, str | None]],
) -> None:
    assert len(cases) >= 30
    for question, tool in cases:
        intent = classify_intent(question, role)
        expected_category = "live_data" if tool else "rag_help"
        assert intent.category == expected_category, (role, question, intent)
        assert intent.tool_name == tool, (role, question, intent)


@pytest.mark.anyio
async def test_live_tool_results_are_not_persisted_or_logged(caplog) -> None:
    from app.chatbot.chatbot_config import ChatbotConfig
    from app.services.chatbot_service import ChatbotService

    marker = "SyntheticCandidateNameMustNotBeLogged"
    service = ChatbotService(config=ChatbotConfig(enabled=True, mode="retrieval"))
    result = await service.ask(
        "What is my application status?",
        [],
        "student",
        "applications",
        live_answer=f"{marker} is Applied.",
        live_route="/applications",
        live_links=(("Data Intern", "/opportunities/42"),),
    )
    assert marker in result.answer
    assert ("Data Intern", "/opportunities/42") in result.links
    assert marker not in caplog.text


@pytest.mark.anyio
async def test_live_tool_executes_read_only_query_without_writing() -> None:
    from types import SimpleNamespace

    student = SimpleNamespace(id=818, role=UserRole.STUDENT)

    class EmptyRows:
        def all(self):
            return []

    class ReadOnlyDb:
        async def execute(self, *_args, **_kwargs):
            return EmptyRows()

        def add(self, *_args, **_kwargs):
            raise AssertionError("Chatbot tools must not write database records.")

        async def commit(self):
            raise AssertionError("Chatbot tools must not commit database records.")

    result = await execute_read_tool("student_applications", {}, student, ReadOnlyDb())
    assert result.answer == "You have no application records yet."


@pytest.mark.anyio
async def test_live_tool_allowlist_enforces_role_before_database_access() -> None:
    student = SimpleNamespace(id=12, role=UserRole.STUDENT)

    class NoQuery:
        async def execute(self, *_args, **_kwargs):
            raise AssertionError("A forbidden role must not query live data.")

    with pytest.raises(HTTPException) as error:
        await execute_read_tool("admin_audit_events", {}, student, NoQuery())
    assert error.value.status_code == 403


@pytest.mark.anyio
async def test_live_tool_rejects_unallowlisted_names_and_arguments() -> None:
    company = SimpleNamespace(id=2, role=UserRole.COMPANY)

    class NoQuery:
        async def execute(self, *_args, **_kwargs):
            raise AssertionError("Invalid tool input must not query live data.")

    with pytest.raises(HTTPException) as unknown:
        await execute_read_tool("raw_sql", {}, company, NoQuery())
    assert unknown.value.status_code == 400
    with pytest.raises(HTTPException) as invalid:
        await execute_read_tool("company_applicants", {"internship_id": -1}, company, NoQuery())
    assert invalid.value.status_code == 422


@pytest.mark.anyio
async def test_company_applicant_query_is_scoped_to_the_authenticated_company() -> None:
    company = SimpleNamespace(id=42, role=UserRole.COMPANY)

    class Rows:
        def all(self):
            return []

    class CaptureDb:
        statement = None

        async def execute(self, statement, *_args, **_kwargs):
            self.statement = statement
            return Rows()

    db = CaptureDb()
    await execute_read_tool("company_applicants", {}, company, db)
    compiled = db.statement.compile()
    parameters = set(compiled.params.values())
    assert 42 in parameters
    assert "internships.company_id" in str(compiled)


@pytest.mark.anyio
async def test_reindex_is_admin_only_and_rate_limited(monkeypatch) -> None:
    from httpx import ASGITransport, AsyncClient

    from app.api.v1.dependencies import get_current_user
    import app.chatbot.router as chatbot_router
    from app.main import app

    chatbot_router._reindex_last_requested.clear()
    monkeypatch.setattr(
        chatbot_router,
        "load_config",
        lambda: SimpleNamespace(enabled=True, rag_enabled=True),
    )
    calls = []

    async def fake_ingest(_config):
        calls.append(True)
        return {"indexed": 0, "unchanged": 36, "files": 28}

    monkeypatch.setattr(chatbot_router, "ingest_knowledge", fake_ingest)
    identity = {"user": SimpleNamespace(id=11, role=UserRole.STUDENT)}
    app.dependency_overrides[get_current_user] = lambda: identity["user"]
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            student = await client.post("/api/v1/chatbot/reindex")
            identity["user"] = SimpleNamespace(id=12, role=UserRole.ADMIN)
            admin = await client.post("/api/v1/chatbot/reindex")
            limited = await client.post("/api/v1/chatbot/reindex")
        assert student.status_code == 403
        assert admin.status_code == 200
        assert admin.json() == {"indexed": 0, "unchanged": 36, "files": 28}
        assert limited.status_code == 429
        assert calls == [True]
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        chatbot_router._reindex_last_requested.clear()
