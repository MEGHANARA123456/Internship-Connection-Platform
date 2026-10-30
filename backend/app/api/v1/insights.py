from datetime import date, datetime, timedelta, timezone
from statistics import median
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import case, func, select

from app.api.v1.dependencies import DbSession, require_roles
from app.models import (
    Application,
    ApplicationEvent,
    ApplicationStatusEvent,
    AuditLog,
    CompanyProfile,
    Internship,
    Interview,
    Report,
    SavedInternship,
    StudentProfile,
    User,
    UserRole,
)
from app.services.ai import compute_explicit_eligibility_fit, compute_match, get_student_resume_text
from app.services.analytics_domains import normalize_domain_rows
from app.services.application_funnel import cumulative_student_application_counts
from app.services.audit import audit_action_label

router = APIRouter(tags=["analytics"])
dashboard_user = Annotated[User, Depends(require_roles(UserRole.COMPANY, UserRole.ADMIN))]# type: ignore

INTERVIEW_STATUSES = {"SHORTLISTED", "INTERVIEW_SCHEDULED", "SELECTED", "ACCEPTED"}
SCREENED_STATUSES = {
    "UNDER_REVIEW",
    "SHORTLISTED",
    "INTERVIEW_SCHEDULED",
    "SELECTED",
    "ACCEPTED",
    "REJECTED",
}
OFFER_STATUSES = {"SELECTED", "ACCEPTED"}
RANGE_DAYS = {"7": 7, "30": 30, "90": 90}
ACTIVE_ROLE_STATUSES = {"PUBLISHED"}
INTERVIEW_APPLICATION_STATUSES = {"INTERVIEW_SCHEDULED", "SELECTED", "ACCEPTED"}


def _cutoff(range_value: str) -> datetime | None:
    """Return a UTC lookback timestamp for the requested number of days, or None when no limit is requested."""
    days = RANGE_DAYS.get(range_value)
    return datetime.now(timezone.utc) - timedelta(days=days) if days is not None else None


def _scope(query: Any, user: User) -> Any:
    """Restrict an application query to records visible to the supplied student or company user."""
    if user.role == UserRole.STUDENT:
        return query.where(Application.student_id == user.id)
    if user.role == UserRole.COMPANY:
        return query.where(Internship.company_id == user.id)
    return query


def _application_date_filter(query: Any, range_value: str) -> Any:
    """Apply the requested creation-date lookback to an application query."""
    cutoff = _cutoff(range_value)
    return query.where(Application.created_at >= cutoff) if cutoff is not None else query


async def _chart_series(
    db: DbSession,
    user: User,
    range_value: str,
) -> dict[str, Any]:
    """Build role-scoped application funnel and activity-series data for the requested reporting range."""
    status_query = _scope(
        select(Application.status, func.count(Application.id))
        .join(Internship, Application.internship_id == Internship.id),
        user,
    )
    status_rows = (await db.execute(status_query.group_by(Application.status))).all()
    status_counts = {status: int(count) for status, count in status_rows}
    total = sum(status_counts.values())

    domain_query = _scope(
        select(Internship.industry, func.count(Application.id))
        .join(Application, Application.internship_id == Internship.id),
        user,
    )
    domain_rows = (
        await db.execute(
            domain_query.group_by(Internship.industry).order_by(func.count(Application.id).desc())
        )
    ).all()
    work_mode_query = _scope(
        select(Internship.work_mode, func.count(Application.id))
        .join(Application, Application.internship_id == Internship.id),
        user,
    )
    work_mode_rows = (
        await db.execute(
            work_mode_query.group_by(Internship.work_mode).order_by(func.count(Application.id).desc())
        )
    ).all()

    trend_query = _application_date_filter(
        _scope(
            select(
                func.date(Application.created_at).label("bucket"),
                func.count(Application.id).label("applications"),
                func.sum(case((Application.status.in_(INTERVIEW_STATUSES), 1), else_=0)).label("interviews"),
                func.sum(case((Application.status.in_(OFFER_STATUSES), 1), else_=0)).label("offers"),
            ).join(Internship, Application.internship_id == Internship.id),
            user,
        ),
        range_value,
    )
    trend_rows = (
        await db.execute(
            trend_query.group_by(func.date(Application.created_at)).order_by(func.date(Application.created_at))
        )
    ).all()

    if user.role == UserRole.STUDENT:
        stages = await cumulative_student_application_counts(db, user.id)
        funnel_counts = [
            ("Applications", total),
            ("Screened", stages["screened"]),
            ("Shortlisted", stages["shortlisted"]),
            ("Offers", stages["offers"]),
        ]
        conversion_denominator = total
    else:
        funnel_counts = [
            ("Applications", total),
            ("Screened", sum(status_counts.get(status, 0) for status in SCREENED_STATUSES)),
            ("Interview stage", sum(status_counts.get(status, 0) for status in INTERVIEW_STATUSES)),
            ("Offers", sum(status_counts.get(status, 0) for status in OFFER_STATUSES)),
        ]
        conversion_denominator = 0
    funnel: list[dict[str, Any]] = []
    for index, (label, count) in enumerate(funnel_counts):
        previous = funnel_counts[index - 1][1] if index else None
        denominator = conversion_denominator if user.role == UserRole.STUDENT else previous
        conversion = round(count * 100 / denominator, 1) if denominator else None
        funnel.append(
            {
                "stage": label,
                "count": count,
                "conversion_pct": conversion,
                "dropoff_pct": round(max(0.0, 100 - conversion), 1) if conversion is not None else None,
            }
        )

    return {
        "range": range_value,
        "sample_size": total,
        "funnel": funnel,
        "activity_trend": [
            {
                "date": str(bucket),
                "applications": int(app_count or 0),
                "interviews": int(interview_count or 0),
                "offers": int(offer_count or 0),
            }
            for bucket, app_count, interview_count, offer_count in trend_rows
        ],
        "status_breakdown": [
            {"status": status, "count": count}
            for status, count in sorted(status_counts.items())
        ],
        "domains": normalize_domain_rows(domain_rows), # type: ignore
        "work_modes": [
            {"name": work_mode or "Unspecified", "count": int(count)}
            for work_mode, count in work_mode_rows
        ],
        "has_data": total > 0,
    }


