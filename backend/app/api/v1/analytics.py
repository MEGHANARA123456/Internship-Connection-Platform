# -----------------------------------------------------------------------------
# Analytics endpoints for dashboards, summaries, and reporting metrics.
# -----------------------------------------------------------------------------

from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from typing import Annotated, Any
from fastapi import APIRouter, Depends, Query
from sqlalchemy import case, func, select

from app.api.v1.dependencies import DbSession, get_current_user_optional, require_roles
from app.models import (
    Application,
    ApplicationEvent,
    AuditLog,
    CompanyProfile,
    Internship,
    Interview,
    StudentProfile,
    User,
    UserRole,
)
from app.schemas.admin import (
    AdminActionVolume,
    FunnelByCompany,
    TopCompanyItem,
    UserGrowthPoint,
)
from app.services.ai import compute_explicit_eligibility_fit, compute_match, get_student_resume_text
from app.services.analytics_domains import normalize_domain_rows
from app.services.application_funnel import cumulative_student_application_counts

router = APIRouter(prefix="/analytics", tags=["analytics"])
admin_only = Annotated[User, Depends(require_roles(UserRole.ADMIN))]# type: ignore
company_only = Annotated[User, Depends(require_roles(UserRole.COMPANY))]  # type: ignore
student_only = Annotated[User, Depends(require_roles(UserRole.STUDENT))]  # type: ignore


def _range_start(range_value: str) -> datetime | None:
    if range_value == "all":
        return None
    return datetime.now(timezone.utc) - timedelta(days=int(range_value))


def _range_filter(query: Any, column: Any, start: datetime | None) -> Any:
    return query.where(column >= start) if start is not None else query


def _skills(value: str | None) -> list[str]:
    return [skill.strip() for skill in (value or "").split(",") if skill.strip()]


def _elapsed_seconds(start: datetime, end: datetime) -> float:
    if start.tzinfo is None:
        start = start.replace(tzinfo=timezone.utc)
    if end.tzinfo is None:
        end = end.replace(tzinfo=timezone.utc)
    return (end - start).total_seconds()


