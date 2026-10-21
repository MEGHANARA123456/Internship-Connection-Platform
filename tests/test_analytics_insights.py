from datetime import datetime, timedelta, timezone

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.v1.dependencies import get_db
from app.core.security import create_token
from app.main import app
from app.models import (
    Application,
    ApplicationEvent,
    CompanyProfile,
    Internship,
    Interview,
    SavedInternship,
    StudentProfile,
    User,
    UserRole,
)
from app.models.base import Base


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
async def test_role_scoped_analytics_aggregates_and_empty_results(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
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
        company_a = User(email="analytics-a@example.com", password_hash="unused", role=UserRole.COMPANY)
        company_b = User(email="analytics-b@example.com", password_hash="unused", role=UserRole.COMPANY)
        company_empty = User(email="analytics-empty-company@example.com", password_hash="unused", role=UserRole.COMPANY)
        company_c = User(email="analytics-c@example.com", password_hash="unused", role=UserRole.COMPANY)
        student_a = User(email="analytics-student-a@example.com", password_hash="unused", role=UserRole.STUDENT)
        student_b = User(email="analytics-student-b@example.com", password_hash="unused", role=UserRole.STUDENT)
        admin = User(email="analytics-admin@example.com", password_hash="unused", role=UserRole.ADMIN)
        session.add_all([company_a, company_b, company_empty, company_c, student_a, student_b, admin])
        await session.flush()
        session.add_all([
            CompanyProfile(user_id=company_a.id, company_name="A Company", industry="Tech"),
            CompanyProfile(user_id=company_b.id, company_name="B Company", industry="Tech"),
            CompanyProfile(user_id=company_empty.id, company_name="Empty Company", industry="Tech"),
            CompanyProfile(user_id=company_c.id, company_name="C Company", industry="Tech"),
            StudentProfile(user_id=student_a.id, full_name="Student A", university="North University", major="CS", graduation_year=2027, skills="Python"),
            StudentProfile(user_id=student_b.id, full_name="Student B", university="South University", major="CS", graduation_year=2027, skills="Java"),
        ])
        role_a = Internship(
            company_id=company_a.id,
            title="Python Intern",
            description="Build software",
            location="Remote",
            industry="Tech",
            duration_months=3,
            work_mode="REMOTE",
            skills="Python, SQL",
            deadline=(now + timedelta(days=30)).date(),
            status="PUBLISHED",
            created_at=now - timedelta(days=20),
        )
        role_b = Internship(
            company_id=company_b.id,
            title="Secret Role",
            description="Private company role",
            location="Remote",
            industry="Tech",
            duration_months=3,
            work_mode="REMOTE",
            skills="Rust",
            deadline=(now + timedelta(days=30)).date(),
            status="PUBLISHED",
            created_at=now - timedelta(days=20),
        )
        role_a2 = Internship(
            company_id=company_a.id,
            title="Data Intern",
            description="Analyze data",
            location="Remote",
            industry="Tech",
            duration_months=3,
            work_mode="REMOTE",
            skills="Python, SQL",
            deadline=(now + timedelta(days=30)).date(),
            status="PUBLISHED",
            created_at=now - timedelta(days=20),
        )
        session.add_all([role_a, role_a2, role_b])
        await session.flush()
        accepted_application = Application(
            internship_id=role_a.id,
            student_id=student_a.id,
            status="ACCEPTED",
            created_at=now - timedelta(days=10),
        )
        applied_application = Application(
            internship_id=role_a2.id,
            student_id=student_a.id,
            status="APPLIED",
            created_at=now - timedelta(days=5),
        )
        other_student_application = Application(
            internship_id=role_a.id,
            student_id=student_b.id,
            status="SHORTLISTED",
            created_at=now - timedelta(days=4),
        )
        company_b_application = Application(
            internship_id=role_b.id,
            student_id=student_b.id,
            status="SELECTED",
            created_at=now - timedelta(days=3),
        )
        session.add_all([
            accepted_application,
            applied_application,
            other_student_application,
            company_b_application,
        ])
        await session.flush()
        extra_roles = [
            Internship(
                company_id=company_c.id,
                title=f"Analytics Role {index}",
                description="Build software",
                location="Remote",
                industry="Engineering",
                duration_months=3,
                work_mode="REMOTE",
                skills="Python, SQL",
                deadline=(now + timedelta(days=30)).date(),
                status="PUBLISHED",
                created_at=now - timedelta(days=2),
            )
            for index in range(7)
        ]
        session.add_all(extra_roles)
        await session.flush()
        extra_applications = [
            Application(
                internship_id=role.id,
                student_id=student_a.id,
                status="SHORTLISTED" if index < 2 else "APPLIED",
                created_at=now - timedelta(days=1),
            )
            for index, role in enumerate(extra_roles)
        ]
        session.add_all(extra_applications)
        await session.flush()
        session.add_all([
            SavedInternship(student_id=student_a.id, internship_id=extra_roles[0].id),
            Interview(
                application_id=accepted_application.id,
                scheduled_by=company_a.id,
                scheduled_at=now + timedelta(days=2),
                interview_type="TECHNICAL",
                status="SCHEDULED",
            ),
        ])
        session.add_all([
            ApplicationEvent(
                application_id=accepted_application.id,
                event_type="APPLIED",
                actor_id=student_a.id,
                created_at=accepted_application.created_at,
            ),
            ApplicationEvent(
                application_id=accepted_application.id,
                event_type="UNDER_REVIEW",
                actor_id=company_a.id,
                created_at=accepted_application.created_at + timedelta(hours=2),
            ),
            ApplicationEvent(
                application_id=accepted_application.id,
                event_type="SELECTED",
                actor_id=company_a.id,
                created_at=accepted_application.created_at + timedelta(days=2),
            ),
            ApplicationEvent(
                application_id=applied_application.id,
                event_type="APPLIED",
                actor_id=student_a.id,
                created_at=applied_application.created_at,
            ),
        ])
        await session.commit()
        company_a_token = create_token(str(company_a.id), UserRole.COMPANY.value, "access", timedelta(minutes=30))
        company_b_token = create_token(str(company_b.id), UserRole.COMPANY.value, "access", timedelta(minutes=30))
        empty_company_token = create_token(str(company_empty.id), UserRole.COMPANY.value, "access", timedelta(minutes=30))
        student_a_token = create_token(str(student_a.id), UserRole.STUDENT.value, "access", timedelta(minutes=30))
        student_b_token = create_token(str(student_b.id), UserRole.STUDENT.value, "access", timedelta(minutes=30))
        admin_token = create_token(str(admin.id), UserRole.ADMIN.value, "access", timedelta(minutes=30))

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        company_headers = {"Authorization": f"Bearer {company_a_token}"}
        performance = await client.get("/api/v1/analytics/company/performance?range=all", headers=company_headers)
        assert performance.status_code == 200
        payload = performance.json()
        assert payload["total_applications"] == 3
        assert payload["by_role"] == [
            {
                "internship_id": role_a.id,
                "title": "Python Intern",
                "applications": 2,
                "shortlisted": 1,
                "offers": 1,
                "accepted": 1,
            },
            {
                "internship_id": role_a2.id,
                "title": "Data Intern",
                "applications": 1,
                "shortlisted": 0,
                "offers": 0,
                "accepted": 0,
            },
        ]
        assert payload["time_metrics"]["avg_hours_to_first_response"] == 2
        assert payload["time_metrics"]["sample_size"] == 1
        assert payload["time_metrics"]["avg_days_to_offer"] == 2
        assert payload["offer_acceptance_rate"] == 100
        assert {item["status"]: item["count"] for item in payload["status_distribution"]} == {
            "ACCEPTED": 1,
            "APPLIED": 1,
            "SHORTLISTED": 1,
        }
        assert payload["top_universities"][0] == {"university": "North University", "applicants": 2}
        assert payload["match_distribution_sample_size"] == 3
        assert sum(item["count"] for item in payload["match_distribution"]) == 3
        assert "most recent 300 applications" in payload["match_distribution_note"]
        assert payload["interview_outcomes"] == {"scheduled": 1, "completed": 0, "cancelled": 0}
        assert payload["top_skills"] == [
            {"skill": "Python", "applicants": 2, "required_by_roles": 2},
            {"skill": "SQL", "applicants": 0, "required_by_roles": 2},
        ]
        assert "Secret Role" not in str(payload)
        assert "Rust" not in str(payload)

        company_insights = await client.get(
            "/api/v1/companies/me/insights?range=all",
            headers=company_headers,
        )
        assert company_insights.status_code == 200
        assert company_insights.headers["cache-control"] == "no-store"
        company_payload = company_insights.json()
        assert company_payload["kpis"]["total_applicants"]["value"] == 3
        assert company_payload["kpis"]["shortlisted"]["value"] == 1
        assert company_payload["kpis"]["offers"]["value"] == 1
        assert sum(item["count"] for item in company_payload["charts"]["applicants_by_posting"]) == 3
        conversion_by_role = {
            item["name"]: item["interview_scheduled"]
            for item in company_payload["charts"]["conversion_by_role"]
        }
        assert conversion_by_role["Python Intern"] == 1
        assert conversion_by_role["Data Intern"] == 0
        assert "Secret Role" not in str(company_payload)

        student_response = await client.get(
            "/api/v1/analytics/student/insights?range=all",
            headers={"Authorization": f"Bearer {student_a_token}"},
        )
        assert student_response.status_code == 200
        student_payload = student_response.json()
        assert student_payload["total_applications"] == 9
        assert student_payload["response_rate"] == 11.1
        assert student_payload["responded_applications"] == 1
        assert student_payload["avg_response_hours"] == 2
        assert student_payload["response_time_sample_size"] == 1
        assert {item["status"]: item["count"] for item in student_payload["status_distribution"]} == {
            "ACCEPTED": 1,
            "APPLIED": 6,
            "SHORTLISTED": 2,
        }
        assert sum(item["applications"] for item in student_payload["weekly_applications"]) == 9
        assert student_payload["skills_gap"] == [{"skill": "SQL", "missing_count": 9}]

        insights_response = await client.get(
            "/api/v1/students/me/insights?range=all",
            headers={"Authorization": f"Bearer {student_a_token}"},
        )
        assert insights_response.status_code == 200
        assert insights_response.headers["cache-control"] == "no-store"
        insights_payload = insights_response.json()
        assert insights_payload["kpis"]["applications_submitted"]["value"] == 9
        assert insights_payload["kpis"]["under_review"]["value"] == 0
        assert insights_payload["kpis"]["shortlisted"]["value"] == 2
        assert insights_payload["kpis"]["offers"]["value"] == 1
        assert insights_payload["kpis"]["interviews_scheduled"]["value"] == 1
        assert insights_payload["kpis"]["saved_roles"]["value"] == 1
        assert insights_payload["kpis"]["response_rate"]["value"] == 11.1
        assert insights_payload["kpis"]["response_rate"]["numerator"] == 1
        assert insights_payload["kpis"]["response_rate"]["denominator"] == 9
        assert insights_payload["kpis"]["average_match_score"]["sample_size"] == 9
        assert sum(item["count"] for item in insights_payload["match_score_distribution"]) == 9
        assert insights_payload["funnel"][0]["count"] == 9
        assert insights_payload["funnel"][0]["conversion_pct"] == 100
        assert all(item["dropoff_pct"] is None or item["dropoff_pct"] >= 0 for item in insights_payload["funnel"])
        assert insights_payload["sample_size"] == 9
        student_charts = insights_payload["charts"]
        assert {
            "status_over_time",
            "response_times",
            "skill_gap",
            "activity_calendar",
            "top_companies",
            "stipend_distribution",
            "duration_distribution",
            "upcoming_deadlines",
        }.issubset(student_charts)
        assert len(student_charts["status_over_time"]) <= 8
        assert len(student_charts["response_times"]) == 1
        assert student_charts["response_times"][0]["days"] > 0
        assert insights_payload["chart_samples"]["response_times"] == 1
        assert insights_payload["chart_samples"]["skill_gap"] == 9
        assert insights_payload["chart_samples"]["stipend_distribution"] == 0
        assert student_charts["stipend_distribution"] == []
        student_b_insights = await client.get(
            "/api/v1/students/me/insights?range=all",
            headers={"Authorization": f"Bearer {student_b_token}"},
        )
        assert student_b_insights.status_code == 200
        assert student_b_insights.json()["kpis"]["applications_submitted"]["value"] == 2

        forbidden_dashboard = await client.get(
            "/api/v1/analytics/dashboard?range=all",
            headers={"Authorization": f"Bearer {student_a_token}"},
        )
        assert forbidden_dashboard.status_code == 403
        forbidden_student_insights = await client.get(
            "/api/v1/students/me/insights?range=all",
            headers={"Authorization": f"Bearer {company_a_token}"},
        )
        assert forbidden_student_insights.status_code == 403
        company_dashboard = await client.get(
            "/api/v1/analytics/dashboard?range=all",
            headers={"Authorization": f"Bearer {company_a_token}"},
        )
        assert company_dashboard.status_code == 200
        assert company_dashboard.json()["sample_size"] == 3

        admin_insights = await client.get(
            "/api/v1/admin/insights?range=all",
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        assert admin_insights.status_code == 200
        assert admin_insights.headers["cache-control"] == "no-store"
        admin_payload = admin_insights.json()
        assert admin_payload["kpis"]["admin_actions"]["value"] == 0
        assert sum(item["count"] for item in admin_payload["charts"]["admin_applications_over_time"]) == 11
        assert admin_payload["charts"]["signups_over_time"]
        assert (await client.get(
            "/api/v1/admin/insights",
            headers=company_headers,
        )).status_code == 403
        assert (await client.get(
            "/api/v1/companies/me/insights",
            headers={"Authorization": f"Bearer {student_a_token}"},
        )).status_code == 403

        empty_student = User(email="analytics-empty@example.com", password_hash="unused", role=UserRole.STUDENT)
        async with sessions() as session:
            session.add(empty_student)
            await session.commit()
            empty_token = create_token(str(empty_student.id), UserRole.STUDENT.value, "access", timedelta(minutes=30))
        empty_response = await client.get(
            "/api/v1/analytics/student/insights?range=all",
            headers={"Authorization": f"Bearer {empty_token}"},
        )
        assert empty_response.status_code == 200
        empty_payload = empty_response.json()
        assert empty_payload["total_applications"] == 0
        assert empty_payload["response_rate"] == 0
        assert empty_payload["avg_match_score"] == 0
        assert empty_payload["avg_response_hours"] == 0
        assert empty_payload["status_distribution"] == []
        assert empty_payload["skills_gap"] == []
        empty_insights_response = await client.get(
            "/api/v1/students/me/insights?range=all",
            headers={"Authorization": f"Bearer {empty_token}"},
        )
        assert empty_insights_response.status_code == 200
        empty_insights = empty_insights_response.json()
        assert empty_insights["sample_size"] == 0
        assert empty_insights["funnel"] == [
            {"stage": "Applications", "count": 0, "conversion_pct": None, "dropoff_pct": None},
            {"stage": "Screened", "count": 0, "conversion_pct": None, "dropoff_pct": None},
            {"stage": "Shortlisted", "count": 0, "conversion_pct": None, "dropoff_pct": None},
            {"stage": "Offers", "count": 0, "conversion_pct": None, "dropoff_pct": None},
        ]
        assert empty_insights["activity_trend"] == []
        assert empty_insights["kpis"]["response_rate"]["value"] is None
        assert empty_insights["kpis"]["average_match_score"]["value"] is None
        assert all(not rows for rows in empty_insights["charts"].values())
        assert all(sample == 0 for sample in empty_insights["chart_samples"].values())

        company_b_response = await client.get(
            "/api/v1/analytics/company/performance?range=all",
            headers={"Authorization": f"Bearer {company_b_token}"},
        )
        assert company_b_response.status_code == 200
        assert company_b_response.json()["total_applications"] == 1
        assert all(item["title"] != "Python Intern" for item in company_b_response.json()["by_role"])
        empty_company_response = await client.get(
            "/api/v1/analytics/company/performance?range=all",
            headers={"Authorization": f"Bearer {empty_company_token}"},
        )
        assert empty_company_response.status_code == 200
        assert empty_company_response.json()["total_applications"] == 0
        assert empty_company_response.json()["by_role"] == []
        assert empty_company_response.json()["time_metrics"]["sample_size"] == 0

    await engine.dispose()
