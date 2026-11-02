from datetime import date, datetime, timedelta, timezone

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.v1.dependencies import get_db
from app.core.security import create_token
from app.main import app
from app.models import Application, CompanyProfile, Internship, Interview, StudentProfile, User, UserRole
from app.models.base import Base


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
async def test_company_metrics_match_direct_counts_and_lists(monkeypatch: pytest.MonkeyPatch):
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    async def override_db():
        async with sessions() as session:
            yield session

    monkeypatch.setitem(app.dependency_overrides, get_db, override_db)
    now = datetime.now(timezone.utc)
    async with sessions() as session:
        company = User(email="company-metrics@example.com", password_hash="unused", role=UserRole.COMPANY)
        students = [
            User(email=f"company-metrics-student-{index}@example.com", password_hash="unused", role=UserRole.STUDENT)
            for index in range(8)
        ]
        session.add_all([company, *students])
        await session.flush()
        session.add(CompanyProfile(user_id=company.id, company_name="Metrics Co", industry="Technology"))
        active_role = Internship(
            company_id=company.id,
            title="Active role",
            description="A published role with an active deadline.",
            location="Remote",
            industry="Technology",
            duration_months=3,
            work_mode="REMOTE",
            skills="Python",
            deadline=date.today() + timedelta(days=1),
            status="PUBLISHED",
        )
        expired_role = Internship(
            company_id=company.id,
            title="Expired published role",
            description="A published role whose deadline passed.",
            location="Remote",
            industry="Technology",
            duration_months=3,
            work_mode="REMOTE",
            skills="Python",
            deadline=date.today() - timedelta(days=1),
            status="PUBLISHED",
        )
        draft_role = Internship(
            company_id=company.id,
            title="Draft role",
            description="A draft role.",
            location="Remote",
            industry="Technology",
            duration_months=3,
            work_mode="REMOTE",
            skills="Python",
            deadline=date.today() + timedelta(days=10),
            status="DRAFT",
        )
        closed_role = Internship(
            company_id=company.id,
            title="Closed role",
            description="A closed role.",
            location="Remote",
            industry="Technology",
            duration_months=3,
            work_mode="REMOTE",
            skills="Python",
            deadline=date.today() + timedelta(days=10),
            status="CLOSED",
        )
        pending_role = Internship(
            company_id=company.id,
            title="Pending approval role",
            description="A role awaiting approval.",
            location="Remote",
            industry="Technology",
            duration_months=3,
            work_mode="REMOTE",
            skills="Python",
            deadline=date.today() + timedelta(days=10),
            status="PENDING_APPROVAL",
        )
        rejected_role = Internship(
            company_id=company.id,
            title="Rejected role",
            description="A rejected role.",
            location="Remote",
            industry="Technology",
            duration_months=3,
            work_mode="REMOTE",
            skills="Python",
            deadline=date.today() + timedelta(days=10),
            status="REJECTED",
        )
        session.add_all([active_role, expired_role, draft_role, closed_role, pending_role, rejected_role])
        await session.flush()
        applications = [
            Application(internship_id=active_role.id, student_id=students[0].id, status="APPLIED", created_at=now - timedelta(days=40)),
            Application(internship_id=active_role.id, student_id=students[1].id, status="UNDER_REVIEW", created_at=now - timedelta(days=20)),
            Application(internship_id=active_role.id, student_id=students[2].id, status="SHORTLISTED", created_at=now - timedelta(days=52)),
            Application(internship_id=active_role.id, student_id=students[3].id, status="INTERVIEW_SCHEDULED", created_at=now - timedelta(days=54)),
            Application(internship_id=active_role.id, student_id=students[4].id, status="SELECTED", created_at=now - timedelta(days=2)),
            Application(internship_id=active_role.id, student_id=students[5].id, status="ACCEPTED", created_at=now - timedelta(days=1)),
            Application(internship_id=closed_role.id, student_id=students[6].id, status="REJECTED", created_at=now - timedelta(days=35)),
            Application(internship_id=expired_role.id, student_id=students[7].id, status="WITHDRAWN", created_at=now - timedelta(days=34)),
        ]
        session.add_all(applications)
        await session.flush()
        session.add_all([
            Interview(
                application_id=applications[0].id,
                scheduled_by=company.id,
                scheduled_at=now + timedelta(days=1),
                interview_type="TECHNICAL",
                status="SCHEDULED",
            ),
            Interview(
                application_id=applications[1].id,
                scheduled_by=company.id,
                scheduled_at=now + timedelta(days=2),
                interview_type="TECHNICAL",
                status="RESCHEDULED",
            ),
            Interview(
                application_id=applications[4].id,
                scheduled_by=company.id,
                scheduled_at=now - timedelta(days=1),
                interview_type="TECHNICAL",
                status="SCHEDULED",
            ),
            Interview(
                application_id=applications[5].id,
                scheduled_by=company.id,
                scheduled_at=now + timedelta(days=3),
                interview_type="TECHNICAL",
                status="COMPLETED",
            ),
            Interview(
                application_id=applications[6].id,
                scheduled_by=company.id,
                scheduled_at=now + timedelta(days=4),
                interview_type="TECHNICAL",
                status="CANCELLED",
            ),
        ])
        session.add_all([
            StudentProfile(
                user_id=student.id,
                full_name=f"Metrics Student {index}",
                university="North University",
                major="Computer Science",
                graduation_year=2027,
                skills="Python",
            )
            for index, student in enumerate(students)
        ])
        await session.commit()
        company_id = company.id
        active_role_id = active_role.id

        direct_roles = int(await session.scalar(
            select(func.count(Internship.id)).where(Internship.company_id == company_id)
        ) or 0)
        direct_active_roles = int(await session.scalar(
            select(func.count(Internship.id)).where(
                Internship.company_id == company_id,
                Internship.status == "PUBLISHED",
                Internship.deadline >= date.today(),
            )
        ) or 0)
        direct_total_applicants = int(await session.scalar(
            select(func.count(Application.id))
            .join(Internship, Internship.id == Application.internship_id)
            .where(Internship.company_id == company_id, Application.status != "WITHDRAWN")
        ) or 0)
        direct_withdrawn = int(await session.scalar(
            select(func.count(Application.id))
            .join(Internship, Internship.id == Application.internship_id)
            .where(Internship.company_id == company_id, Application.status == "WITHDRAWN")
        ) or 0)
        direct_shortlisted = int(await session.scalar(
            select(func.count(Application.id))
            .join(Internship, Internship.id == Application.internship_id)
            .where(Internship.company_id == company_id, Application.status == "SHORTLISTED")
        ) or 0)
        direct_offers = int(await session.scalar(
            select(func.count(Application.id))
            .join(Internship, Internship.id == Application.internship_id)
            .where(Internship.company_id == company_id, Application.status.in_(("SELECTED", "ACCEPTED")))
        ) or 0)
        direct_interviews = int(await session.scalar(
            select(func.count(Interview.id))
            .join(Application, Interview.application_id == Application.id)
            .join(Internship, Internship.id == Application.internship_id)
            .where(
                Internship.company_id == company_id,
                Interview.status.in_(("SCHEDULED", "RESCHEDULED")),
                Interview.scheduled_at > now,
            )
        ) or 0)
        orphan_rows = list((await session.execute(
            select(Application.id, Application.status, Application.internship_id, Application.created_at)
            .join(Internship, Internship.id == Application.internship_id)
            .where(
                Internship.company_id == company_id,
                Application.status == "INTERVIEW_SCHEDULED",
                ~select(Interview.id).where(Interview.application_id == Application.id).exists(),
            )
        )).all())
        orphan_ids = [row.id for row in orphan_rows]

    token = create_token(str(company_id), UserRole.COMPANY.value, "access", timedelta(minutes=30))
    headers = {"Authorization": f"Bearer {token}"}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        company_overview_response = await client.get("/api/v1/company/overview", headers=headers)
        analytics_overview_response = await client.get("/api/v1/analytics/overview", headers=headers)
        insights_response = await client.get("/api/v1/companies/me/insights?range=7", headers=headers)
        metrics_response = await client.get("/api/v1/companies/me/metrics", headers=headers)
        role_metrics_response = await client.get(
            f"/api/v1/companies/me/metrics?internship_id={active_role_id}",
            headers=headers,
        )
        applicants_response = await client.get("/api/v1/applications/company/search", headers=headers)
        shortlisted_response = await client.get(
            "/api/v1/applications/company/search?status=SHORTLISTED",
            headers=headers,
        )

    assert company_overview_response.status_code == 200
    assert analytics_overview_response.status_code == 200
    assert insights_response.status_code == 200
    assert metrics_response.status_code == 200
    assert role_metrics_response.status_code == 200
    assert applicants_response.status_code == 200
    assert shortlisted_response.status_code == 200

    company_overview = company_overview_response.json()
    analytics_overview = analytics_overview_response.json()
    insights = insights_response.json()
    metrics = metrics_response.json()
    role_metrics = role_metrics_response.json()
    applicants = applicants_response.json()
    shortlisted = shortlisted_response.json()
    expected = {
        "total roles": direct_roles,
        "active roles": direct_active_roles,
        "total applicants": direct_total_applicants,
        "withdrawn": direct_withdrawn,
        "shortlisted": direct_shortlisted,
        "offers": direct_offers,
        "future interviews": direct_interviews,
    }
    observed = {
        "total roles": {
            "database": direct_roles,
            "company overview": company_overview["kpis"]["total_internships"],
            "analytics overview": analytics_overview["company_summary"]["total_roles"],
            "insights": insights["kpis"]["total_roles"]["value"],
            "shared metrics": metrics["kpis"]["total_roles"]["value"],
        },
        "active roles": {
            "database": direct_active_roles,
            "company overview": company_overview["kpis"]["active_internships"],
            "analytics overview": analytics_overview["company_summary"]["active"],
            "insights": insights["kpis"]["active_roles"]["value"],
            "shared metrics": metrics["kpis"]["active_roles"]["value"],
        },
        "total applicants": {
            "database": direct_total_applicants,
            "company overview": company_overview["kpis"]["total_applicants"],
            "analytics overview": analytics_overview["company_summary"]["total_applications"],
            "insights": insights["kpis"]["total_applicants"]["value"],
            "shared metrics": metrics["kpis"]["total_applicants"]["value"],
            "applicant list": applicants["total"],
        },
        "withdrawn": {
            "database": direct_withdrawn,
            "analytics overview": analytics_overview["company_summary"]["withdrawn_applications"],
            "insights": insights["withdrawn_count"],
            "shared metrics": metrics["withdrawn_count"],
        },
        "shortlisted": {
            "database": direct_shortlisted,
            "company overview": company_overview["kpis"]["shortlisted"],
            "analytics overview": analytics_overview["company_summary"]["shortlisted"],
            "insights": insights["kpis"]["shortlisted"]["value"],
            "shared metrics": metrics["kpis"]["shortlisted"]["value"],
            "shortlist list": shortlisted["total"],
            "shortlist rows": len(shortlisted["items"]),
        },
        "offers": {
            "database": direct_offers,
            "analytics overview": analytics_overview["company_summary"]["offers"],
            "insights": insights["kpis"]["offers"]["value"],
            "shared metrics": metrics["kpis"]["offers"]["value"],
        },
        "future interviews": {
            "database": direct_interviews,
            "company overview": company_overview["kpis"]["interviews_scheduled"],
            "analytics overview": analytics_overview["company_summary"]["interviews_scheduled"],
            "insights": insights["kpis"]["interviews_scheduled"]["value"],
            "shared metrics": metrics["kpis"]["interviews_scheduled"]["value"],
        },
    }
    print("\nCompany metric audit (endpoint values and difference from direct database counts):")
    for metric, values in observed.items():
        details = " | ".join(
            f"{endpoint}: {value} (diff {value - values['database']:+})"
            for endpoint, value in values.items()
            if endpoint != "database"
        )
        print(f"{metric:<22} DB: {values['database']} | {details}")
    print(f"Shortlisted list rows: {len(shortlisted['items'])}; expected {direct_shortlisted}")
    print(
        "INTERVIEW_SCHEDULED applications without an interview row: "
        + str([
            {
                "application_id": row.id,
                "status": row.status,
                "internship_id": row.internship_id,
                "created_at": row.created_at.isoformat(),
            }
            for row in orphan_rows
        ])
    )

    for metric, values in observed.items():
        assert all(value == expected[metric] for value in values.values()), metric
    assert shortlisted["total"] == len(shortlisted["items"]) == direct_shortlisted
    assert applicants["total"] == direct_total_applicants
    assert insights["sample_size"] == direct_total_applicants
    assert role_metrics["kpis"]["total_roles"]["value"] == 1
    assert role_metrics["kpis"]["active_roles"]["value"] == 1
    assert role_metrics["kpis"]["total_applicants"]["value"] == 6
    assert role_metrics["kpis"]["shortlisted"]["value"] == 1
    assert sum(row["count"] for row in insights["status_breakdown"]) == direct_total_applicants
    assert sum(row["count"] for row in insights["charts"]["company_pipeline"]) == direct_total_applicants
    for role in insights["charts"]["conversion_by_role"]:
        assert role["count"] == sum(
            role[key]
            for key in (
                "applied",
                "under_review",
                "shortlisted",
                "interview_scheduled",
                "selected",
                "accepted",
                "rejected",
            )
        )
    assert analytics_overview["funnel"]["applied"] == direct_total_applicants
    assert analytics_overview["funnel"]["shortlisted"] == direct_shortlisted
    assert insights["kpis"]["total_applicants"]["definition"].endswith("1 withdrawn application(s) excluded.")
    assert orphan_ids == [applications[3].id]
    assert direct_total_applicants == 7
    assert applications[0].created_at < now - timedelta(days=30)
    await engine.dispose()