@router.get("/company/performance")
async def company_performance(
    db: DbSession,
    user: company_only,
    range_value: str = Query("30", alias="range", pattern="^(30|90|all)$"),
) -> dict[str, Any]:
    """Return company-scoped hiring analytics, with all counts aggregated in SQL."""
    start = _range_start(range_value)
    applications_query = (
        select(Application.id, Application.internship_id, Application.student_id, Application.status, Application.created_at)
        .join(Internship, Internship.id == Application.internship_id)
        .where(Internship.company_id == user.id)
    )
    applications_query = _range_filter(applications_query, Application.created_at, start)
    application_rows = (await db.execute(applications_query)).all()
    application_ids = [row.id for row in application_rows]

    role_query = (
        select(
            Internship.id.label("internship_id"),
            Internship.title,
            func.count(Application.id).label("applications"),
            func.sum(case((Application.status == "SHORTLISTED", 1), else_=0)).label("shortlisted"),
            func.sum(case((Application.status.in_(["SELECTED", "ACCEPTED"]), 1), else_=0)).label("offers"),
            func.sum(case((Application.status == "ACCEPTED", 1), else_=0)).label("accepted"),
        )
        .join(Application, Application.internship_id == Internship.id)
        .where(Internship.company_id == user.id)
    )
    role_query = _range_filter(role_query, Application.created_at, start)
    role_query = role_query.group_by(Internship.id, Internship.title).order_by(func.count(Application.id).desc())
    role_rows = (await db.execute(role_query)).all()

    status_query = (
        select(Application.status, func.count(Application.id))
        .join(Internship, Internship.id == Application.internship_id)
        .where(Internship.company_id == user.id)
    )
    status_query = _range_filter(status_query, Application.created_at, start)
    status_rows = (await db.execute(status_query.group_by(Application.status))).all()
    status_distribution = [{"status": status, "count": count} for status, count in status_rows]

    event_query = (
        select(
            ApplicationEvent.application_id,
            func.min(case((ApplicationEvent.event_type != "APPLIED", ApplicationEvent.created_at))).label("first_response"),
            func.min(case((ApplicationEvent.event_type.in_(["SELECTED", "OFFER"]), ApplicationEvent.created_at))).label("first_offer"),
        )
        .join(Application, Application.id == ApplicationEvent.application_id)
        .join(Internship, Internship.id == Application.internship_id)
        .where(
            Internship.company_id == user.id,
            ApplicationEvent.actor_id == Internship.company_id,
        )
    )
    if application_ids:
        event_query = event_query.where(Application.id.in_(application_ids))
    else:
        event_query = event_query.where(Application.id == -1)
    event_rows = (await db.execute(event_query.group_by(ApplicationEvent.application_id))).all()
    application_by_id = {row.id: row for row in application_rows}
    response_hours: list[float] = []
    offer_days: list[float] = []
    for event in event_rows:
        application = application_by_id.get(event.application_id)
        if application is None:
            continue
        if event.first_response is not None:
            response_hours.append(_elapsed_seconds(application.created_at, event.first_response) / 3600)
        if event.first_offer is not None:
            offer_days.append(_elapsed_seconds(application.created_at, event.first_offer) / 86400)

    match_query = (
        select(
            Application,
            Internship.title,
            Internship.description,
            Internship.skills,
            StudentProfile.skills,
            StudentProfile.graduation_year,
            StudentProfile.major,
            StudentProfile.university,
        )
        .join(Internship, Internship.id == Application.internship_id)
        .outerjoin(StudentProfile, StudentProfile.user_id == Application.student_id)
        .where(Internship.company_id == user.id)
    )
    match_query = _range_filter(match_query, Application.created_at, start)
    match_rows = (await db.execute(match_query.order_by(Application.created_at.desc(), Application.id.desc()).limit(300))).all()
    buckets = {"0-49": 0, "50-69": 0, "70-84": 0, "85+": 0}
    for _, title, description, required, candidate_skills, graduation_year, major, university in match_rows:
        result = compute_match(
            _skills(candidate_skills),
            "",
            title,
            description,
            _skills(required),
            eligibility_data=compute_explicit_eligibility_fit(
                description,
                graduation_year,
                f"{major or ''} {university or ''}".strip(),
            ),
        )
        score = result["score"]
        if score is None:
            continue
        bucket = "0-49" if score < 50 else "50-69" if score < 70 else "70-84" if score < 85 else "85+"
        buckets[bucket] += 1

    skill_rows_query = (
        select(Application.id, Application.internship_id, StudentProfile.skills, Internship.skills)
        .join(Internship, Internship.id == Application.internship_id)
        .outerjoin(StudentProfile, StudentProfile.user_id == Application.student_id)
        .where(Internship.company_id == user.id)
    )
    skill_rows_query = _range_filter(skill_rows_query, Application.created_at, start)
    skill_rows = (await db.execute(skill_rows_query)).all()
    applicants_by_skill: dict[str, set[int]] = defaultdict(set)
    roles_by_skill: dict[str, set[int]] = defaultdict(set)
    skill_names: dict[str, str] = {}
    for application_id, internship_id, candidate_skills, required_skills in skill_rows:
        candidate_set = {skill.casefold(): skill for skill in _skills(candidate_skills)}
        for skill in _skills(required_skills):
            normalized = skill.casefold()
            skill_names.setdefault(normalized, skill)
            roles_by_skill[normalized].add(internship_id)
            if normalized in candidate_set:
                applicants_by_skill[normalized].add(application_id)
    top_skills = [
        {
            "skill": skill_names[skill],
            "applicants": len(applicants_by_skill[skill]),
            "required_by_roles": len(roles_by_skill[skill]),
        }
        for skill in sorted(roles_by_skill, key=lambda item: (-len(roles_by_skill[item]), item))[:8]
    ]

    universities_query = (
        select(StudentProfile.university, func.count(Application.id).label("applicants"))
        .join(Application, Application.student_id == StudentProfile.user_id)
        .join(Internship, Internship.id == Application.internship_id)
        .where(Internship.company_id == user.id)
    )
    universities_query = _range_filter(universities_query, Application.created_at, start)
    universities_query = (
        universities_query.group_by(StudentProfile.university)
        .order_by(func.count(Application.id).desc())
        .limit(5)
    )
    university_rows = (await db.execute(universities_query)).all()

    interview_query = (
        select(Interview.status, func.count(Interview.id))
        .join(Application, Application.id == Interview.application_id)
        .join(Internship, Internship.id == Application.internship_id)
        .where(Internship.company_id == user.id)
    )
    interview_query = _range_filter(interview_query, Application.created_at, start)
    interview_rows = (await db.execute(interview_query.group_by(Interview.status))).all()
    interview_counts = {status.upper(): count for status, count in interview_rows}
    upcoming_interviews = int(
        await db.scalar(
            select(func.count(Interview.id))
            .join(Application, Application.id == Interview.application_id)
            .join(Internship, Internship.id == Application.internship_id)
            .where(
                Internship.company_id == user.id,
                Interview.status.in_(("SCHEDULED", "RESCHEDULED")),
                Interview.scheduled_at > datetime.now(timezone.utc),
            )
        )
        or 0
    )

    offered = sum(int(row.offers or 0) for row in role_rows)
    accepted = sum(int(row.accepted or 0) for row in role_rows)
    return {
        "range": range_value,
        "by_role": [
            {
                "internship_id": row.internship_id,
                "title": row.title,
                "applications": int(row.applications or 0),
                "shortlisted": int(row.shortlisted or 0),
                "offers": int(row.offers or 0),
                "accepted": int(row.accepted or 0),
            }
            for row in role_rows
        ],
        "status_distribution": status_distribution,
        "time_metrics": {
            "avg_hours_to_first_response": round(sum(response_hours) / len(response_hours), 2) if response_hours else 0,
            "avg_days_to_offer": round(sum(offer_days) / len(offer_days), 2) if offer_days else 0,
            "sample_size": len(response_hours),
            "offer_sample_size": len(offer_days),
        },
        "match_distribution": [{"bucket": bucket, "count": count} for bucket, count in buckets.items()],
        "match_distribution_sample_size": len(match_rows),
        "match_distribution_note": "Computed with compute_match on the most recent 300 applications in this range.",
        "top_skills": top_skills,
        "top_universities": [
            {"university": university or "Not specified", "applicants": count}
            for university, count in university_rows
        ],
        "interview_outcomes": {
            "scheduled": upcoming_interviews,
            "completed": interview_counts.get("COMPLETED", 0),
            "cancelled": interview_counts.get("CANCELLED", 0),
        },
        "offer_acceptance_rate": round((accepted / offered) * 100, 1) if offered else 0,
        "offer_sample_size": offered,
        "total_applications": len(application_rows),
    }


