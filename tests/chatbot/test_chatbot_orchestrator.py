from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.chatbot.orchestrator import (
    INTENT_TOOL_ROLE_TABLE,
    classify_intent,
    resolve_followup,
)
from app.chatbot.guardrails import detect_cross_account_request
from app.chatbot.tools.read_only import TOOL_ROLES, ToolResult, execute_read_tool
from app.models import Application, CompanyProfile, Internship, StudentProfile, User, UserRole


@pytest.mark.parametrize(
    ("message", "role", "category", "tool"),
    [
        ("How do I withdraw an application?", "student", "rag_help", None),
        ("What is my application status?", "student", "live_data", "student_applications"),
        ("Show my application status.", "student", "live_data", "student_applications"),
        ("Where can I see my applications?", "student", "rag_help", None),
        ("How many assessments have I attended?", "student", "live_data", "student_skill_assessments"),
        ("How do I manage assessment questions?", "admin", "rag_help", None),
        ("How do I archive a skill topic?", "admin", "rag_help", None),
        ("How do I manage assessment questions?", "student", "out_of_scope", None),
        ("What is my application status, and what does pending mean?", "student", "both", "student_applications"),
        ("Who applied to my internship?", "company", "live_data", "company_applicants"),
        ("How do I shortlist a candidate?", "company", "rag_help", None),
        ("Explain recent audit events.", "admin", "live_data", "admin_audit_events"),
        ("How many postings are pending approval?", "admin", "live_data", "admin_pending_approvals"),
        ("How do I review pending postings?", "admin", "rag_help", None),
        ("How do I review company verification requests?", "admin", "rag_help", None),
        ("Show pending postings.", "admin", "live_data", "admin_pending_approvals"),
        ("Show company verification counts.", "admin", "live_data", "admin_verification_counts"),
        ("how many topics in skill assessment", "admin", "live_data", "admin_skill_assessment_stats"),
        ("How do I import assessment questions?", "admin", "rag_help", None),
        ("How many applications i have", "student", "live_data", "student_application_counts"),
        ("shortlisted count of applications", "student", "live_data", "student_application_counts"),
        ("how many applications are applied", "student", "live_data", "student_application_counts"),
        ("How many applications have I submitted?", "student", "live_data", "student_application_counts"),
        ("When can I retake a skill assessment?", "student", "both", "student_skill_retake"),
        ("what are my skills and where i have to improve", "student", "live_data", "student_skill_gap"),
        ("any offers", "student", "live_data", "student_application_counts"),
        ("Find internships matching my profile.", "student", "live_data", "student_recommended_internships"),
        ("how many applicants do I have", "company", "live_data", "company_applicants"),
        ("shortlisted candidates", "company", "live_data", "company_shortlisted"),
        ("my active postings", "company", "live_data", "company_internships"),
        ("How do I schedule an interview?", "company", "rag_help", None),
        ("How do I verify a company?", "admin", "rag_help", None),
        ("Why can't I apply for an internship?", "student", "rag_help", None),
        ("Where can I see my applied internships?", "student", "live_data", "student_applications"),
        ("What is happening in my account?", "student", "live_data", "student_account_summary"),
        ("What's going on in my account?", "company", "live_data", "company_account_summary"),
        ("How do I change it?", "company", "rag_help", None),
        ("List my applications", "admin", "rag_help", None),
        ("How many are shortlisted?", "student", "live_data", "student_application_counts"),
        ("Any interviews coming up?", "student", "live_data", "student_interviews"),
        ("How many current internships are there?", "guest", "live_data", "public_open_internships_count"),
        ("Show current internships from verified companies.", "guest", "live_data", "public_open_internships_count"),
        ("Audit summary", "admin", "live_data", "admin_audit_events"),
        ("What is happening on the platform?", "admin", "live_data", "admin_platform_summary"),
        ("How many applicants do I have?", "company", "live_data", "company_applicants"),
        ("How many interviews are scheduled for my company?", "company", "live_data", "company_interviews"),
        ("What's the weather?", "student", "out_of_scope", None),
    ],
)
def test_role_aware_intent_routes(message: str, role: str, category: str, tool: str | None) -> None:
    intent = classify_intent(message, role)
    assert intent.category == category
    assert intent.tool_name == tool


@pytest.mark.parametrize(
    "question",
    [
        "Show current internships from verified companies.",
        "List available internships right now.",
        "What open internship roles are on the platform?",
        "Are there live opportunities from verified employers?",
        "Show open opportunities today.",
        "Are any internships open for applications?",
        "List published and available internship roles.",
        "How many internships can guests view?",
        "Count live internship opportunities.",
    ],
)
def test_public_open_internship_paraphrases_route_to_public_tool(question: str) -> None:
    intent = classify_intent(question, "guest")

    assert intent.category == "live_data"
    assert intent.tool_name == "public_open_internships_count"


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