@router.get("/students/me/insights")
async def student_insights(
    db: DbSession,
    response: Response,
    user: User = Depends(require_roles(UserRole.STUDENT)),# type: ignore
    range_value: str = Query("30", alias="range", pattern="^(7|30|90|all)$"),
) -> dict[str, Any]:
    """Return one student-scoped response for every KPI and analytics chart."""
    response.headers["Cache-Control"] = "no-store"
    data = await _chart_series(db, user, range_value)
    match_query = (
        select(
            Application.id,
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
    match_rows = (await db.execute(match_query)).all()
    matches: list[int] = []
    score_buckets = {"0-49": 0, "50-69": 0, "70-84": 0, "85-100": 0}
    resume_text = await get_student_resume_text(db, user.id)
    for _, title, description, required_skills, student_skills, graduation_year, major, university in match_rows:
        match = compute_match(
            [item.strip() for item in (student_skills or "").split(",") if item.strip()],
            resume_text,
            title,
            description,
            [item.strip() for item in (required_skills or "").split(",") if item.strip()],
            eligibility_data=compute_explicit_eligibility_fit(
                description,
                graduation_year,
                f"{major or ''} {university or ''}".strip(),
            ),
        )
        if match["score"] is None:
            continue
        score = int(match["score"])
        matches.append(score)
        bucket = "0-49" if score < 50 else "50-69" if score < 70 else "70-84" if score < 85 else "85-100"
        score_buckets[bucket] += 1

    responded_query = (
        select(
            ApplicationEvent.application_id,
            func.min(ApplicationEvent.created_at).label("first_response"),
            Application.created_at.label("applied_at"),
        )
        .join(Application, Application.id == ApplicationEvent.application_id)
        .join(Internship, Internship.id == Application.internship_id)
        .where(
            Application.student_id == user.id,
            ApplicationEvent.event_type != "APPLIED",
            ApplicationEvent.actor_id == Internship.company_id,
        )
    )
    response_rows = (
        await db.execute(
            responded_query.group_by(ApplicationEvent.application_id, Application.created_at)
        )
    ).all()
    response_hours: list[float] = []
    for _, first_response, applied_at in response_rows:
        if first_response.tzinfo is None:
            first_response = first_response.replace(tzinfo=timezone.utc)
        if applied_at.tzinfo is None:
            applied_at = applied_at.replace(tzinfo=timezone.utc)
        response_hours.append(max(0.0, (first_response - applied_at).total_seconds() / 3600))

    scheduled_interviews = int(
        await db.scalar(
            select(func.count(Interview.id))
            .join(Application, Application.id == Interview.application_id)
            .where(
                Application.student_id == user.id,
                Interview.status.in_(["SCHEDULED", "RESCHEDULED"]),
                Interview.scheduled_at > datetime.now(timezone.utc),
            )
        )
        or 0
    )
    saved_roles = int(
        await db.scalar(
            select(func.count(SavedInternship.id)).where(SavedInternship.student_id == user.id)
        )
        or 0
    )
    total = int(data["sample_size"])
    responded = len({row[0] for row in response_rows})
    application_count = total
    status_counts = {item["status"]: item["count"] for item in data["status_breakdown"]}
    data["match_score_distribution"] = [
        {"bucket": bucket, "count": count} for bucket, count in score_buckets.items()
    ]
    data["kpis"] = {
        "applications_submitted": {
            "value": application_count,
            "sample_size": total,
            "definition": "Count of this student's application records.",
        },
        "under_review": {
            "value": status_counts.get("UNDER_REVIEW", 0),
            "sample_size": total,
            "definition": "Applications whose current status is UNDER_REVIEW.",
        },
        "shortlisted": {
            "value": status_counts.get("SHORTLISTED", 0),
            "sample_size": total,
            "definition": "Applications whose current status is SHORTLISTED.",
        },
        "offers": {
            "value": status_counts.get("SELECTED", 0) + status_counts.get("ACCEPTED", 0),
            "sample_size": total,
            "definition": "Applications currently SELECTED or ACCEPTED.",
        },
        "interviews_scheduled": {
            "value": scheduled_interviews,
            "sample_size": scheduled_interviews,
            "definition": "Interviews with SCHEDULED or RESCHEDULED status.",
        },
        "saved_roles": {
            "value": saved_roles,
            "sample_size": saved_roles,
            "definition": "Saved internship records belonging to this student.",
        },
        "response_rate": {
            "value": round(responded * 100 / total, 1) if total else None,
            "sample_size": total,
            "numerator": responded,
            "denominator": total,
            "definition": "Applications with a recruiter-authored event beyond APPLIED divided by all applications.",
        },
        "average_match_score": {
            "value": round(sum(matches) / len(matches), 1) if matches else None,
            "sample_size": len(matches),
            "definition": "Mean compute_match score across this student's applications.",
        },
        "recruiter_response_time": {
            "value": round(sum(response_hours) / len(response_hours), 1) if response_hours else None,
            "sample_size": len(response_hours),
            "definition": "Mean hours from application submission to the first recruiter-authored event beyond APPLIED.",
        },
    }
    cutoff = _cutoff(range_value)
    status_events_query = (
        select(ApplicationStatusEvent.changed_at, ApplicationStatusEvent.to_status)
        .join(Application, Application.id == ApplicationStatusEvent.application_id)
        .where(Application.student_id == user.id)
        .where(ApplicationStatusEvent.to_status.is_not(None))
        .order_by(ApplicationStatusEvent.changed_at)
    )
    if cutoff is not None:
        status_events_query = status_events_query.where(ApplicationStatusEvent.changed_at >= cutoff)
    status_week_rows = await db.execute(status_events_query)
    status_names = {
        "APPLIED": "applied",
        "UNDER_REVIEW": "under_review",
        "SHORTLISTED": "shortlisted",
        "INTERVIEW_SCHEDULED": "interview",
        "SELECTED": "selected",
        "ACCEPTED": "accepted",
        "REJECTED": "rejected",
        "WITHDRAWN": "withdrawn",
    }
    status_by_week: dict[str, dict[str, int]] = {}
    for changed_at, to_status in status_week_rows.all():
        if changed_at.tzinfo is None:
            changed_at = changed_at.replace(tzinfo=timezone.utc)
        week_start = (changed_at.date() - timedelta(days=changed_at.weekday())).isoformat()
        status_counts_for_week = status_by_week.setdefault(
            week_start,
            {name: 0 for name in status_names.values()},
        )
        status_key = status_names.get(str(to_status))
        if status_key:
            status_counts_for_week[status_key] += 1
    status_over_time = [
        {
            "name": week,
            "date": week,
            **counts,
            "count": sum(counts.values()),
        }
        for week, counts in sorted(status_by_week.items())[-8:]
    ]

    first_response_query = (
        select(
            Application.id,
            Application.created_at,
            func.min(ApplicationEvent.created_at).label("first_response"),
        )
        .join(ApplicationEvent, ApplicationEvent.application_id == Application.id)
        .join(Internship, Internship.id == Application.internship_id)
        .where(
            Application.student_id == user.id,
            ApplicationEvent.event_type != "APPLIED",
            ApplicationEvent.actor_id == Internship.company_id,
        )
        .group_by(Application.id, Application.created_at)
        .order_by(Application.created_at)
    )
    if cutoff is not None:
        first_response_query = first_response_query.where(Application.created_at >= cutoff)
    first_responses = (await db.execute(first_response_query)).all()
    response_days: list[float] = []
    for _, applied_at, responded_at in first_responses:
        if applied_at.tzinfo is None:
            applied_at = applied_at.replace(tzinfo=timezone.utc)
        if responded_at.tzinfo is None:
            responded_at = responded_at.replace(tzinfo=timezone.utc)
        response_days.append(max(0.0, (responded_at - applied_at).total_seconds() / 86400))
    median_response_days = round(median(response_days), 2) if response_days else None
    response_times = []
    for (application_id, applied_at, responded_at), days in zip(first_responses, response_days):
        response_times.append({
            "name": f"Application {application_id}",
            "count": 1,
            "days": round(days, 2),
            "application_id": application_id,
            "median_days": median_response_days,
        })

    student_profile = await db.scalar(select(StudentProfile).where(StudentProfile.user_id == user.id))
    resume_text = await get_student_resume_text(db, user.id)
    role_rows = (
        await db.execute(
            select(Internship.id, Internship.title, Internship.skills, Internship.stipend, Internship.duration_months, Internship.deadline)
            .join(Application, Application.internship_id == Internship.id)
            .where(Application.student_id == user.id)
            .union(
                select(Internship.id, Internship.title, Internship.skills, Internship.stipend, Internship.duration_months, Internship.deadline)
                .join(SavedInternship, SavedInternship.internship_id == Internship.id)
                .where(SavedInternship.student_id == user.id)
            )
        )
    ).all()
    student_skills = [skill.strip() for skill in (student_profile.skills if student_profile else "").split(",") if skill.strip()]
    required_skill_roles: dict[str, set[int]] = {}
    matched_skill_roles: dict[str, set[int]] = {}
    skill_display: dict[str, str] = {}
    for internship_id, _, skills, _, _, _ in role_rows:
        match = compute_match(
            student_skills,
            resume_text,
            "",
            "",
            [skill.strip() for skill in (skills or "").split(",") if skill.strip()],
        )
        for skill in match["matched_skills"] + match["missing_skills"]:
            key = skill.casefold()
            skill_display.setdefault(key, skill)
            required_skill_roles.setdefault(key, set()).add(internship_id)
        for skill in match["matched_skills"]:
            matched_skill_roles.setdefault(skill.casefold(), set()).add(internship_id)
    skill_gap = []
    for key in sorted(required_skill_roles, key=lambda item: (-len(required_skill_roles[item]), item))[:8]:
        role_count = len(required_skill_roles[key])
        matched_count = len(matched_skill_roles.get(key, set()))
        skill_gap.append({
            "name": skill_display[key],
            "count": role_count,
            "have": matched_count,
            "missing": role_count - matched_count,
        })

    activity_by_day: dict[str, dict[str, int]] = {}
    application_days_query = (
        select(func.date(Application.created_at), func.count(Application.id))
        .where(Application.student_id == user.id)
        .group_by(func.date(Application.created_at))
    )
    if cutoff is not None:
        application_days_query = application_days_query.where(Application.created_at >= cutoff)
    application_days = (await db.execute(application_days_query)).all()
    for day, count in application_days:
        activity_by_day.setdefault(str(day), {"applications": 0, "interviews": 0})
        activity_by_day[str(day)]["applications"] = int(count)
    interview_days_query = (
        select(func.date(Interview.scheduled_at), func.count(Interview.id))
        .join(Application, Application.id == Interview.application_id)
        .where(Application.student_id == user.id)
        .group_by(func.date(Interview.scheduled_at))
    )
    if cutoff is not None:
        interview_days_query = interview_days_query.where(Interview.scheduled_at >= cutoff)
    interview_days = (await db.execute(interview_days_query)).all()
    for day, count in interview_days:
        activity_by_day.setdefault(str(day), {"applications": 0, "interviews": 0})
        activity_by_day[str(day)]["interviews"] = int(count)
    activity_calendar = [
        {
            "name": day,
            "date": day,
            **counts,
            "count": counts["applications"] + counts["interviews"],
        }
        for day, counts in sorted(activity_by_day.items())
    ]

    company_status_rows = (
        await db.execute(
            select(CompanyProfile.company_name, Application.status, func.count(Application.id))
            .join(Internship, Internship.company_id == CompanyProfile.user_id)
            .join(Application, Application.internship_id == Internship.id)
            .where(Application.student_id == user.id)
            .group_by(CompanyProfile.company_name, Application.status)
        )
    ).all()
    company_rows: dict[str, dict[str, int | str]] = {}
    for company_name, app_status, count in company_status_rows:
        name = company_name or "Company"
        row = company_rows.setdefault(name, {"name": name, "count": 0})
        row[str(app_status).lower()] = int(count)
        row["count"] = int(row["count"]) + int(count)
    top_companies = sorted(
        company_rows.values(),
        key=lambda row: (-int(row["count"]), str(row["name"]).casefold()),
    )[:8]

    stipend_buckets = {"Unpaid": 0, "$1–$1,000": 0, "$1,001–$3,000": 0, "$3,001+": 0}
    duration_buckets: dict[str, int] = {}
    stipend_sample_size = 0
    for _, _, _, stipend, duration, _ in role_rows:
        if stipend is None or stipend == 0:
            if stipend == 0:
                stipend_buckets["Unpaid"] += 1
        else:
            stipend_sample_size += 1
            bucket = "$1–$1,000" if stipend <= 1000 else "$1,001–$3,000" if stipend <= 3000 else "$3,001+"
            stipend_buckets[bucket] += 1
        duration_buckets[str(duration)] = duration_buckets.get(str(duration), 0) + 1
    compensation_distribution = [
        {"name": bucket, "count": count}
        for bucket, count in stipend_buckets.items()
        if count > 0
    ] if stipend_sample_size >= 5 else []
    duration_distribution = [
        {"name": f"{months} months", "count": count}
        for months, count in sorted(duration_buckets.items(), key=lambda item: int(item[0]))
    ]

    deadline_query = (
        select(Internship.id, Internship.title, Internship.deadline)
        .join(SavedInternship, SavedInternship.internship_id == Internship.id)
        .where(
            SavedInternship.student_id == user.id,
            Internship.status == "PUBLISHED",
            Internship.deadline >= date.today(),
        )
        .order_by(Internship.deadline, Internship.id)
        .limit(8)
    )
    upcoming_deadlines = [
        {
            "name": title,
            "count": 1,
            "date": deadline.isoformat(),
            "url": f"/internships/{internship_id}",
            "internship_id": internship_id,
        }
        for internship_id, title, deadline in (await db.execute(deadline_query)).all()
    ]
    stipend_distribution = compensation_distribution
    data["charts"] = {
        **data.get("charts", {}),
        "status_over_time": status_over_time,
        "response_times": response_times,
        "skill_gap": skill_gap,
        "activity_calendar": activity_calendar,
        "top_companies": top_companies,
        "stipend_distribution": stipend_distribution,
        "stipend_duration": stipend_distribution,
        "duration_distribution": duration_distribution,
        "upcoming_deadlines": upcoming_deadlines,
    }
    data["chart_samples"] = {
        "status_over_time": sum(row["count"] for row in status_over_time),
        "response_times": len(response_times),
        "skill_gap": len(role_rows),
        "activity_calendar": sum(row["count"] for row in activity_calendar),
        "top_companies": total,
        "stipend_distribution": stipend_sample_size,
        "duration_distribution": len(role_rows),
        "upcoming_deadlines": len(upcoming_deadlines),
    }
    return data


@router.get("/analytics/dashboard")
async def dashboard_analytics(
    db: DbSession,
    user: dashboard_user,
    response: Response,
    range_value: str = Query("30", alias="range", pattern="^(7|30|90|all)$"),
) -> dict[str, Any]:
    """Return company- or admin-scoped application series for the shared chart card."""
    response.headers["Cache-Control"] = "no-store"
    data = await _chart_series(db, user, range_value)
    if user.role == UserRole.COMPANY:
        data["company_id"] = user.id
    else:
        data["company_id"] = None
    return data


@router.get("/companies/me/insights")
async def company_insights(
    db: DbSession,
    response: Response,
    user: User = Depends(require_roles(UserRole.COMPANY)),# type: ignore
    range_value: str = Query("30", alias="range", pattern="^(7|30|90|all)$"),
    internship_id: int | None = Query(None, ge=1),
) -> dict[str, Any]:
    """Return aggregate analytics for the signed-in company's own roles and applicants."""
    response.headers["Cache-Control"] = "no-store"
    if internship_id is not None:
        owned_role = await db.scalar(
            select(Internship.id).where(
                Internship.id == internship_id,
                Internship.company_id == user.id,
            )
        )
        if owned_role is None:
            raise HTTPException(404, "Internship not found")

    role_scope = [Internship.company_id == user.id]
    if internship_id is not None:
        role_scope.append(Internship.id == internship_id)
    total_roles = int(await db.scalar(select(func.count(Internship.id)).where(*role_scope)) or 0)
    active_roles = int(await db.scalar(
        select(func.count(Internship.id)).where(
            *role_scope,
            Internship.status.in_(ACTIVE_ROLE_STATUSES),
        )
    ) or 0)

    cutoff = _cutoff(range_value)
    status_query = (
        select(Application.status, func.count(Application.id))
        .join(Internship, Internship.id == Application.internship_id)
        .where(*role_scope)
    )
    if cutoff is not None:
        status_query = status_query.where(Application.created_at >= cutoff)
    status_rows = (await db.execute(status_query.group_by(Application.status))).all()
    status_counts = {str(status): int(count) for status, count in status_rows}
    total_applications = sum(status_counts.values())
    role_counts_query = (
        select(
            Internship.id,
            Internship.title,
            func.count(Application.id).label("count"),
            func.sum(case((Application.status == "APPLIED", 1), else_=0)).label("applied"),
            func.sum(case((Application.status == "UNDER_REVIEW", 1), else_=0)).label("under_review"),
            func.sum(case((Application.status == "SHORTLISTED", 1), else_=0)).label("shortlisted"),
            func.sum(case((Application.status == "INTERVIEW_SCHEDULED", 1), else_=0)).label("interview"),
            func.sum(case((Application.status.in_(OFFER_STATUSES), 1), else_=0)).label("selected"),
            func.sum(case((Application.status == "ACCEPTED", 1), else_=0)).label("accepted"),
        )
        .outerjoin(Application, Application.internship_id == Internship.id)
        .where(*role_scope)
    )
    if cutoff is not None:
        role_counts_query = role_counts_query.where(
            (Application.created_at >= cutoff) | (Application.id.is_(None))
        )
    applicants_by_role_rows = (await db.execute(
        role_counts_query.group_by(Internship.id, Internship.title)
        .order_by(func.count(Application.id).desc(), Internship.title)
    )).all()
    active_interviews_by_role_query = (
        select(Internship.id, func.count(func.distinct(Application.id)))
        .join(Application, Application.internship_id == Internship.id)
        .join(Interview, Interview.application_id == Application.id)
        .where(
            *role_scope,
            Interview.status.in_(("SCHEDULED", "RESCHEDULED")),
        )
    )
    if cutoff is not None:
        active_interviews_by_role_query = active_interviews_by_role_query.where(
            Application.created_at >= cutoff
        )
    active_interviews_by_role = {
        int(role_id): int(count or 0)
        for role_id, count in (await db.execute(
            active_interviews_by_role_query.group_by(Internship.id)
        )).all()
    }
    trend_query = (
        select(func.date(Application.created_at), func.count(Application.id))
        .join(Internship, Internship.id == Application.internship_id)
        .where(*role_scope)
    )
    if cutoff is not None:
        trend_query = trend_query.where(Application.created_at >= cutoff)
    trend_rows = (await db.execute(
        trend_query.group_by(func.date(Application.created_at)).order_by(func.date(Application.created_at))
    )).all()

    response_query = (
        select(
            ApplicationEvent.application_id,
            func.min(ApplicationEvent.created_at),
            Application.created_at,
        )
        .join(Application, Application.id == ApplicationEvent.application_id)
        .join(Internship, Internship.id == Application.internship_id)
        .where(
            *role_scope,
            ApplicationEvent.event_type != "APPLIED",
            ApplicationEvent.actor_id == user.id,
        )
        .group_by(ApplicationEvent.application_id, Application.created_at)
    )
    if cutoff is not None:
        response_query = response_query.where(Application.created_at >= cutoff)
    response_rows = (await db.execute(response_query)).all()
    response_hours: list[float] = []
    for _, first_response, applied_at in response_rows:
        if first_response.tzinfo is None:
            first_response = first_response.replace(tzinfo=timezone.utc)
        if applied_at.tzinfo is None:
            applied_at = applied_at.replace(tzinfo=timezone.utc)
        response_hours.append(max(0.0, (first_response - applied_at).total_seconds() / 3600))

    interviews_query = (
        select(Interview.status, func.count(Interview.id))
        .join(Application, Application.id == Interview.application_id)
        .join(Internship, Internship.id == Application.internship_id)
        .where(*role_scope)
    )
    if cutoff is not None:
        interviews_query = interviews_query.where(Interview.scheduled_at >= cutoff)
    interviews = (await db.execute(interviews_query.group_by(Interview.status))).all()
    interview_counts = {str(status).upper(): int(count) for status, count in interviews}
    upcoming_interviews = int(
        await db.scalar(
            select(func.count(Interview.id))
            .join(Application, Application.id == Interview.application_id)
            .join(Internship, Internship.id == Application.internship_id)
            .where(
                *role_scope,
                Interview.status.in_(("SCHEDULED", "RESCHEDULED")),
                Interview.scheduled_at > datetime.now(timezone.utc),
            )
        )
        or 0
    )
    skills_query = (
        select(StudentProfile.user_id, StudentProfile.skills)
        .join(Application, Application.student_id == StudentProfile.user_id)
        .join(Internship, Internship.id == Application.internship_id)
        .where(*role_scope)
    )
    if cutoff is not None:
        skills_query = skills_query.where(Application.created_at >= cutoff)
    skills_rows = (await db.execute(skills_query)).all()
    skill_applicants: dict[str, set[int]] = {}
    for student_id, skills in skills_rows:
        for skill in {item.strip() for item in (skills or "").split(",") if item.strip()}:
            skill_applicants.setdefault(skill, set()).add(student_id)
    top_skills = [
        {"name": name, "count": len(student_ids)}
        for name, student_ids in sorted(
            skill_applicants.items(),
            key=lambda item: (-len(item[1]), item[0].casefold()),
        )[:10]
    ]
    domains_query = (
        select(Internship.industry, func.count(Internship.id))
        .where(*role_scope)
    )
    if cutoff is not None:
        domains_query = domains_query.where(Internship.created_at >= cutoff)
    domain_rows = (await db.execute(
        domains_query.group_by(Internship.industry)
        .order_by(func.count(Internship.id).desc(), Internship.industry)
    )).all()
    university_query = (
        select(StudentProfile.university, func.count(Application.id))
        .join(Application, Application.student_id == StudentProfile.user_id)
        .join(Internship, Internship.id == Application.internship_id)
        .where(*role_scope)
    )
    if cutoff is not None:
        university_query = university_query.where(Application.created_at >= cutoff)
    university_rows = (await db.execute(
        university_query.group_by(StudentProfile.university)
        .order_by(func.count(Application.id).desc(), StudentProfile.university)
        .limit(5)
    )).all()
    shortlisted = status_counts.get("SHORTLISTED", 0)
    offers = status_counts.get("SELECTED", 0) + status_counts.get("ACCEPTED", 0)
    interview_conversion_count = sum(active_interviews_by_role.values())
    accepted_offers = status_counts.get("ACCEPTED", 0)
    response_sample = len(response_hours)
    response_mean = round(sum(response_hours) / response_sample, 1) if response_sample else None

    return {
        "role": "company",
        "range": range_value,
        "sample_size": total_applications,
        "period_label": f"Last {range_value} days" if range_value != "all" else "All time",
        "status_breakdown": [
            {"status": status, "count": count}
            for status, count in sorted(status_counts.items())
        ],
        "kpis": {
            "active_roles": {"value": active_roles, "sample_size": total_roles, "definition": "Count of this company's PUBLISHED internships."},
            "total_applicants": {"value": total_applications, "sample_size": total_applications, "definition": "Count of applications submitted to this company's internships."},
            "shortlisted": {"value": shortlisted, "sample_size": total_applications, "definition": "Applications currently SHORTLISTED."},
            "interviews_scheduled": {"value": upcoming_interviews, "sample_size": upcoming_interviews, "definition": "Future interviews currently scheduled or rescheduled across company applications."},
            "offers": {"value": offers, "sample_size": total_applications, "definition": "Applications currently SELECTED or ACCEPTED."},
            "average_response_time": {"value": response_mean, "sample_size": response_sample, "definition": "Mean hours from application to the first company-authored application event."},
            "shortlist_rate": {
                "value": round(shortlisted * 100 / total_applications, 1) if total_applications >= 5 else None,
                "sample_size": total_applications,
                "numerator": shortlisted,
                "denominator": total_applications,
                "definition": "Applications currently SHORTLISTED divided by applications in the selected range and internship filter.",
            },
            "interview_conversion": {
                "value": round(interview_conversion_count * 100 / total_applications, 1) if total_applications >= 5 else None,
                "sample_size": total_applications,
                "numerator": interview_conversion_count,
                "denominator": total_applications,
                "definition": "Applications currently in INTERVIEW_SCHEDULED divided by applications in the selected range and internship filter.",
            },
            "hires": {
                "value": offers,
                "sample_size": total_applications,
                "definition": "Applications currently SELECTED or ACCEPTED.",
            },
            "offer_acceptance_rate": {
                "value": round(accepted_offers * 100 / offers, 1) if offers >= 5 else None,
                "sample_size": offers,
                "numerator": accepted_offers,
                "denominator": offers,
                "definition": "ACCEPTED applications divided by SELECTED and ACCEPTED applications.",
            },
        },
        "charts": {
            "company_pipeline": [
                {"name": "Applied", "count": total_applications, "conversion_pct": None},
                {"name": "Under review", "count": status_counts.get("UNDER_REVIEW", 0), "conversion_pct": round(status_counts.get("UNDER_REVIEW", 0) * 100 / total_applications, 1) if total_applications else None},
                {"name": "Shortlisted", "count": shortlisted, "conversion_pct": round(shortlisted * 100 / total_applications, 1) if total_applications else None},
                {"name": "Interview", "count": interview_conversion_count, "conversion_pct": round(interview_conversion_count * 100 / total_applications, 1) if total_applications else None},
                {"name": "Selected", "count": offers, "conversion_pct": round(offers * 100 / total_applications, 1) if total_applications else None},
            ],
            "applicants_by_posting": [
                {"id": int(role_id), "name": title, "count": int(count or 0)}
                for role_id, title, count, *_ in applicants_by_role_rows
            ],
            "conversion_by_role": [
                {
                    "name": title,
                    "count": int(count or 0),
                    "applied": int(applied or 0),
                    "under_review": int(under_review or 0),
                    "shortlisted": int(shortlisted_count or 0),
                    "interview_scheduled": active_interviews_by_role.get(int(role_id), 0),
                    "selected": int(selected or 0),
                    "accepted": int(accepted or 0),
                }
                for role_id, title, count, applied, under_review, shortlisted_count, interview, selected, accepted
                in applicants_by_role_rows
            ],
            "applications_over_time": [{"name": str(day), "date": str(day), "count": int(count)} for day, count in trend_rows],
            "top_skills": top_skills,
            "domains": normalize_domain_rows(domain_rows),# type: ignore
            "top_universities": [{"name": university or "Unspecified", "count": int(count)} for university, count in university_rows],
            "interview_outcomes": [
                {"name": "Scheduled", "count": interview_counts.get("SCHEDULED", 0) + interview_counts.get("RESCHEDULED", 0)},
                {"name": "Completed", "count": interview_counts.get("COMPLETED", 0)},
                {"name": "Cancelled", "count": interview_counts.get("CANCELLED", 0)},
            ],
        },
        "internships": [
            {"id": int(role_id), "title": title}
            for role_id, title, *_ in applicants_by_role_rows
        ],
    }


@router.get("/admin/insights")
async def admin_insights(
    db: DbSession,
    response: Response,
    user: User = Depends(require_roles(UserRole.ADMIN)),# type: ignore
    range_value: str = Query("30", alias="range", pattern="^(7|30|90|all)$"),
) -> dict[str, Any]:
    """Return global administrative aggregates for the authenticated administrator."""
    response.headers["Cache-Control"] = "no-store"
    now = datetime.now(timezone.utc)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    range_cutoff = _cutoff(range_value)
    current_month_users = select(func.count(User.id)).where(User.created_at >= month_start)
    total_signups = int(await db.scalar(current_month_users) or 0)
    student_signups = int(await db.scalar(
        select(func.count(User.id)).where(User.created_at >= month_start, User.role == UserRole.STUDENT)
    ) or 0)
    company_signups = int(await db.scalar(
        select(func.count(User.id)).where(User.created_at >= month_start, User.role == UserRole.COMPANY)
    ) or 0)
    action_query = select(AuditLog.action, func.count(AuditLog.id))
    if range_cutoff is not None:
        action_query = action_query.where(AuditLog.created_at >= range_cutoff)
    action_rows = (await db.execute(
        action_query
        .group_by(AuditLog.action)
        .order_by(func.count(AuditLog.id).desc(), AuditLog.action)
    )).all()
    total_actions = sum(int(count) for _, count in action_rows)
    pending_verifications = int(await db.scalar(
        select(func.count(CompanyProfile.id)).where(CompanyProfile.verification_status == "PENDING")
    ) or 0)
    pending_jobs = int(await db.scalar(
        select(func.count(Internship.id)).where(Internship.status == "PENDING_APPROVAL")
    ) or 0)
    open_disputes = int(await db.scalar(
        select(func.count(Report.id)).where(Report.status == "OPEN")
    ) or 0)

    signups_query = select(
        func.date(User.created_at), User.role, func.count(User.id)
    )
    applications_query = select(
        func.date(Application.created_at), func.count(Application.id)
    )
    if range_cutoff is not None:
        signups_query = signups_query.where(User.created_at >= range_cutoff)
        applications_query = applications_query.where(Application.created_at >= range_cutoff)
    signups = (await db.execute(
        signups_query.group_by(func.date(User.created_at), User.role)
        .order_by(func.date(User.created_at), User.role)
    )).all()
    applications = (await db.execute(
        applications_query.group_by(func.date(Application.created_at))
        .order_by(func.date(Application.created_at))
    )).all()
    internship_status_rows = (await db.execute(
        select(Internship.status, func.count(Internship.id)).group_by(Internship.status)
    )).all()
    verification_rows = (await db.execute(
        select(CompanyProfile.verification_status, func.count(CompanyProfile.id))
        .group_by(CompanyProfile.verification_status)
    )).all()
    domain_rows = (await db.execute(
        select(Internship.industry, func.count(Internship.id))
        .group_by(Internship.industry)
        .order_by(func.count(Internship.id).desc(), Internship.industry)
    )).all()
    signup_buckets: dict[str, dict[str, int]] = {}
    for day, role, count in signups:
        bucket = signup_buckets.setdefault(str(day), {"students": 0, "companies": 0})
        role_name = role.value if isinstance(role, UserRole) else str(role)
        if role_name == UserRole.STUDENT.value:# type: ignore
            bucket["students"] = int(count)
        elif role_name == UserRole.COMPANY.value:# type: ignore
            bucket["companies"] = int(count)
    return {
        "role": "admin",
        "range": range_value,
        "sample_size": total_signups,
        "period_label": now.strftime("This month (%b %Y)"),
        "kpis": {
            "users_signed_up": {"value": total_signups, "sample_size": total_signups, "definition": "All user accounts created since the start of the current UTC month."},
            "student_signups": {"value": student_signups, "sample_size": student_signups, "definition": "Student accounts created since the start of the current UTC month."},
            "company_signups": {"value": company_signups, "sample_size": company_signups, "definition": "Company accounts created since the start of the current UTC month."},
            "admin_actions": {"value": total_actions, "sample_size": total_actions, "definition": "Audit log records created in the selected reporting range."},
            "pending_verifications": {"value": pending_verifications, "sample_size": pending_verifications, "definition": "Company profiles currently awaiting verification."},
            "job_queue": {"value": pending_jobs, "sample_size": pending_jobs, "definition": "Internships currently awaiting moderation."},
            "disputes": {"value": open_disputes, "sample_size": open_disputes, "definition": "Reports currently open."},
        },
        "charts": {
            "signups_over_time": [{"name": day, "date": day, **counts} for day, counts in sorted(signup_buckets.items())],
            "admin_applications_over_time": [{"name": str(day), "date": str(day), "count": int(count)} for day, count in applications],
            "internships_by_status": [{"name": str(status).replace("_", " ").title(), "count": int(count)} for status, count in internship_status_rows],
            "admin_actions_by_type": [
                {"name": audit_action_label(str(action)), "count": int(count), "action": str(action)}
                for action, count in action_rows
            ],
            "verification_status": [{"name": str(status).title(), "count": int(count)} for status, count in verification_rows],
            "top_domains": normalize_domain_rows(domain_rows),# type: ignore
        },
    }