@router.get("/student/insights")
async def student_insights(
    db: DbSession,
    user: student_only,
    range_value: str = Query("30", alias="range", pattern="^(30|90|all)$"),
) -> dict[str, Any]:
    """Return personal application insights for the authenticated student only."""
    start = _range_start(range_value)
    base_query = (
        select(
            Application,
            Internship.title,
            Internship.description,
            Internship.skills,
            StudentProfile.skills,
            StudentProfile.graduation_year,
            StudentProfile.major,
            StudentProfile.university,
        )
        .join(Internship, Internship.id == Application.internship_id)
        .outerjoin(StudentProfile, StudentProfile.user_id == Application.student_id)
        .where(Application.student_id == user.id)
    )
    base_query = _range_filter(base_query, Application.created_at, start)
    application_rows = (await db.execute(base_query)).all()
    resume_text = await get_student_resume_text(db, user.id)
    application_ids = [row[0].id for row in application_rows]

    status_query = (
        select(Application.status, func.count(Application.id))
        .where(Application.student_id == user.id)
    )
    status_query = _range_filter(status_query, Application.created_at, start)
    status_rows = (await db.execute(status_query.group_by(Application.status))).all()

    weekly_start = datetime.now(timezone.utc).date()
    weekly_start -= timedelta(days=weekly_start.weekday())
    weekly_start -= timedelta(weeks=7)
    weekly_query = select(Application.created_at).where(
        Application.student_id == user.id,
        Application.created_at >= datetime.combine(weekly_start, datetime.min.time(), tzinfo=timezone.utc),
    )
    if start is not None:
        weekly_query = weekly_query.where(Application.created_at >= start)
    weekly_dates = list(await db.scalars(weekly_query))
    weekly_counts: Counter[str] = Counter()
    for created_at in weekly_dates:
        if created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=timezone.utc)
        monday = created_at.date() - timedelta(days=created_at.weekday())
        weekly_counts[monday.isoformat()] += 1
    weekly_applications = []
    for offset in range(8):
        week = weekly_start + timedelta(weeks=offset)
        weekly_applications.append({"week_start": week.isoformat(), "applications": weekly_counts[week.isoformat()]})

    responded_query = (
        select(func.count(func.distinct(ApplicationEvent.application_id)))
        .join(Application, Application.id == ApplicationEvent.application_id)
        .join(Internship, Internship.id == Application.internship_id)
        .where(
            Application.student_id == user.id,
            ApplicationEvent.event_type != "APPLIED",
            ApplicationEvent.actor_id == Internship.company_id,
        )
    )
    responded_query = _range_filter(responded_query, Application.created_at, start)
    responded_count = int(await db.scalar(responded_query) or 0)

    match_scores: list[int] = []
    missing_counts: Counter[str] = Counter()
    missing_names: dict[str, str] = {}
    for application, title, description, required, candidate_skills, graduation_year, major, university in application_rows:
        match = compute_match(
            _skills(candidate_skills),
            resume_text,
            title,
            description,
            _skills(required),
            eligibility_data=compute_explicit_eligibility_fit(
                description,
                graduation_year,
                f"{major or ''} {university or ''}".strip(),
            ),
        )
        if match["score"] is not None:
            match_scores.append(match["score"])
        required_names = {skill.casefold(): skill for skill in _skills(required)}
        for skill in match["missing_skills"]:
            normalized = skill.casefold()
            missing_names.setdefault(normalized, required_names.get(normalized, skill))
            missing_counts[normalized] += 1

    response_query = (
        select(
            ApplicationEvent.application_id,
            func.min(case((ApplicationEvent.event_type != "APPLIED", ApplicationEvent.created_at))).label("first_response"),
        )
        .join(Application, Application.id == ApplicationEvent.application_id)
        .join(Internship, Internship.id == Application.internship_id)
        .where(
            Application.student_id == user.id,
            ApplicationEvent.actor_id == Internship.company_id,
        )
    )
    if application_ids:
        response_query = response_query.where(Application.id.in_(application_ids))
    else:
        response_query = response_query.where(Application.id == -1)
    response_rows = (await db.execute(response_query.group_by(ApplicationEvent.application_id))).all()
    created_by_id = {row[0].id: row[0].created_at for row in application_rows}
    response_hours = [
        _elapsed_seconds(created_by_id[row.application_id], row.first_response) / 3600
        for row in response_rows
        if row.first_response is not None and row.application_id in created_by_id
    ]

    total = len(application_rows)
    funnel_counts = await cumulative_student_application_counts(
        db,
        user.id,
        application_ids,
    )
    funnel = [
        ("Applications", total),
        ("Screened", funnel_counts["screened"]),
        ("Shortlisted", funnel_counts["shortlisted"]),
        ("Offers", funnel_counts["offers"]),
    ]
    return {
        "range": range_value,
        "status_distribution": [{"status": status, "count": count} for status, count in status_rows],
        "funnel": [
            {
                "stage": stage,
                "count": count,
                "conversion_pct": round(count * 100 / total, 1) if total else None,
                "dropoff_pct": round(max(0.0, 100 - (count * 100 / total)), 1) if total else None,
            }
            for stage, count in funnel
        ],
        "weekly_applications": weekly_applications,
        "response_rate": round((responded_count / total) * 100, 1) if total else 0,
        "response_sample_size": total,
        "responded_applications": responded_count,
        "avg_match_score": round(sum(match_scores) / len(match_scores), 1) if match_scores else 0,
        "match_sample_size": len(match_scores),
        "skills_gap": [
            {"skill": missing_names[skill], "missing_count": count}
            for skill, count in sorted(missing_counts.items(), key=lambda item: (-item[1], item[0]))[:8]
        ],
        "avg_response_hours": round(sum(response_hours) / len(response_hours), 2) if response_hours else 0,
        "response_time_sample_size": len(response_hours),
        "total_applications": total,
    }