def test_followup_context_uses_only_the_last_user_turn() -> None:
    history = [
        ("user", "How many applications do I have?"),
        ("assistant", "You have 6 applications, including an assessment attempt."),
    ]
    assert resolve_followup("and interviews?", history, "applications") == (
        "How many applications do I have? Follow-up: and interviews?"
    )
    assert resolve_followup(
        "When can I retake a skill assessment?",
        history,
        "profile",
    ) == "When can I retake a skill assessment?"
    assert resolve_followup("then?", [("assistant", "assessment counts")], "home") == "then?"


@pytest.mark.anyio
async def test_live_admin_and_public_counts_use_dashboard_rules() -> None:
    from datetime import date, timedelta

    from sqlalchemy import func, select
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from app.models.base import Base

    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    async with sessions() as db:
        verified_company = User(
            email="verified@example.test",
            password_hash="unused",
            role=UserRole.COMPANY,
        )
        pending_company = User(
            email="pending@example.test",
            password_hash="unused",
            role=UserRole.COMPANY,
        )
        active_student = User(
            email="active-student@example.test",
            password_hash="unused",
            role=UserRole.STUDENT,
        )
        suspended_student = User(
            email="suspended-student@example.test",
            password_hash="unused",
            role=UserRole.STUDENT,
            suspended_at=None,
        )
        suspended_student.is_active = False
        db.add_all((verified_company, pending_company, active_student, suspended_student))
        await db.flush()
        db.add_all((
            CompanyProfile(
                user_id=verified_company.id,
                company_name="Verified Co",
                industry="Technology",
                verification_status="VERIFIED",
            ),
            CompanyProfile(
                user_id=pending_company.id,
                company_name="Pending Co",
                industry="Technology",
                verification_status="PENDING",
            ),
            Internship(
                company_id=verified_company.id,
                title="Current verified posting",
                description="Description",
                location="Remote",
                industry="Technology",
                duration_months=3,
                work_mode="REMOTE",
                deadline=date.today() + timedelta(days=3),
                status="PUBLISHED",
            ),
            Internship(
                company_id=pending_company.id,
                title="Current pending-company posting",
                description="Description",
                location="Remote",
                industry="Technology",
                duration_months=3,
                work_mode="REMOTE",
                deadline=date.today() + timedelta(days=3),
                status="PUBLISHED",
            ),
            Internship(
                company_id=verified_company.id,
                title="Expired posting",
                description="Description",
                location="Remote",
                industry="Technology",
                duration_months=3,
                work_mode="REMOTE",
                deadline=date.today() - timedelta(days=1),
                status="PUBLISHED",
            ),
        ))
        await db.commit()

        admin = SimpleNamespace(role=UserRole.ADMIN)
        companies = await execute_read_tool("admin_company_counts", {}, admin, db)
        students = await execute_read_tool("admin_student_counts", {}, admin, db)
        postings = await execute_read_tool("admin_posting_counts", {}, admin, db)
        public = await execute_read_tool("public_open_internships_count", {}, None, db)
        student_public = await execute_read_tool(
            "public_open_internships_count",
            {},
            SimpleNamespace(role=UserRole.STUDENT),
            db,
        )
        registrations = await execute_read_tool("admin_recent_registrations", {}, admin, db)
        deletion_status = await execute_read_tool(
            "admin_recent_posting_deletions", {}, admin, db
        )
        dashboard_live_postings = int(await db.scalar(
            select(func.count(Internship.id)).where(
                Internship.status == "PUBLISHED",
                Internship.deadline >= date.today(),
            )
        ) or 0)

        assert "2 registered company accounts: 1 verified and 1 pending" in companies.answer
        assert "2 registered student accounts; 1 are currently active" in students.answer
        assert "3 internship postings in total" in postings.answer
        assert f"{dashboard_live_postings} published and not expired" in postings.answer
        assert f"{dashboard_live_postings} current internships" in public.answer
        assert student_public.answer == public.answer
        assert dashboard_live_postings == 2
        assert "1 verified company" in public.answer
        assert "v***@example.test" in registrations.answer
        assert "active-student@example.test" not in registrations.answer
        assert "suspended-student@example.test" not in registrations.answer
        assert "Draft internship deletions are not recorded" in deletion_status.answer
        assert "/admin/audit-logs" == deletion_status.route
        with pytest.raises(HTTPException) as error:
            await execute_read_tool(
                "admin_company_counts",
                {},
                SimpleNamespace(role=UserRole.STUDENT),
                db,
            )
        assert error.value.status_code == 403

    await engine.dispose()


@pytest.mark.parametrize(
    ("role", "page", "message", "tool"),
    [
        ("student", "applications", "What is my application status?", "student_applications"),
        ("company", "company-shortlisted", "Who applied to posting 12?", "company_applicants"),
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
    calls: list[tuple[str, dict, int]] = []

    async def execute(name, args, authenticated_user, _db):
        calls.append((name, args, authenticated_user.id))
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
        assert calls == [(tool, {}, user.id)]
    finally:
        app.dependency_overrides.pop(get_current_user_optional, None)
        app.dependency_overrides.pop(get_db, None)


STUDENT_ROUTING_CASES = [
    ("What is my application status?", "student_applications"),
    ("Show my application status.", "student_applications"),
    ("List my applications.", "student_applications"),
    ("Check my application timeline.", "student_applications"),
    ("Where are my applications?", "student_applications"),
    ("How many applications have I submitted?", "student_application_counts"),
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


@pytest.mark.parametrize(
    ("role", "question", "tool"),
    [
        ("student", "How can I view my profile completion status?", "student_profile_completeness"),
        ("student", "How can I check my application status?", "student_applications"),
        ("student", "How can I see my assessment results?", "student_skill_assessments"),
        ("student", "How can I check my interview schedule?", "student_interviews"),
        ("student", "Where can I find my interview meeting link?", "student_interviews"),
        ("student", "I applied for an internship yesterday. How can I check its progress?", "student_applications"),
        ("student", "I have Python and SQL skills. How can I find suitable internships?", "student_recommended_internships"),
        ("student", "Why is my internship application showing pending?", "student_applications"),
        ("student", "I received a notification but cannot find the related application.", "student_applications"),
        ("company", "How can I view all my active internships?", "company_internships"),
        ("company", "How can I view students who applied?", "company_applicants"),
        ("company", "How can I view upcoming interviews?", "company_interviews"),
        ("company", "How many students applied to my internships?", "company_analytics"),
        ("company", "How can I view my hiring statistics?", "company_analytics"),
        ("company", "Which internship has the most applications?", "company_most_applied_internship"),
        ("company", "How many applicants are shortlisted?", "company_shortlisted"),
        ("company", "How can I track my recruitment progress?", "company_pipeline"),
        ("admin", "How many students were successfully selected?", "admin_selected_student_counts"),
        ("admin", "Which internships receive the most applications?", "admin_most_applied_internships"),
    ],
)
def test_acceptance_live_data_routes_use_role_scoped_tools(
    role: str,
    question: str,
    tool: str,
) -> None:
    intent = classify_intent(question, role)

    assert intent.category == "live_data"
    assert intent.tool_name == tool
    assert intent.args == ()


def test_explicit_intent_tool_role_table_matches_tool_authorization() -> None:
    for intent_name, route in INTENT_TOOL_ROLE_TABLE.items():
        assert intent_name == route.tool_name
        if route.tool_name == "public_open_internships_count":
            assert route.required_roles == ("guest", "student")
        else:
            assert route.tool_name in TOOL_ROLES
            assert route.required_roles == (TOOL_ROLES[route.tool_name].value.lower(),)


def test_ambiguous_student_internship_check_asks_for_clarification() -> None:
    intent = classify_intent("How can I check internship?", "student")

    assert intent.category == "rag_help"
    assert intent.tool_name is None
    assert intent.needs_clarification
    assert "application status" in intent.needs_clarification


def test_company_resume_help_question_is_not_routed_to_company_analytics() -> None:
    intent = classify_intent(
        "A student has applied to my internship but I cannot see their resume. What should I check?",
        "company",
    )

    assert intent.category == "rag_help"
    assert intent.tool_name is None


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

        async def scalar(self, *_args, **_kwargs):
            return 0

        def add(self, *_args, **_kwargs):
            raise AssertionError("Chatbot tools must not write database records.")

        async def commit(self):
            raise AssertionError("Chatbot tools must not commit database records.")

    result = await execute_read_tool("student_applications", {}, student, ReadOnlyDb())
    assert result.answer == "You have no applications."


@pytest.mark.anyio
async def test_recommendations_without_profile_skills_still_point_to_opportunities() -> None:
    student = SimpleNamespace(id=828, role=UserRole.STUDENT)

    class NoProfileDb:
        async def scalar(self, *_args, **_kwargs):
            return None

    result = await execute_read_tool(
        "student_recommended_internships",
        {},
        student,
        NoProfileDb(),
    )

    assert "internships" in result.answer
    assert result.route == "/opportunities"


@pytest.mark.anyio
async def test_student_application_count_tool_uses_own_database_rows() -> None:
    from datetime import date

    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from app.models.base import Base

    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    async with sessions() as db:
        company = User(
            email="company@example.test",
            password_hash="unused",
            role=UserRole.COMPANY,
        )
        student = User(
            email="student@example.test",
            password_hash="unused",
            role=UserRole.STUDENT,
        )
        other_student = User(
            email="other@example.test",
            password_hash="unused",
            role=UserRole.STUDENT,
        )
        db.add_all((company, student, other_student))
        await db.flush()
        statuses = (
            "APPLIED",
            "UNDER_REVIEW",
            "SHORTLISTED",
            "INTERVIEW_SCHEDULED",
            "SELECTED",
            "ACCEPTED",
            "REJECTED",
        )
        for index, status in enumerate(statuses):
            internship = Internship(
                company_id=company.id,
                title=f"Role {index}",
                description="",
                location="Remote",
                industry="Technology",
                duration_months=3,
                work_mode="REMOTE",
                skills="",
                deadline=date.today(),
                status="PUBLISHED",
            )
            db.add(internship)
            await db.flush()
            db.add(Application(
                internship_id=internship.id,
                student_id=student.id,
                status=status,
            ))
        other_internship = Internship(
            company_id=company.id,
            title="Other role",
            description="",
            location="Remote",
            industry="Technology",
            duration_months=3,
            work_mode="REMOTE",
            skills="",
            deadline=date.today(),
            status="PUBLISHED",
        )
        db.add(other_internship)
        await db.flush()
        db.add(Application(
            internship_id=other_internship.id,
            student_id=other_student.id,
            status="APPLIED",
        ))
        await db.commit()

        result = await execute_read_tool("student_application_counts", {}, student, db)

        assert result.answer.startswith(
            "You have 7 applications (1 applied, 1 under review, 1 shortlisted, "
            "1 interview, 2 offers, 1 rejected). Latest:"
        )
        assert "+2 more." in result.answer
        assert result.route == "/applications"

    await engine.dispose()


@pytest.mark.anyio
async def test_selected_and_most_applied_tools_return_database_aggregates() -> None:
    from datetime import date, timedelta

    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from app.models.base import Base

    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    async with sessions() as db:
        company = User(
            email="owner@example.test",
            password_hash="unused",
            role=UserRole.COMPANY,
        )
        other_company = User(
            email="other-owner@example.test",
            password_hash="unused",
            role=UserRole.COMPANY,
        )
        selected_student = User(
            email="selected@example.test",
            password_hash="unused",
            role=UserRole.STUDENT,
        )
        applicant_student = User(
            email="applicant@example.test",
            password_hash="unused",
            role=UserRole.STUDENT,
        )
        other_applicants = [
            User(
                email=f"other-applicant-{index}@example.test",
                password_hash="unused",
                role=UserRole.STUDENT,
            )
            for index in range(3)
        ]
        db.add_all((company, other_company, selected_student, applicant_student, *other_applicants))
        await db.flush()
        owner_posting = Internship(
            company_id=company.id,
            title="Owner Posting",
            description="A test posting",
            location="Remote",
            industry="Technology",
            duration_months=3,
            work_mode="REMOTE",
            deadline=date.today() + timedelta(days=10),
            status="PUBLISHED",
        )
        owner_second_posting = Internship(
            company_id=company.id,
            title="Owner Second Posting",
            description="A second test posting",
            location="Remote",
            industry="Technology",
            duration_months=3,
            work_mode="REMOTE",
            deadline=date.today() + timedelta(days=10),
            status="PUBLISHED",
        )
        other_posting = Internship(
            company_id=other_company.id,
            title="Other Company Posting",
            description="A different company's posting",
            location="Remote",
            industry="Technology",
            duration_months=3,
            work_mode="REMOTE",
            deadline=date.today() + timedelta(days=10),
            status="PUBLISHED",
        )
        db.add_all((owner_posting, owner_second_posting, other_posting))
        await db.flush()
        db.add_all((
            Application(
                internship_id=owner_posting.id,
                student_id=selected_student.id,
                status="SELECTED",
            ),
            Application(
                internship_id=owner_second_posting.id,
                student_id=selected_student.id,
                status="ACCEPTED",
            ),
            Application(
                internship_id=owner_posting.id,
                student_id=applicant_student.id,
                status="APPLIED",
            ),
            *(
                Application(
                    internship_id=other_posting.id,
                    student_id=student.id,
                    status="APPLIED",
                )
                for student in other_applicants
            ),
        ))
        await db.commit()

        admin = SimpleNamespace(role=UserRole.ADMIN)
        company_user = SimpleNamespace(id=company.id, role=UserRole.COMPANY)
        selected = await execute_read_tool("admin_selected_student_counts", {}, admin, db)
        admin_most_applied = await execute_read_tool(
            "admin_most_applied_internships",
            {},
            admin,
            db,
        )
        company_most_applied = await execute_read_tool(
            "company_most_applied_internship",
            {},
            company_user,
            db,
        )
        company_analytics = await execute_read_tool(
            "company_analytics",
            {},
            company_user,
            db,
        )

        assert "1 student has been selected or accepted" in selected.answer
        assert "Other Company Posting (3 applications)" in admin_most_applied.answer
        assert "Owner Posting with 2 applications" in company_most_applied.answer
        assert "Other Company Posting" not in company_most_applied.answer
        assert "3 active applications" in company_analytics.answer
        assert company_analytics.route == "/company/analytics"

    await engine.dispose()


@pytest.mark.anyio
async def test_student_recommendations_exclude_own_applications_and_keep_best_matches(monkeypatch) -> None:
    from datetime import date, datetime, timedelta

    import app.services.ai as ai_service
    from app.models.base import Base
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    score_by_description = {
        "applied": 100,
        "other student application": 95,
        "duplicate low score": 70,
        "duplicate high score": 80,
        "zero score": 0,
        "expired": 100,
        "closed": 100,
        "unpublished": 100,
        "control": 60,
    }

    def fake_compute_match(_skills, _resume, _title, description, _internship_skills):
        return {"score": score_by_description[description], "matched": ["Python"]}

    monkeypatch.setattr(ai_service, "compute_match", fake_compute_match)

    async with sessions() as db:
        company = User(email="company@example.test", password_hash="unused", role=UserRole.COMPANY)
        student = User(email="student@example.test", password_hash="unused", role=UserRole.STUDENT)
        another_student = User(email="another@example.test", password_hash="unused", role=UserRole.STUDENT)
        student_without_applications = User(
            email="no-applications@example.test",
            password_hash="unused",
            role=UserRole.STUDENT,
        )
        student_with_no_matches = User(
            email="no-matches@example.test",
            password_hash="unused",
            role=UserRole.STUDENT,
        )
        db.add_all((company, student, another_student, student_without_applications, student_with_no_matches))
        await db.flush()
        db.add(CompanyProfile(user_id=company.id, company_name="Acme", industry="Technology"))
        for profile_user in (student, another_student, student_without_applications, student_with_no_matches):
            db.add(StudentProfile(
                user_id=profile_user.id,
                full_name="Test Student",
                university="Example University",
                major="Computer Science",
                graduation_year=2027,
                skills="Python",
            ))
        await db.flush()

        def posting(title, description, *, deadline=None, status="PUBLISHED", closed_at=None):
            return Internship(
                company_id=company.id,
                title=title,
                description=description,
                location="Remote",
                industry="Technology",
                duration_months=3,
                work_mode="REMOTE",
                skills="Python",
                deadline=deadline or date.today(),
                status=status,
                closed_at=closed_at,
            )

        status_postings = [
            posting(f"Applied {status}", "applied")
            for status in (
                "APPLIED",
                "UNDER_REVIEW",
                "SHORTLISTED",
                "INTERVIEW_SCHEDULED",
                "SELECTED",
                "REJECTED",
                "WITHDRAWN",
            )
        ]
        other_student_posting = posting("Other student application", "other student application")
        duplicate_low = posting("Duplicate role", "duplicate low score")
        duplicate_high = posting("Duplicate role", "duplicate high score")
        zero_score = posting("Zero match role", "zero score")
        expired = posting("Expired role", "expired", deadline=date.today() - timedelta(days=1))
        closed = posting("Closed role", "closed", closed_at=datetime(2026, 1, 1))
        unpublished = posting("Unpublished role", "unpublished", status="DRAFT")
        control = posting("Control role", "control")
        postings = [
            *status_postings,
            other_student_posting,
            duplicate_low,
            duplicate_high,
            zero_score,
            expired,
            closed,
            unpublished,
            control,
        ]
        db.add_all(postings)
        await db.flush()

        db.add_all([
            Application(student_id=student.id, internship_id=item.id, status=status)
            for item, status in zip(
                status_postings,
                ("APPLIED", "UNDER_REVIEW", "SHORTLISTED", "INTERVIEW_SCHEDULED", "SELECTED", "REJECTED", "WITHDRAWN"),
            )
        ])
        db.add(Application(
            student_id=another_student.id,
            internship_id=other_student_posting.id,
            status="APPLIED",
        ))
        db.add_all([
            Application(student_id=student_with_no_matches.id, internship_id=item.id, status="APPLIED")
            for item in (*status_postings, other_student_posting, duplicate_low, duplicate_high, control)
        ])
        await db.commit()

        own_results = await execute_read_tool("student_recommended_internships", {}, student, db)
        no_application_results = await execute_read_tool(
            "student_recommended_internships", {}, student_without_applications, db
        )
        no_match_results = await execute_read_tool(
            "student_recommended_internships", {}, student_with_no_matches, db
        )

    await engine.dispose()

    assert "Other student application" in own_results.answer
    assert "Duplicate role" in own_results.answer
    assert own_results.answer.count("Duplicate role") == 1
    assert ("Duplicate role", f"/opportunities/{duplicate_high.id}") in own_results.links
    assert ("Duplicate role", f"/opportunities/{duplicate_low.id}") not in own_results.links
    assert all(f"/opportunities/{item.id}" not in dict(own_results.links).values() for item in status_postings)
    assert "Zero match role" not in own_results.answer
    assert all(name not in own_results.answer for name in ("Expired role", "Closed role", "Unpublished role"))
    assert own_results.route == "/opportunities"
    assert no_application_results.links[:5] == tuple(
        (item.title, f"/opportunities/{item.id}") for item in status_postings[:5]
    )
    assert "You've applied to or seen all the internships that match your skills right now. Browse more under Opportunities." == no_match_results.answer
    assert no_match_results.route == "/opportunities"


@pytest.mark.anyio
async def test_live_account_summaries_use_seeded_role_scoped_data() -> None:
    from datetime import date, datetime, timedelta, timezone

    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from app.models import Interview, Notification, Report
    from app.models.base import Base

    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    async with sessions() as db:
        company = User(email="company-summary@example.test", password_hash="unused", role=UserRole.COMPANY)
        student = User(email="student-summary@example.test", password_hash="unused", role=UserRole.STUDENT)
        admin = User(email="admin-summary@example.test", password_hash="unused", role=UserRole.ADMIN)
        db.add_all((company, student, admin))
        await db.flush()
        db.add(CompanyProfile(
            user_id=company.id,
            company_name="Summary Co",
            industry="Technology",
            verification_status="PENDING",
        ))
        internship = Internship(
            company_id=company.id,
            title="Summary Engineering Internship",
            description="Description",
            location="Remote",
            industry="Technology",
            duration_months=3,
            work_mode="REMOTE",
            deadline=date.today() + timedelta(days=14),
            status="PUBLISHED",
        )
        db.add(internship)
        await db.flush()
        application = Application(
            internship_id=internship.id,
            student_id=student.id,
            status="SHORTLISTED",
        )
        db.add(application)
        await db.flush()
        db.add_all((
            Interview(
                application_id=application.id,
                scheduled_by=company.id,
                scheduled_at=datetime.now(timezone.utc) + timedelta(days=1),
                interview_type="VIDEO",
                status="SCHEDULED",
            ),
            Notification(
                user_id=company.id,
                notification_type="APPLICATION",
                title="New applicant",
                body="A student applied.",
            ),
            Notification(
                user_id=student.id,
                notification_type="INTERVIEW",
                title="Interview scheduled",
                body="An interview is scheduled.",
            ),
            Report(
                reporter_id=student.id,
                reported_user_id=company.id,
                internship_id=internship.id,
                reason="Test report",
                status="INVESTIGATING",
            ),
        ))
        await db.commit()

        company_summary = await execute_read_tool(
            "company_account_summary", {}, company, db
        )
        applicants = await execute_read_tool("company_applicants", {}, company, db)
        student_summary = await execute_read_tool(
            "student_account_summary", {}, student, db
        )
        shortlisted = await execute_read_tool(
            "student_application_counts", {"status": "SHORTLISTED"}, student, db
        )
        platform_summary = await execute_read_tool(
            "admin_platform_summary", {}, admin, db
        )

    await engine.dispose()
    assert "1 active posting" in company_summary.answer
    assert "1 new applicant" in company_summary.answer
    assert "1 interview scheduled" in company_summary.answer
    assert "1 unread notification" in company_summary.answer
    assert "verification status is pending" in company_summary.answer
    assert "1 applicant" in applicants.answer
    assert "Summary Engineering Internship" in applicants.answer
    assert "1 shortlisted application" in student_summary.answer
    assert "upcoming interviews:" in student_summary.answer.casefold()
    assert "1 unread notification" in student_summary.answer
    assert shortlisted.answer == "You have 1 shortlisted application."
    assert "1 pending company verification" in platform_summary.answer
    assert "1 open report/dispute" in platform_summary.answer
    assert "new users in the last 7 days" in platform_summary.answer
    assert "0 " not in " ".join(
        (company_summary.answer, applicants.answer, student_summary.answer, platform_summary.answer)
    )


@pytest.mark.anyio
async def test_company_applicant_status_counts_do_not_pluralize_adjectives(monkeypatch) -> None:
    from app.chatbot.tools import read_only

    async def metrics(*_args, **_kwargs):
        return {
            "shortlisted": 4,
            "status_counts": {
                "APPLIED": 2,
                "UNDER_REVIEW": 1,
                "SHORTLISTED": 4,
                "INTERVIEW_SCHEDULED": 2,
                "SELECTED": 1,
                "REJECTED": 3,
            },
            "total_applicants": 13,
            "applications_by_role": [],
        }

    monkeypatch.setattr(read_only, "get_company_metrics", metrics)
    result = await read_only._company_applicants(
        object(), SimpleNamespace(id=42, role=UserRole.COMPANY), None
    )

    assert result.answer == (
        "You have 13 applicants. Statuses: 2 applied, 1 under review, "
        "4 shortlisted, 2 interviews, 1 offer, 3 rejected."
    )
    assert not any(word in result.answer for word in ("applieds", "shortlisteds", "rejecteds"))


@pytest.mark.anyio
async def test_admin_audit_and_platform_summaries_use_distinct_live_tools(monkeypatch) -> None:
    from datetime import datetime, timedelta, timezone

    import app.chatbot.router as chatbot_router
    from app.api.v1.dependencies import get_current_user_optional
    from app.chatbot.chatbot_config import ChatbotConfig
    from app.core.database import get_db
    from app.main import app
    from app.models import AuditLog, CompanyProfile
    from app.models.base import Base
    from app.services.chatbot_service import ChatbotService
    from httpx import ASGITransport, AsyncClient
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    now = datetime.now(timezone.utc)
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    async with sessions() as db:
        admin = User(
            email="audit-admin@example.test",
            password_hash="unused",
            role=UserRole.ADMIN,
            created_at=now - timedelta(days=30),
        )
        db.add(admin)
        await db.flush()
        company = User(
            email="pending-company@example.test",
            password_hash="unused",
            role=UserRole.COMPANY,
            created_at=now - timedelta(days=30),
        )
        db.add(company)
        await db.flush()
        db.add(CompanyProfile(
            user_id=company.id,
            company_name="Pending Company",
            industry="Technology",
            verification_status="PENDING",
        ))
        actions = (
            ["posting_approved"] * 3
            + ["company_verified"]
            + ["admin_downloaded_company_document"] * 2
            + ["skill_topic_restored"] * 6
        )
        db.add_all(
            AuditLog(
                actor_id=admin.id,
                action=action,
                target_type="record",
                target_id=index,
                created_at=now - timedelta(days=1),
            )
            for index, action in enumerate(actions, start=1)
        )
        await db.commit()

        calls = []
        original_execute = chatbot_router.execute_read_tool

        async def track_tool(name, args, user, session):
            calls.append(name)
            return await original_execute(name, args, user, session)

        monkeypatch.setattr(chatbot_router, "_service", ChatbotService(
            config=ChatbotConfig(enabled=True, mode="retrieval")
        ))
        monkeypatch.setattr(chatbot_router, "execute_read_tool", track_tool)
        app.dependency_overrides[get_current_user_optional] = lambda: admin
        app.dependency_overrides[get_db] = lambda: db
        try:
            async with AsyncClient(
                transport=ASGITransport(app=app),
                base_url="http://test",
            ) as client:
                audit_response = await client.post(
                    "/api/v1/chatbot/ask",
                    json={"message": "Explain recent audit events.", "page": "admin-audit-logs"},
                )
                platform_response = await client.post(
                    "/api/v1/chatbot/ask",
                    json={"message": "What is happening on the platform?", "page": "admin"},
                )
        finally:
            app.dependency_overrides.pop(get_current_user_optional, None)
            app.dependency_overrides.pop(get_db, None)

    await engine.dispose()
    assert audit_response.status_code == platform_response.status_code == 200
    audit_answer = audit_response.json()["answer"]
    assert audit_answer == (
        "Last 7 days: 3 postings approved, 1 company verified, "
        "2 company documents downloaded, 6 skill topics restored."
    )
    assert any(
        link["route"] == "/admin/audit-logs"
        for link in audit_response.json()["links"]
    )
    assert "audit-admin@example.test" not in audit_answer
    assert "Admin admin" not in audit_answer
    assert platform_response.json()["answer"] == (
        "Platform summary: 1 pending company verification."
    )
    assert audit_answer != platform_response.json()["answer"]
    assert calls == ["admin_audit_events", "admin_platform_summary"]


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("role", "questions"),
    [
        ("student", (
            ("How do I apply for an internship?", "Apply"),
            ("How do I enable 2FA?", "Enable Email 2FA"),
            ("How do I contact a company?", "suggested hiring company"),
            ("What if a company treats me unfairly?", "Report or Dispute"),
            ("How do I withdraw an application?", "withdraw"),
        )),
        ("company", (
            ("How do I create an internship posting?", "My Internships"),
            ("How do I update an internship posting?", "choose Edit"),
            ("How do I view applicants?", "Hiring Pipeline"),
            ("How do I reject an applicant?", "Reject"),
            ("How do I verify my company?", "business registration document"),
        )),
        ("admin", (
            ("How do I review pending postings?", "Jobs Queue"),
            ("How do I archive a skill topic?", "Archive"),
            ("How do I restore an archived topic?", "Archived topics"),
            ("How do I delete a student account?", "Delete permanently"),
            ("How do I manage platform users?", "account-management actions"),
        )),
    ],
)
async def test_role_multi_turn_endpoint_answers_do_not_repeat(
    role, questions, monkeypatch
) -> None:
    import app.chatbot.router as chatbot_router
    from app.api.v1.dependencies import get_current_user_optional
    from app.chatbot.chatbot_config import ChatbotConfig
    from app.core.database import get_db
    from app.main import app
    from app.services.chatbot_service import ChatbotService
    from httpx import ASGITransport, AsyncClient

    user = User(
        id={"student": 9401, "company": 9402, "admin": 9403}[role],
        email=f"{role}-multi-turn@example.test",
        password_hash="unused",
        role=UserRole(role.upper()),
    )
    monkeypatch.setattr(
        chatbot_router,
        "_service",
        ChatbotService(config=ChatbotConfig(enabled=True, mode="retrieval")),
    )
    app.dependency_overrides[get_current_user_optional] = lambda: user
    app.dependency_overrides[get_db] = lambda: object()
    history = []
    answers = []
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://test",
        ) as client:
            for question, expected in questions:
                response = await client.post(
                    "/api/v1/chatbot/ask",
                    json={"message": question, "history": history, "page": "home"},
                )
                assert response.status_code == 200, response.text
                answer = response.json()["answer"]
                assert expected.casefold() in answer.casefold(), (role, question, answer)
                assert answer != "I don't have this in the help guide yet"
                assert answer not in answers, (role, question, answer)
                answers.append(answer)
                history.extend((
                    {"role": "user", "content": question},
                    {"role": "assistant", "content": answer},
                ))
    finally:
        app.dependency_overrides.pop(get_current_user_optional, None)
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.anyio
async def test_student_endpoint_followup_and_interviews_selects_interview_tool(monkeypatch) -> None:
    import app.chatbot.router as chatbot_router
    from app.api.v1.dependencies import get_current_user_optional
    from app.chatbot.chatbot_config import ChatbotConfig
    from app.core.database import get_db
    from app.main import app
    from app.services.chatbot_service import ChatbotService
    from httpx import ASGITransport, AsyncClient

    student = User(
        id=9404,
        email="student-follow-up@example.test",
        password_hash="unused",
        role=UserRole.STUDENT,
    )
    calls = []

    async def execute(name, _args, user, _db):
        calls.append(name)
        return ToolResult(name, f"Live result for {name}.", {
            "student_application_counts": "/applications",
            "student_interviews": "/interviews",
        }[name])

    monkeypatch.setattr(
        chatbot_router,
        "_service",
        ChatbotService(config=ChatbotConfig(enabled=True, mode="retrieval")),
    )
    monkeypatch.setattr(chatbot_router, "execute_read_tool", execute)
    app.dependency_overrides[get_current_user_optional] = lambda: student
    app.dependency_overrides[get_db] = lambda: object()
    history = []
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://test",
        ) as client:
            first = await client.post(
                "/api/v1/chatbot/ask",
                json={"message": "How many applications do I have?", "history": history},
            )
            history.extend((
                {"role": "user", "content": "How many applications do I have?"},
                {"role": "assistant", "content": first.json()["answer"]},
            ))
            followup = await client.post(
                "/api/v1/chatbot/ask",
                json={"message": "and interviews?", "history": history},
            )
    finally:
        app.dependency_overrides.pop(get_current_user_optional, None)
        app.dependency_overrides.pop(get_db, None)

    assert first.status_code == followup.status_code == 200
    assert followup.json()["answer"] == "Live result for student_interviews."
    assert calls == ["student_application_counts", "student_interviews"]