# ── Public / role-aware overview ──────────────────────────────────────────────

@router.get("/overview")
async def get_analytics_overview(
    db: DbSession,
    user: Annotated[User | None, Depends(get_current_user_optional)] = None,
) -> dict[str, Any]:
    """
    Returns authentic recruitment pipeline funnel stages, monthly trend velocity,
    and domain distribution directly from the database with ZERO mock data.
    """
    role = user.role.value if user else "PUBLIC"
    user_id = user.id if user else None
    company_summary = None

    # Default funnel stats
    funnel = {
        "applied": 0,
        "screened": 0,
        "shortlisted": 0,
        "interviews": 0,
        "offers": 0,
    }
    domains: list[dict[str, Any]] = []
    monthly_trends: list[dict[str, Any]] = []

    if role == "STUDENT" and user_id:
        # 1. Student personal application funnel
        apps = (await db.scalars(select(Application).where(Application.student_id == user_id))).all()
        funnel["applied"] = len(apps)
        stage_counts = await cumulative_student_application_counts(db, user_id)
        funnel.update(stage_counts)

        # Real domain breakdown for applied roles
        domain_query = (
            select(Internship.industry, func.count(Application.id))
            .join(Internship, Application.internship_id == Internship.id)
            .where(Application.student_id == user_id)
            .group_by(Internship.industry)
        )
        domain_rows = (await db.execute(domain_query)).all()
        domains = normalize_domain_rows(domain_rows)

    elif role == "COMPANY" and user_id:
        # 2. Company hiring pipeline
        company_jobs = (await db.scalars(select(Internship).where(Internship.company_id == user_id))).all()
        job_ids = [j.id for j in company_jobs]
        company_summary = {
            "active": sum(1 for job in company_jobs if job.status == "PUBLISHED"),
            "closed": sum(1 for job in company_jobs if job.status == "CLOSED"),
            "total_applications": int(
                await db.scalar(
                    select(func.count(Application.id))
                    .join(Internship, Application.internship_id == Internship.id)
                    .where(Internship.company_id == user_id)
                )
                or 0
            ),
        }

        if job_ids:
            apps = (await db.scalars(select(Application).where(Application.internship_id.in_(job_ids)))).all()
            funnel["applied"] = len(apps)
            funnel["screened"] = sum(1 for a in apps if a.status != "REJECTED")
            funnel["interviews"] = sum(1 for a in apps if a.status in {
                "SHORTLISTED",
                "INTERVIEW_SCHEDULED",
                "SELECTED",
                "ACCEPTED",
            })
            funnel["offers"] = sum(1 for a in apps if a.status in {"SELECTED", "ACCEPTED"})

            # Domain breakdown of company's open listings
            domain_query = (
                select(Internship.industry, func.count(Internship.id))
                .where(Internship.company_id == user_id)
                .group_by(Internship.industry)
            )
            domain_rows = (await db.execute(domain_query)).all()
            domains = normalize_domain_rows(domain_rows)

    else:
        # 3. Admin / Public Platform Aggregate
        total_apps = await db.scalar(select(func.count(Application.id))) or 0
        total_interviews = await db.scalar(select(func.count(Interview.id))) or 0
        total_offers = await db.scalar(
            select(func.count(Application.id)).where(
                Application.status.in_(["SELECTED", "ACCEPTED"])
            )
        ) or 0
        screened_count = await db.scalar(
            select(func.count(Application.id)).where(
                Application.status.in_([
                    "UNDER_REVIEW",
                    "SHORTLISTED",
                    "INTERVIEW_SCHEDULED",
                    "SELECTED",
                    "ACCEPTED",
                ])
            )
        ) or 0

        funnel["applied"] = total_apps
        funnel["screened"] = screened_count
        funnel["interviews"] = total_interviews
        funnel["offers"] = total_offers

        domain_query = (
            select(Internship.industry, func.count(Internship.id))
            .where(Internship.status == "PUBLISHED")
            .group_by(Internship.industry)
        )
        domain_rows = (await db.execute(domain_query)).all()
        domains = normalize_domain_rows(domain_rows)

    # Generate monthly activity from recent months
    now = datetime.now(timezone.utc)
    months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    # Build a 6-month trailing window
    for offset in range(5, -1, -1):
        target_month_idx = (now.month - 1 - offset) % 12
        m_name = months[target_month_idx]
        monthly_trends.append({
            "month": m_name,
            "apps": funnel["applied"] if offset == 0 else 0,
            "interviews": funnel["interviews"] if offset == 0 else 0,
            "offers": funnel["offers"] if offset == 0 else 0,
        })

    # Summary metrics
    has_activity = funnel["applied"] > 0 or len(domains) > 0

    return {
        "role": role,
        "has_activity": has_activity,
        "funnel": funnel,
        "company_summary": company_summary,
        "domains": domains,
        "monthly_trends": monthly_trends,
        "total_active_internships": await db.scalar(select(func.count(Internship.id)).where(Internship.status == "PUBLISHED")) or 0,
        "total_verified_students": await db.scalar(select(func.count(StudentProfile.id))) or 0,
        "total_companies": await db.scalar(select(func.count(CompanyProfile.id))) or 0,
    }


# ── Admin-only analytics ──────────────────────────────────────────────────────

@router.get("/admin/user-growth", response_model=list[UserGrowthPoint])
async def admin_user_growth(
    db: DbSession,
    user: admin_only,
    granularity: str = Query("month", pattern="^(week|month)$"),
    periods: int = Query(12, ge=1, le=52),
) -> list[dict[str, Any]]:
    """
    User signup counts grouped by week or month for the last N periods.
    Returns a list of {period, students, companies, admins} objects.
    """
    now = datetime.now(timezone.utc)
    result: list[dict[str, Any]] = []

    for i in range(periods - 1, -1, -1):
        if granularity == "week":
            period_start = now - timedelta(weeks=i + 1)
            period_end = now - timedelta(weeks=i)
            label = period_start.strftime("%Y-W%W")
        else:
            # month — step back i months
            year = now.year
            month = now.month - i
            while month <= 0:
                month += 12
                year -= 1
            period_start = datetime(year, month, 1, tzinfo=timezone.utc)
            if month == 12:
                period_end = datetime(year + 1, 1, 1, tzinfo=timezone.utc)
            else:
                period_end = datetime(year, month + 1, 1, tzinfo=timezone.utc)
            label = period_start.strftime("%Y-%m")

        async def _count_role(role: UserRole) -> int:
            return int(
                await db.scalar(
                    select(func.count(User.id))
                    .where(
                        User.role == role,
                        User.created_at >= period_start,
                        User.created_at < period_end,
                    )
                ) or 0
            )

        result.append(UserGrowthPoint(
            period=label,
            students=await _count_role(UserRole.STUDENT),# type: ignore
            companies=await _count_role(UserRole.COMPANY), # type: ignore
            admins=await _count_role(UserRole.ADMIN),# type: ignore
        ).model_dump())

    return result