@pytest.mark.anyio
async def test_student_skill_gap_lists_owned_skills_badges_and_weak_topics() -> None:
    from datetime import datetime, timedelta, timezone

    student = SimpleNamespace(id=818, role=UserRole.STUDENT)
    now = datetime.now(timezone.utc)

    class Rows:
        def __init__(self, rows):
            self.rows = rows

        def all(self):
            return self.rows

    class ScalarRows:
        def all(self):
            return [SimpleNamespace(title="Verified React Pro")]

    class SkillDb:
        def __init__(self):
            self.execution = 0

        async def scalar(self, *_args):
            return SimpleNamespace(skills="Python, React")

        async def execute(self, *_args):
            self.execution += 1
            if self.execution == 1:
                return Rows([
                    ("python", "Python & Backend Architecture"),
                    ("react", "React & Modern Frontend"),
                    ("sql", "SQL & Database Design"),
                    ("dsa", "Data Structures & Algorithms"),
                ])
            if self.execution == 2:
                return Rows([
                    (topic, level, needed)
                    for topic in ("python", "react", "sql", "dsa")
                    for level, needed in (("EASY", 4), ("MEDIUM", 4), ("HARD", 2))
                ])
            return Rows([
                ("python", "COMPLETED", 55, False),
                ("react", "COMPLETED", 95, True),
                ("sql", "EXPIRED", None, None),
            ])

        async def scalars(self, *_args):
            return ScalarRows()

    result = await execute_read_tool("student_skill_gap", {}, student, SkillDb())

    assert "Python, React" in result.answer
    assert "Verified React Pro" in result.answer
    assert "Next to improve: Python & Backend Architecture, SQL & Database Design, Data Structures & Algorithms" in result.answer
    assert result.route == "/skills/history"


@pytest.mark.anyio
async def test_student_skill_retake_uses_assessment_policy_and_topic_history() -> None:
    from datetime import datetime, timedelta, timezone

    student = SimpleNamespace(id=819, role=UserRole.STUDENT)
    attempt = SimpleNamespace(
        topic="python",
        started_at=datetime.now(timezone.utc) - timedelta(hours=12),
    )

    class Rows:
        def all(self):
            return [("python", "Python & Backend Architecture", None), ("react", "React & Modern Frontend", None)]

    class ScalarRows:
        def all(self):
            return [attempt]

    class RetakeDb:
        async def scalars(self, *_args):
            return ScalarRows()

        async def execute(self, *_args):
            return Rows()

    result = await execute_read_tool("student_skill_retake", {}, student, RetakeDb())

    assert "24 hours" in result.answer
    assert "3 attempts in any 7 days" in result.answer
    assert "Blocked: Python & Backend Architecture (12h left)" in result.answer
    assert "React & Modern Frontend" not in result.answer
    assert result.route == "/skills/history"


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