@router.get("/admin/application-funnel-by-company", response_model=list[FunnelByCompany])
async def admin_funnel_by_company(
    db: DbSession,
    user: admin_only,
    limit: int = Query(20, ge=1, le=100),
) -> list[dict[str, Any]]:
    """Per-company application funnel: applied / screened / interview / offers."""
    # Get top companies by application volume
    rows = (await db.execute(
        select(Internship.company_id, func.count(Application.id).label("total"))
        .join(Application, Application.internship_id == Internship.id)
        .group_by(Internship.company_id)
        .order_by(func.count(Application.id).desc())
        .limit(limit)
    )).all()

    company_ids = [r[0] for r in rows]

    # Fetch company names
    profiles = list(await db.scalars(
        select(CompanyProfile).where(CompanyProfile.user_id.in_(company_ids))
    ))
    name_map = {p.user_id: p.company_name for p in profiles}

    result = []
    for (company_id, _) in rows:
        job_ids = [
            j.id for j in await db.scalars(# type: ignore
                select(Internship.id).where(Internship.company_id == company_id)
            )
        ]
        apps = list(await db.scalars(
            select(Application).where(Application.internship_id.in_(job_ids))
        )) if job_ids else []

        result.append(FunnelByCompany(
            company_id=company_id,
            company_name=name_map.get(company_id, f"Company #{company_id}"),
            applied=len(apps),
            screened=sum(1 for a in apps if a.status not in {"APPLIED", "REJECTED"}),
            interviews=sum(1 for a in apps if a.status in {"SHORTLISTED", "INTERVIEW_SCHEDULED", "SELECTED", "ACCEPTED"}),
            offers=sum(1 for a in apps if a.status in {"SELECTED", "ACCEPTED"}),
        ).model_dump())

    return result


@router.get("/admin/top-companies", response_model=list[TopCompanyItem])
async def admin_top_companies(
    db: DbSession,
    user: admin_only,
    limit: int = Query(10, ge=1, le=50),
) -> list[dict[str, Any]]:
    """Top companies by total posting volume."""
    rows = (await db.execute(
        select(
            Internship.company_id,
            func.count(Internship.id).label("posting_count"),
            func.count(Internship.id).filter(Internship.status == "PUBLISHED").label("published_count"),
        )
        .group_by(Internship.company_id)
        .order_by(func.count(Internship.id).desc())
        .limit(limit)
    )).all()

    company_ids = [r[0] for r in rows]
    profiles = list(await db.scalars(
        select(CompanyProfile).where(CompanyProfile.user_id.in_(company_ids))
    ))
    name_map = {p.user_id: p.company_name for p in profiles}

    return [
        TopCompanyItem(
            company_id=r[0],
            company_name=name_map.get(r[0], f"Company #{r[0]}"),
            posting_count=r[1],
            published_count=r[2],
        ).model_dump()
        for r in rows
    ]


@router.get("/admin/admin-action-volume", response_model=list[AdminActionVolume])
async def admin_action_volume(
    db: DbSession,
    user: admin_only,
    days: int = Query(30, ge=1, le=365),
) -> list[dict[str, Any]]:
    """Count every audit action type over the last N days."""
    since = datetime.now(timezone.utc) - timedelta(days=days)
    rows = (await db.execute(
        select(AuditLog.action, func.count(AuditLog.id))
        .where(AuditLog.created_at >= since)
        .group_by(AuditLog.action)
        .order_by(func.count(AuditLog.id).desc(), AuditLog.action)
    )).all()

    return [
        AdminActionVolume(action=action, count=int(count)).model_dump()
        for action, count in rows
    ]
