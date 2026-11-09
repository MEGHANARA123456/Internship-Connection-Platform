"""Bounded read-only data tools with per-role ownership checks."""

import asyncio
import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Any

from fastapi import HTTPException
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Application,
    AuditLog,
    ChatbotLowConfidenceLog,
    CompanyProfile,
    Interview,
    Internship,
    Message,
    Notification,
    Report,
    Resume,
    Conversation,
    SkillAttempt,
    SkillBadge,
    SkillQuestion,
    SkillTopic,
    SavedInternship,
    StudentProfile,
    User,
    UserRole,
)
from app.services.audit import audit_action_label
from app.services.company_metrics import get_company_metrics
from app.services.interview_display import (
    get_interview_state,
)

TOOL_ROLES = {
    "student_applications": UserRole.STUDENT,
    "student_interviews": UserRole.STUDENT,
    "student_notifications": UserRole.STUDENT,
    "student_profile_completeness": UserRole.STUDENT,
    "student_saved_internships": UserRole.STUDENT,
    "student_recommended_internships": UserRole.STUDENT,
    "student_skill_assessments": UserRole.STUDENT,
    "student_unread_messages": UserRole.STUDENT,
    "student_skills_improvement": UserRole.STUDENT,
    "student_skill_retake": UserRole.STUDENT,
    "company_applicants": UserRole.COMPANY,
    "company_shortlisted": UserRole.COMPANY,
    "company_pipeline": UserRole.COMPANY,
    "company_internships": UserRole.COMPANY,
    "company_interviews": UserRole.COMPANY,
    "company_unread_messages": UserRole.COMPANY,
    "company_verification_status": UserRole.COMPANY,
    "admin_audit_events": UserRole.ADMIN,
    "admin_pending_approvals": UserRole.ADMIN,
    "admin_verification_counts": UserRole.ADMIN,
    "admin_analytics": UserRole.ADMIN,
    "admin_skill_assessment_stats": UserRole.ADMIN,
    "admin_open_reports": UserRole.ADMIN,
    "admin_company_counts": UserRole.ADMIN,
    "admin_student_counts": UserRole.ADMIN,
    "admin_posting_counts": UserRole.ADMIN,
    "admin_today_activity": UserRole.ADMIN,
    "admin_recent_registrations": UserRole.ADMIN,
    "admin_recent_posting_changes": UserRole.ADMIN,
    "admin_recent_posting_deletions": UserRole.ADMIN,
    "admin_security_events": UserRole.ADMIN,
    "admin_company_and_posting_counts": UserRole.ADMIN,
    "admin_chatbot_low_confidence_questions": UserRole.ADMIN,
    "public_open_internships_count": None,
}
TOOL_TIMEOUT_SECONDS = 4
MAX_ROWS = 5


@dataclass(frozen=True)
class ToolResult:
    """Represent a read-only tool answer and the route/link destinations it supports."""

    name: str
    answer: str
    route: str
    links: tuple[tuple[str, str], ...] = ()


def _validated_args(name: str, args: dict[str, Any]) -> int | None:
    """Reject unsupported inputs and return a valid optional company internship ID."""
    if set(args) - {"internship_id"}:
        raise HTTPException(status_code=422, detail="Unsupported tool arguments.")
    if name not in {"company_applicants", "company_shortlisted", "company_internships"}:
        if args:
            raise HTTPException(status_code=422, detail="This tool does not accept arguments.")
        return None
    value = args.get("internship_id")
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= 2_147_483_647:
        raise HTTPException(status_code=422, detail="Invalid internship identifier.")
    return value


def _when(value) -> str:
    """Format database dates consistently in UTC, including naive datetime values."""
    if value is None:
        return "date not recorded"
    if isinstance(value, date) and not isinstance(value, datetime):
        return value.strftime("%b %d, %Y")
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).strftime("%b %d, %Y")


async def _student_applications(db: AsyncSession, user: User) -> ToolResult:
    """Return a status breakdown for only the authenticated student's applications."""
    rows = (await db.execute(
        select(Application.status, func.count(Application.id))
        .where(Application.student_id == user.id)
        .group_by(Application.status)
    )).all()
    counts = {str(status).upper(): int(count) for status, count in rows}
    total = sum(counts.values())
    status_groups = (
        ("Applied", ("APPLIED",)),
        ("Under review", ("UNDER_REVIEW",)),
        ("Shortlisted", ("SHORTLISTED",)),
        ("Interview", ("INTERVIEW_SCHEDULED",)),
        ("Offer", ("SELECTED", "ACCEPTED")),
        ("Rejected", ("REJECTED",)),
        ("Withdrawn", ("WITHDRAWN",)),
    )
    breakdown = [
        f"{label}: {sum(counts.get(status, 0) for status in statuses)}"
        for label, statuses in status_groups
    ]
    known_statuses = {status for _, statuses in status_groups for status in statuses}
    other_count = sum(count for status, count in counts.items() if status not in known_statuses)
    if other_count:
        breakdown.append(f"Other: {other_count}")
    answer = (
        "You have no application records yet."
        if not total
        else f"You have {total} application(s). " + ", ".join(breakdown) + "."
    )
    return ToolResult("student_applications", answer, "/applications")


async def _student_interviews(db: AsyncSession, user: User) -> ToolResult:
    """List this student's next three interviews, or the latest completed one if none are upcoming."""
    rows = (await db.execute(
        select(Interview, Internship.title)
        .join(Application, Application.id == Interview.application_id)
        .join(Internship, Internship.id == Application.internship_id)
        .where(
            # Join through the student's own application to prevent cross-account access.
            Application.student_id == user.id,
            Interview.status.in_(("SCHEDULED", "RESCHEDULED", "COMPLETED")),
        )
        .order_by(Interview.scheduled_at.desc(), Interview.id.desc())
        .limit(50)
    )).all()
    upcoming = [
        (interview, title) for interview, title in rows
        if interview.status in {"SCHEDULED", "RESCHEDULED"}
        and get_interview_state(interview) == "upcoming"
    ]
    if upcoming:
        selected = sorted(upcoming, key=lambda row: (row[0].scheduled_at, row[0].id))[:3]
        answer = "Your next interviews: " + " ".join(
            f"{title}: scheduled for {_when(interview.scheduled_at)}."
            for interview, title in selected
        )
        if len(upcoming) > len(selected):
            answer += f" +{len(upcoming) - len(selected)} more."
    else:
        past = [
            (interview, title) for interview, title in rows
            if get_interview_state(interview) == "completed"
        ]
        answer = (
            "You have no upcoming interviews scheduled."
            if not past
            else f"You have no upcoming interviews. Your latest past interview was for {past[0][1]} on "
            f"{_when(past[0][0].scheduled_at)}."
        )
    return ToolResult("student_interviews", answer, "/interviews")


async def _student_notifications(db: AsyncSession, user: User) -> ToolResult:
    """Count only the authenticated student's notifications and unread notifications."""
    total = int(await db.scalar(
        select(func.count(Notification.id)).where(Notification.user_id == user.id)
    ) or 0)
    unread = int(await db.scalar(
        select(func.count(Notification.id)).where(
            Notification.user_id == user.id,
            Notification.read_at.is_(None),
        )
    ) or 0)
    answer = f"You have {total} notification(s), including {unread} unread."
    return ToolResult("student_notifications", answer, "/notifications")


async def _student_unread_messages(db: AsyncSession, user: User) -> ToolResult:
    """Count unread incoming messages in conversations owned by this student."""
    count = int(await db.scalar(
        select(func.count(Message.id))
        .join(Conversation, Conversation.id == Message.conversation_id)
        .where(
            Conversation.student_id == user.id,
            Message.sender_id != user.id,
            Message.read_at.is_(None),
        )
    ) or 0)
    return ToolResult(
        "student_unread_messages",
        f"You have {count} unread message(s).",
        "/messages",
    )


async def _student_profile(db: AsyncSession, user: User) -> ToolResult:
    """Report which core profile fields and resume are missing for this student."""
    profile = await db.scalar(select(StudentProfile).where(StudentProfile.user_id == user.id))
    resume = await db.scalar(select(Resume.id).where(Resume.student_id == user.id))
    if profile is None:
        return ToolResult(
            "student_profile_completeness",
            "Your student profile has not been created yet. Open your profile to complete it.",
            "/profile/student",
        )
    missing = [
        label for value, label in (
            (profile.full_name, "name"),
            (profile.university, "university"),
            (profile.major, "major"),
            (profile.graduation_year, "graduation year"),
            (profile.skills, "skills"),
        ) if not value
    ]
    if not resume:
        missing.append("resume")
    answer = (
        "Your profile has no missing core fields."
        if not missing
        else "Your profile is missing: " + ", ".join(missing) + "."
    )
    return ToolResult("student_profile_completeness", answer, "/profile/student")


async def _student_saved_internships(db: AsyncSession, user: User) -> ToolResult:
    """List this student's recently saved internships and provide detail links."""
    total = int(await db.scalar(
        select(func.count(SavedInternship.id)).where(SavedInternship.student_id == user.id)
    ) or 0)
    rows = (await db.execute(
        select(Internship.title, Internship.id, CompanyProfile.company_name)
        .join(SavedInternship, SavedInternship.internship_id == Internship.id)
        .outerjoin(CompanyProfile, CompanyProfile.user_id == Internship.company_id)
        .where(
            SavedInternship.student_id == user.id,
        )
        .order_by(SavedInternship.created_at.desc(), SavedInternship.id.desc())
        .limit(MAX_ROWS)
    )).all()
    answer = f"You have {total} saved internship(s)."
    if rows:
        answer += " Recently saved: " + " ".join(
            f"{title} at {company or 'company name unavailable'}."
            for title, _, company in rows
        )
    if total > len(rows):
        answer += f" +{total - len(rows)} more."
    links = tuple((title, f"/opportunities/{internship_id}") for title, internship_id, _ in rows)
    return ToolResult("student_saved_internships", answer, "/saved", links)


async def _student_skill_assessments(db: AsyncSession, user: User) -> ToolResult:
    """Summarize only the authenticated student's attempts and current verified badges."""
    attempts = (await db.execute(
        select(SkillAttempt.topic, SkillAttempt.status, SkillAttempt.score, SkillAttempt.passed)
        .where(SkillAttempt.student_id == user.id)
        .order_by(SkillAttempt.started_at.desc(), SkillAttempt.id.desc())
        .limit(MAX_ROWS)
    )).all()
    attempt_count = int(await db.scalar(
        select(func.count(SkillAttempt.id)).where(SkillAttempt.student_id == user.id)
    ) or 0)
    completed_count = int(await db.scalar(
        select(func.count(SkillAttempt.id)).where(
            SkillAttempt.student_id == user.id,
            SkillAttempt.status == "COMPLETED",
        )
    ) or 0)
    passed_count = int(await db.scalar(
        select(func.count(SkillAttempt.id)).where(
            SkillAttempt.student_id == user.id,
            SkillAttempt.passed.is_(True),
        )
    ) or 0)
    now = datetime.now(timezone.utc)
    badge_rows = (await db.execute(
        select(SkillBadge.title, SkillBadge.expires_at)
        .where(SkillBadge.student_id == user.id, SkillBadge.expires_at > now)
        .order_by(SkillBadge.expires_at.asc(), SkillBadge.id.asc())
        .limit(MAX_ROWS)
    )).all()
    badge_count = int(await db.scalar(
        select(func.count(SkillBadge.id)).where(
            SkillBadge.student_id == user.id,
            SkillBadge.expires_at > now,
        )
    ) or 0)
    answer = (
        f"You have {attempt_count} assessment attempts, {completed_count} completed, and "
        f"{passed_count} passed, and {badge_count} current verified skill badge(s)."
    )
    if attempts:
        answer += " Recent attempts: " + " ".join(
            f"{topic}: {status.replace('_', ' ').lower()}"
            + (f", {score}% {'passed' if passed else 'not passed'}" if score is not None else "")
            + "."
            for topic, status, score, passed in attempts
        )
        if attempt_count > len(attempts):
            answer += f" +{attempt_count - len(attempts)} more attempts."
    if badge_rows:
        answer += " Badges: " + ", ".join(
            f"{title} (expires {_when(expires_at)})"
            for title, expires_at in badge_rows
        )
        if badge_count > len(badge_rows):
            answer += f" +{badge_count - len(badge_rows)} more."
    return ToolResult("student_skill_assessments", answer, "/skills/history")


async def _student_skills_improvement(db: AsyncSession, user: User) -> ToolResult:
    """Compare the student's own profile skills and assessment outcomes with ready topics."""
    profile = await db.scalar(
        select(StudentProfile).where(StudentProfile.user_id == user.id)
    )
    skills = [
        item.strip()
        for item in re.split(r"[,;\n]", profile.skills or "")
        if item.strip()
    ] if profile else []
    topic_rows = (await db.execute(
        select(SkillTopic.slug, SkillTopic.name)
        .where(SkillTopic.archived_at.is_(None))
        .order_by(SkillTopic.name, SkillTopic.slug)
    )).all()
    question_rows = (await db.execute(
        select(SkillQuestion.topic, SkillQuestion.difficulty, func.count(SkillQuestion.id))
        .where(SkillQuestion.active.is_(True))
        .group_by(SkillQuestion.topic, SkillQuestion.difficulty)
    )).all()
    question_counts: dict[str, dict[str, int]] = {}
    for topic, difficulty, count in question_rows:
        if isinstance(topic, str) and isinstance(difficulty, str):
            question_counts.setdefault(topic, {})[difficulty.upper()] = int(count or 0)
    ready_topics = {
        slug: name
        for slug, name in topic_rows
        if all(
            question_counts.get(slug, {}).get(level, 0) >= needed
            for level, needed in (("EASY", 4), ("MEDIUM", 4), ("HARD", 2))
        )
    }

    latest_attempts: dict[str, tuple[str, int | None, bool | None]] = {}
    attempts = (await db.execute(
        select(SkillAttempt.topic, SkillAttempt.status, SkillAttempt.score, SkillAttempt.passed)
        .where(SkillAttempt.student_id == user.id)
        .order_by(SkillAttempt.started_at.desc(), SkillAttempt.id.desc())
    )).all()
    for topic, status, score, passed in attempts:
        latest_attempts.setdefault(topic, (status, score, passed))

    weak_topics = []
    for topic, name in ready_topics.items():
        attempt = latest_attempts.get(topic)
        if attempt is None:
            weak_topics.append((101, f"{name} (not attempted yet)"))
            continue
        status, score, passed = attempt
        if status == "EXPIRED":
            weak_topics.append((100, f"{name} (latest attempt expired)"))
        elif passed is False:
            weak_topics.append((score if score is not None else 0, f"{name} (latest score {score if score is not None else 'not recorded'}%)"))
    weak_topics.sort(key=lambda item: (item[0], item[1]))
    skills_text = ", ".join(dict.fromkeys(skills)) if skills else "No profile skills are listed yet"
    improvement_text = (
        ", ".join(topic for _, topic in weak_topics[:3])
        if weak_topics
        else "no failed, expired, or unattempted ready topics"
    )
    answer = (
        f"Your profile skills: {skills_text}. Areas to improve: {improvement_text}. "
        "Take the lowest-scoring ready topics next."
    )
    return ToolResult("student_skills_improvement", answer, "/profile/student")


async def _student_skill_retake(db: AsyncSession, user: User) -> ToolResult:
    """Explain configured retry limits and determine this student's next eligible assessment time."""
    now = datetime.now(timezone.utc)
    attempts = list((await db.scalars(
        select(SkillAttempt)
        .where(SkillAttempt.student_id == user.id)
        .order_by(SkillAttempt.started_at.desc(), SkillAttempt.id.desc())
    )).all())
    answer = (
        "You can retake a topic 24 hours after your previous attempt starts, with a maximum of 3 assessment attempts in any 7-day period."
    )
    if not attempts:
        return ToolResult(
            "student_skill_retake",
            answer + " You have no recorded attempts, so you can start an available assessment now.",
            "/profile/student",
        )

    latest = attempts[0]
    same_topic_retry = _utc_datetime(latest.started_at) + timedelta(hours=24)
    weekly_attempts = [
        attempt for attempt in attempts
        if _utc_datetime(attempt.started_at) >= now - timedelta(days=7)
    ]
    next_allowed = same_topic_retry
    reason = f"your latest {latest.status.lower()} attempt for {latest.topic}"
    if len(weekly_attempts) >= 3:
        weekly_retry = _utc_datetime(weekly_attempts[-1].started_at) + timedelta(days=7)
        if weekly_retry > next_allowed:
            next_allowed = weekly_retry
            reason = "the 3-attempt weekly limit"
    if latest.status == "EXPIRED" or latest.passed is False:
        outcome = "Your latest attempt was expired" if latest.status == "EXPIRED" else "Your latest attempt did not pass"
        answer += f" {outcome} ({latest.topic})."
    if now < next_allowed:
        answer += f" You can try again after {_when(next_allowed)} because of {reason}."
    else:
        answer += " You are currently eligible to start an available assessment."
    return ToolResult("student_skill_retake", answer, "/profile/student")


def _utc_datetime(value: datetime) -> datetime:
    """Normalize database datetimes to UTC for policy comparisons."""
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


async def _student_recommended_internships(db: AsyncSession, user: User) -> ToolResult:
    """Rank a bounded set of open internships against the student's profile skills."""
    from app.services.ai import compute_match

    profile = await db.scalar(select(StudentProfile).where(StudentProfile.user_id == user.id))
    if profile is None or not profile.skills.strip():
        return ToolResult(
            "student_recommended_internships",
            "I could not find profile skills to match yet. Add skills to your profile and try again.",
            "/profile/student",
        )

    rows = (await db.execute(
        select(Internship, CompanyProfile.company_name)
        .outerjoin(CompanyProfile, CompanyProfile.user_id == Internship.company_id)
        .where(
            Internship.status == "PUBLISHED",
            Internship.deadline >= date.today(),
        )
        .order_by(Internship.created_at.desc(), Internship.id.desc())
        # Bound the candidates scored per request to keep this read tool predictable.
        .limit(100)
    )).all()
    skills = [item.strip() for item in re.split(r"[,;\n]", profile.skills) if item.strip()]
    matches = []
    seen_internship_ids: set[int] = set()
    for internship, company_name in rows:
        if internship.id in seen_internship_ids:
            continue
        seen_internship_ids.add(internship.id)
        match = compute_match(
            skills,
            "",
            internship.title,
            internship.description,
            [item.strip() for item in re.split(r"[,;\n]", internship.skills or "") if item.strip()],
        )
        if match["score"] is not None:
            matches.append((match["score"], internship, company_name, match["matched"]))
    # Break equal scores by internship ID so the recommendations remain deterministic.
    matches.sort(key=lambda item: (-item[0], item[1].id))
    matches = matches[:5]
    answer = (
        "No open internships matched your profile skills."
        if not matches
        else "Top open internships matching your profile: " + " ".join(
            f"{internship.title} at {company_name or 'company name unavailable'} "
            f"({score}% match; skills: {', '.join(matched) if matched else 'no direct skill overlap'})."
            for score, internship, company_name, matched in matches
        )
    )
    links = tuple(
        (internship.title, f"/opportunities/{internship.id}")
        for _, internship, _, _ in matches
    )
    return ToolResult("student_recommended_internships", answer, "/opportunities", links)


async def _company_internships(db: AsyncSession, user: User, internship_id: int | None) -> ToolResult:
    """Summarize postings owned by this company, optionally filtering to one posting."""
    metrics = await get_company_metrics(db, user.id, internship_id)
    role_counts = {
        role["id"]: role["applications"]
        for role in metrics["applications_by_role"]
    }
    count_query = select(func.count(Internship.id)).where(Internship.company_id == user.id)
    if internship_id is not None:
        count_query = count_query.where(Internship.id == internship_id)
    total = int(await db.scalar(count_query) or 0)
    query = (
        select(Internship.id, Internship.title, Internship.status, Internship.deadline)
        # Ownership is enforced in the query, even when a caller supplies an ID.
        .where(Internship.company_id == user.id)
        .order_by(Internship.created_at.desc())
        .limit(MAX_ROWS)
    )
    if internship_id is not None:
        query = query.where(Internship.id == internship_id)
    rows = (await db.execute(query)).all()
    status_query = select(Internship.status, func.count(Internship.id)).where(
        Internship.company_id == user.id
    )
    if internship_id is not None:
        status_query = status_query.where(Internship.id == internship_id)
    status_rows = (await db.execute(status_query.group_by(Internship.status))).all()
    statuses = {str(status).upper(): int(count) for status, count in status_rows}
    closed = sum(statuses.get(status, 0) for status in ("CLOSED", "EXPIRED", "REJECTED"))
    expired_query = select(func.count(Internship.id)).where(
        Internship.company_id == user.id,
        Internship.status == "PUBLISHED",
        Internship.deadline < date.today(),
    )
    if internship_id is not None:
        expired_query = expired_query.where(Internship.id == internship_id)
    closed += int(await db.scalar(expired_query) or 0)
    pending = statuses.get("PENDING_APPROVAL", 0)
    other = max(0, sum(statuses.values()) - metrics["active_roles"] - pending - closed)
    answer = (
        f"Your postings: {metrics['active_roles']} active, {pending} pending approval, "
        f"{closed} closed."
    )
    if other:
        answer += f" {other} other posting(s) need attention."
    if rows:
        answer += " Recent postings: " + " ".join(
            f"{title}: {status.replace('_', ' ').title()}, {role_counts.get(role_id, 0)} applicants, "
            f"deadline {_when(deadline)}."
            for role_id, title, status, deadline in rows
        )
    if total > len(rows):
        answer += f" +{total - len(rows)} more."
    return ToolResult("company_internships", answer, "/company/jobs")


async def _company_applicants(
    db: AsyncSession,
    user: User,
    internship_id: int | None,
    shortlisted: bool = False,
) -> ToolResult:
    """Count applicants by status for this company's own postings without exposing candidate details."""
    metrics = await get_company_metrics(db, user.id, internship_id)
    if shortlisted:
        answer = f"You have {metrics['shortlisted']} shortlisted candidate(s)."
    else:
        status_counts = metrics["status_counts"]
        statuses = (
            ("Applied", ("APPLIED",)),
            ("Under review", ("UNDER_REVIEW",)),
            ("Shortlisted", ("SHORTLISTED",)),
            ("Interview", ("INTERVIEW_SCHEDULED",)),
            ("Offer", ("SELECTED", "ACCEPTED")),
            ("Rejected", ("REJECTED",)),
        )
        breakdown = ", ".join(
            f"{label}: {sum(status_counts.get(status, 0) for status in group)}"
            for label, group in statuses
        )
        answer = (
            f"You have {metrics['total_applicants']} applicants across your company's postings. "
            f"{breakdown}."
        )
        postings = metrics["applications_by_role"]
        if internship_id is not None:
            postings = [posting for posting in postings if posting["id"] == internship_id]
        if postings:
            posting_summaries = []
            for posting in postings[:MAX_ROWS]:
                posting_statuses = ", ".join(
                    f"{status.replace('_', ' ').title()} {count}"
                    for status, count in sorted(posting["status_counts"].items())
                ) or "no applications"
                posting_summaries.append(
                    f"{posting['title']}: {posting['applications']} applicants "
                    f"({posting_statuses})."
                )
            answer += " By posting: " + " ".join(posting_summaries)
        if len(postings) > MAX_ROWS:
            answer += f" +{len(postings) - MAX_ROWS} more postings."
    return ToolResult(
        "company_shortlisted" if shortlisted else "company_applicants",
        answer,
        "/company/shortlisted" if shortlisted else "/company/applicants",
    )


async def _company_pipeline(db: AsyncSession, user: User) -> ToolResult:
    """Count application records by stage for internships owned by this company."""
    metrics = await get_company_metrics(db, user.id)
    rows = sorted(metrics["all_status_counts"].items())
    answer = (
        "Your hiring pipeline has no applications."
        if not rows
        else "Your hiring pipeline: " + ", ".join(
            f"{str(status).replace('_', ' ').title()}: {int(count)}"
            for status, count in rows
        ) + f". Total applicants excluding withdrawn: {metrics['total_applicants']}."
    )
    return ToolResult("company_pipeline", answer, "/company/pipeline")


async def _company_interviews(db: AsyncSession, user: User) -> ToolResult:
    """List upcoming scheduled interviews for the company's own internships."""
    metrics = await get_company_metrics(db, user.id)
    rows = (await db.execute(
        select(Internship.title, Interview.status, Interview.scheduled_at)
        .join(Application, Application.id == Interview.application_id)
        .join(Internship, Internship.id == Application.internship_id)
        .where(
            # Filter by internship ownership through the associated application.
            Internship.company_id == user.id,
            Interview.status.in_(("SCHEDULED", "RESCHEDULED")),
            Interview.scheduled_at >= datetime.now(timezone.utc),
        )
        .order_by(Interview.scheduled_at.asc())
        .limit(MAX_ROWS)
    )).all()
    answer = (
        "Your company has no future scheduled interviews."
        if not rows
        else f"You have {metrics['interviews_scheduled']} future scheduled interviews. " + " ".join(
            f"{title}: {status.replace('_', ' ').title()} for {_when(scheduled_at)}."
            for title, status, scheduled_at in rows
        )
    )
    if metrics["interviews_scheduled"] > len(rows):
        answer += f" +{metrics['interviews_scheduled'] - len(rows)} more."
    return ToolResult("company_interviews", answer, "/interviews")


async def _company_unread_messages(db: AsyncSession, user: User) -> ToolResult:
    """Count unread incoming messages in conversations owned by the authenticated company."""
    count = int(await db.scalar(
        select(func.count(Message.id))
        .join(Conversation, Conversation.id == Message.conversation_id)
        .where(
            Conversation.company_id == user.id,
            Message.sender_id != user.id,
            Message.read_at.is_(None),
        )
    ) or 0)
    return ToolResult(
        "company_unread_messages",
        f"You have {count} unread message(s).",
        "/messages",
    )


async def _company_verification_status(db: AsyncSession, user: User) -> ToolResult:
    """Return only the authenticated company's own verification status."""
    status = await db.scalar(
        select(CompanyProfile.verification_status)
        .where(CompanyProfile.user_id == user.id)
    )
    answer = (
        "Your company profile has no verification record yet."
        if status is None
        else f"Your company verification status is {str(status).replace('_', ' ').lower()}."
    )
    return ToolResult("company_verification_status", answer, "/company/settings")


async def _admin_audit(db: AsyncSession, user: User) -> ToolResult:
    """Prioritize meaningful changes, group read-only views, and identify admins without numeric labels."""
    events = (await db.execute(
        select(
            AuditLog,
            User.role,
        )
        .outerjoin(User, AuditLog.actor_id == User.id)
        .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
        .limit(100)
    )).all()
    if not events:
        return ToolResult(
            "admin_audit_events",
            "There are no recent audit events to summarize.",
            "/admin/audit-logs",
        )

    priority_actions = {
        "posting_approved", "posting_rejected", "company_verified", "company_rejected",
        "user_suspended", "user_reinstated", "admin_created",
    }
    grouped_events: dict[tuple[str, str], list[datetime]] = {}
    view_counts: dict[str, int] = {}
    for row in events:
        log, role = row
        action = log.action.casefold()
        if any(term in action for term in ("view", "read", "list", "opened")):
            area = "skill topic data" if "skill" in action or "topic" in action else (
                "audit data" if "audit" in action else "admin data"
            )
            view_counts[area] = view_counts.get(area, 0) + 1
            continue
        role_name = role.value.title() if role is not None else "User"
        actor = "System" if log.actor_id is None else role_name
        target = (log.target_type or "").replace("_", " ") or "platform changes"
        action_text = audit_action_label(log.action).lower()
        created_at = log.created_at
        if created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=timezone.utc)
        age = datetime.now(timezone.utc) - created_at.astimezone(timezone.utc)
        if age < timedelta(minutes=1):
            relative = "just now"
        elif age < timedelta(hours=1):
            relative = f"{int(age.total_seconds() // 60)} minutes ago"
        elif age < timedelta(days=1):
            relative = f"{int(age.total_seconds() // 3600)} hours ago"
        else:
            relative = f"{age.days} days ago"
        key = (f"{actor} {action_text}", target)
        grouped_events.setdefault(key, []).append(created_at)
    state_events = []
    for (action, target), timestamps in grouped_events.items():
        latest = max(timestamps)
        age = datetime.now(timezone.utc) - latest.astimezone(timezone.utc)
        if age < timedelta(minutes=1):
            relative = "just now"
        elif age < timedelta(hours=1):
            relative = f"{int(age.total_seconds() // 60)} minutes ago"
        elif age < timedelta(days=1):
            relative = f"{int(age.total_seconds() // 3600)} hours ago"
        else:
            relative = f"{age.days} days ago"
        count = len(timestamps)
        count_text = f" ({count} times)" if count > 1 else ""
        state_events.append((
            0 if any(token in action.casefold() for token in priority_actions) else 1,
            latest,
            f"{action} for {target}{count_text} ({relative}).",
        ))
    state_events.sort(key=lambda item: (item[0], -item[1].timestamp()))
    lines = [item[2] for item in state_events[:5]]
    lines.extend(
        f"{count} views of {area}."
        for area, count in sorted(view_counts.items(), key=lambda item: item[1], reverse=True)
    )
    answer = (
        "Recent audit events: " + " ".join(lines[:5])
        if lines
        else "There are no recent audit changes to summarize."
    )
    remaining = max(0, len(state_events) + len(view_counts) - 5)
    if remaining:
        answer += f" +{remaining} more."
    return ToolResult("admin_audit_events", answer, "/admin/audit-logs")


async def _admin_pending(db: AsyncSession) -> ToolResult:
    """Count internship postings awaiting administrator approval."""
    count = int(await db.scalar(
        select(func.count(Internship.id)).where(Internship.status == "PENDING_APPROVAL")
    ) or 0)
    return ToolResult(
        "admin_pending_approvals",
        f"There are {count} postings pending approval.",
        "/admin/moderation",
        (("Jobs Queue", "/admin/moderation"),),
    )


async def _admin_verification_counts(db: AsyncSession) -> ToolResult:
    """Return company verification totals, including statuses with zero records."""
    rows = (await db.execute(
        select(CompanyProfile.verification_status, func.count(CompanyProfile.id))
        .group_by(CompanyProfile.verification_status)
        .order_by(CompanyProfile.verification_status)
    )).all()
    counts = {str(status).lower(): int(count) for status, count in rows}
    return ToolResult(
        "admin_verification_counts",
        "Company verification counts: " + ", ".join(
            f"{status.title()}: {counts.get(status, 0)}"
            for status in ("pending", "verified", "rejected")
        ) + ".",
        "/admin/verifications",
    )


async def _admin_analytics(db: AsyncSession) -> ToolResult:
    """Aggregate high-level platform account, internship, and audit counts."""
    users = (await db.execute(
        select(User.role, func.count(User.id))
        .where(User.is_active.is_(True))
        .group_by(User.role)
    )).all()
    role_counts = {role.value: int(count) for role, count in users}
    internship_count = int(await db.scalar(select(func.count(Internship.id)) ) or 0)
    audit_count = int(await db.scalar(select(func.count(AuditLog.id))) or 0)
    open_reports = int(await db.scalar(
        select(func.count(Report.id)).where(Report.status.in_(("OPEN", "INVESTIGATING")))
    ) or 0)
    active_total = sum(role_counts.values())
    answer = (
        f"There are {active_total} active non-suspended user accounts: "
        f"{role_counts.get('STUDENT', 0)} students, "
        f"{role_counts.get('COMPANY', 0)} company accounts, "
        f"{role_counts.get('ADMIN', 0)} administrators. "
        f"The platform has {internship_count} internships, {open_reports} open disputes/reports, "
        f"and {audit_count} audit records."
    )
    return ToolResult("admin_analytics", answer, "/admin")


async def _admin_company_counts(db: AsyncSession) -> ToolResult:
    rows = (await db.execute(
        select(CompanyProfile.verification_status, func.count(User.id))
        .join(User, User.id == CompanyProfile.user_id)
        .where(User.role == UserRole.COMPANY)
        .group_by(CompanyProfile.verification_status)
    )).all()
    counts = {str(status or "UNKNOWN").upper(): int(count) for status, count in rows}
    total = int(await db.scalar(
        select(func.count(User.id)).where(User.role == UserRole.COMPANY)
    ) or 0)
    verified = counts.get("VERIFIED", 0)
    pending = counts.get("PENDING", 0)
    return ToolResult(
        "admin_company_counts",
        f"There are {total} registered company accounts: {verified} verified and {pending} pending verification.",
        "/admin/companies",
    )


async def _admin_company_and_posting_counts(db: AsyncSession) -> ToolResult:
    company_result = await _admin_company_counts(db)
    posting_result = await _admin_posting_counts(db)
    return ToolResult(
        "admin_company_and_posting_counts",
        f"{company_result.answer} {posting_result.answer}",
        "/admin",
    )


async def _admin_student_counts(db: AsyncSession) -> ToolResult:
    total = int(await db.scalar(
        select(func.count(User.id)).where(User.role == UserRole.STUDENT)
    ) or 0)
    active = int(await db.scalar(
        select(func.count(User.id)).where(
            User.role == UserRole.STUDENT,
            User.is_active.is_(True),
            User.suspended_at.is_(None),
        )
    ) or 0)
    return ToolResult(
        "admin_student_counts",
        f"There are {total} registered student accounts; {active} are currently active.",
        "/admin/students",
    )


async def _admin_posting_counts(db: AsyncSession) -> ToolResult:
    rows = (await db.execute(
        select(Internship.status, func.count(Internship.id))
        .group_by(Internship.status)
    )).all()
    counts = {str(status).upper(): int(count) for status, count in rows}
    total = sum(counts.values())
    active = int(await db.scalar(
        select(func.count(Internship.id)).where(
            Internship.status == "PUBLISHED",
            Internship.deadline >= date.today(),
        )
    ) or 0)
    pending = counts.get("PENDING_APPROVAL", 0)
    rejected = counts.get("REJECTED", 0)
    return ToolResult(
        "admin_posting_counts",
        f"There are {total} internship postings in total: {active} published and not expired, "
        f"{pending} pending approval, and {rejected} rejected.",
        "/admin/moderation",
    )


async def _admin_today_activity(db: AsyncSession) -> ToolResult:
    now = datetime.now(timezone.utc)
    start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    next_day = start + timedelta(days=1)

    async def count_today(model, column) -> int:
        return int(await db.scalar(
            select(func.count()).select_from(model).where(column >= start, column < next_day)
        ) or 0)

    student_signups = await count_today(User, User.created_at)
    company_signups = int(await db.scalar(
        select(func.count(User.id)).where(
            User.role == UserRole.COMPANY,
            User.created_at >= start,
            User.created_at < next_day,
        )
    ) or 0)
    application_count = await count_today(Application, Application.created_at)
    posting_submissions = await count_today(Internship, Internship.created_at)
    postings_approved = int(await db.scalar(
        select(func.count(AuditLog.id)).where(
            AuditLog.action == "posting_approved",
            AuditLog.created_at >= start,
            AuditLog.created_at < next_day,
        )
    ) or 0)
    audit_events = await count_today(AuditLog, AuditLog.created_at)
    open_reports = int(await db.scalar(
        select(func.count(Report.id)).where(Report.status.in_(("OPEN", "INVESTIGATING")))
    ) or 0)
    return ToolResult(
        "admin_today_activity",
        f"Today's UTC activity: {student_signups} student signups, {company_signups} company signups, "
        f"{application_count} applications, {posting_submissions} postings submitted, "
        f"{postings_approved} postings approved, and {audit_events} audit events. "
        f"There are {open_reports} open or investigating reports.",
        "/admin",
    )


def _mask_email(email: str) -> str:
    local, separator, domain = email.partition("@")
    if not separator:
        return "[masked]"
    return f"{local[:1]}***@{domain}"


async def _admin_recent_registrations(db: AsyncSession) -> ToolResult:
    rows = (await db.execute(
        select(User.role, User.email, User.created_at)
        .order_by(User.created_at.desc(), User.id.desc())
        .limit(MAX_ROWS)
    )).all()
    answer = "Most recent registrations: " + "; ".join(
        f"{role.value.title()} ({_mask_email(email)}), {_when(created_at)}"
        for role, email, created_at in rows
    ) if rows else "There are no user registrations to show."
    return ToolResult("admin_recent_registrations", answer, "/admin/users")


async def _admin_recent_posting_changes(db: AsyncSession) -> ToolResult:
    rows = (await db.scalars(
        select(AuditLog)
        .where(
            AuditLog.target_type.in_(("internship", "posting"))
            | AuditLog.action.ilike("%posting%"),
        )
        .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
        .limit(MAX_ROWS)
    )).all()
    answer = "Recent posting changes: " + "; ".join(
        f"{audit_action_label(row.action)} for posting #{row.target_id or 'unknown'} "
        f"({_when(row.created_at)})"
        for row in rows
    ) if rows else "There are no recent posting-related audit events."
    return ToolResult("admin_recent_posting_changes", answer, "/admin/audit-logs")


async def _admin_recent_posting_deletions(db: AsyncSession) -> ToolResult:
    deletion_actions = (
        "internship_deleted",
        "posting_deleted",
        "internship_permanently_deleted",
        "posting_permanently_deleted",
    )
    rows = (await db.scalars(
        select(AuditLog)
        .where(AuditLog.action.in_(deletion_actions))
        .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
        .limit(MAX_ROWS)
    )).all()
    answer = (
        "Recent internship deletion events: " + "; ".join(
            f"Internship #{row.target_id or 'unknown'} ({_when(row.created_at)})"
            for row in rows
        )
        if rows
        else "Draft internship deletions are not recorded in Audit Logs, so I can't confirm whether "
        "any occurred recently. Review Audit Logs for recorded posting changes."
    )
    return ToolResult("admin_recent_posting_deletions", answer, "/admin/audit-logs")


async def _admin_security_events(db: AsyncSession) -> ToolResult:
    rows = (await db.scalars(
        select(AuditLog)
        .where(AuditLog.action.in_((
            "failed_login", "login_failed", "auth_login_failed", "suspicious_activity",
        )))
        .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
        .limit(MAX_ROWS)
    )).all()
    if not rows:
        answer = (
            "Failed login attempts are not recorded in the platform audit log, so I can't confirm "
            "whether any occurred. Review Audit Logs for the security and administrative events that are tracked."
        )
    else:
        answer = "Recorded security events: " + "; ".join(
            f"{audit_action_label(row.action)} ({_when(row.created_at)})"
            for row in rows
        )
    return ToolResult("admin_security_events", answer, "/admin/audit-logs")


async def _admin_chatbot_low_confidence_questions(db: AsyncSession) -> ToolResult:
    rows = (await db.scalars(
        select(ChatbotLowConfidenceLog)
        .order_by(ChatbotLowConfidenceLog.created_at.desc(), ChatbotLowConfidenceLog.id.desc())
        .limit(MAX_ROWS)
    )).all()
    answer = (
        "Recent low-confidence chatbot questions: "
        + "; ".join(
            f"[{row.role.title()}] {row.question} ({_when(row.created_at)})"
            for row in rows
        )
        if rows
        else "There are no low-confidence chatbot questions recorded."
    )
    return ToolResult("admin_chatbot_low_confidence_questions", answer, "/admin")


async def _public_open_internships_count(db: AsyncSession) -> ToolResult:
    today = date.today()
    live_filters = (
        Internship.status == "PUBLISHED",
        Internship.deadline >= today,
    )
    postings = int(await db.scalar(
        select(func.count(Internship.id)).where(*live_filters)
    ) or 0)
    companies = int(await db.scalar(
        select(func.count(CompanyProfile.id)).where(
            CompanyProfile.verification_status == "VERIFIED"
        )
    ) or 0)
    return ToolResult(
        "public_open_internships_count",
        f"There are {postings} current internships and {companies} verified companies.",
        "/opportunities",
    )


async def _admin_open_reports(db: AsyncSession) -> ToolResult:
    count = int(await db.scalar(
        select(func.count(Report.id)).where(Report.status.in_(("OPEN", "INVESTIGATING")))
    ) or 0)
    return ToolResult(
        "admin_open_reports",
        f"There are {count} open or investigating reports.",
        "/admin/reports",
    )


async def _admin_skill_assessment_stats(db: AsyncSession) -> ToolResult:
    """Summarize assessment attempts, pass rates, pool readiness, and archived topics."""
    active_topics = list((await db.scalars(
        select(SkillTopic)
        .where(SkillTopic.archived_at.is_(None))
        .order_by(SkillTopic.name.asc(), SkillTopic.slug.asc())
    )).all())
    active_topic_count = len(active_topics)
    topics = active_topics[:MAX_ROWS]
    archived_count = int(await db.scalar(
        select(func.count(SkillTopic.slug)).where(SkillTopic.archived_at.is_not(None))
    ) or 0)
    attempt_rows = (await db.execute(
        select(
            SkillAttempt.topic,
            func.count(SkillAttempt.id),
            func.sum(case((SkillAttempt.status == "COMPLETED", 1), else_=0)),
            func.sum(case((SkillAttempt.passed.is_(True), 1), else_=0)),
        ).group_by(SkillAttempt.topic)
    )).all()
    attempts_by_topic = {
        topic: (int(total), int(completed or 0), int(passed or 0))
        for topic, total, completed, passed in attempt_rows
    }
    question_rows = (await db.execute(
        select(SkillQuestion.topic, SkillQuestion.difficulty, func.count(SkillQuestion.id))
        .where(SkillQuestion.active.is_(True))
        .group_by(SkillQuestion.topic, SkillQuestion.difficulty)
    )).all()
    question_counts: dict[str, dict[str, int]] = {}
    for topic, difficulty, count in question_rows:
        if isinstance(topic, str) and isinstance(difficulty, str):
            question_counts.setdefault(topic, {})[difficulty.upper()] = int(count or 0)
    ready_count = sum(
        all(
            question_counts.get(topic.slug, {}).get(level, 0) >= needed
            for level, needed in (("EASY", 4), ("MEDIUM", 4), ("HARD", 2))
        )
        for topic in active_topics
    )
    not_ready_count = active_topic_count - ready_count
    lines = []
    for topic in topics:
        total, completed, passed = attempts_by_topic.get(topic.slug, (0, 0, 0))
        counts = question_counts.get(topic.slug, {})
        ready = all(counts.get(level, 0) >= needed for level, needed in (
            ("EASY", 4), ("MEDIUM", 4), ("HARD", 2),
        ))
        pass_rate = round(100 * passed / completed) if completed else 0
        lines.append(
            f"{topic.name}: {total} attempts, {completed} completed, "
            f"{pass_rate}% pass rate, {'Ready' if ready else 'Needs questions'}."
        )
    answer = (
        f"There are {active_topic_count} active assessment topics ({ready_count} ready, "
        f"{not_ready_count} not ready) and {archived_count} archived. "
        + (" ".join(lines) if lines else "No assessment topics are configured.")
    )
    if active_topic_count > len(topics):
        answer += f" +{active_topic_count - len(topics)} more topics."
    return ToolResult("admin_skill_assessment_stats", answer, "/admin/skill-assessments")


async def execute_read_tool(
    name: str,
    args: dict[str, Any],
    user: User | None,
    db: AsyncSession,
) -> ToolResult:
    """Authorize a role-specific tool, validate its inputs, and enforce a timeout."""
    expected_role = TOOL_ROLES.get(name)
    if expected_role is None:
        if name != "public_open_internships_count":
            raise HTTPException(status_code=400, detail="Unsupported chatbot tool.")
    if user is None and name != "public_open_internships_count":
        raise HTTPException(status_code=401, detail="Sign in to view your account data.")
    if expected_role is not None and user is not None and user.role != expected_role:
        raise HTTPException(status_code=403, detail="This live-data request is not available for your role.")
    internship_id = _validated_args(name, args)
    # Keep tool dispatch explicit so the allowlist above and its role mapping stay auditable.
    actions = {
        "student_applications": lambda: _student_applications(db, user),
        "student_interviews": lambda: _student_interviews(db, user),
        "student_notifications": lambda: _student_notifications(db, user),
        "student_unread_messages": lambda: _student_unread_messages(db, user),
        "student_profile_completeness": lambda: _student_profile(db, user),
        "student_saved_internships": lambda: _student_saved_internships(db, user),
        "student_recommended_internships": lambda: _student_recommended_internships(db, user),
        "student_skill_assessments": lambda: _student_skill_assessments(db, user),
        "student_skills_improvement": lambda: _student_skills_improvement(db, user),
        "student_skill_retake": lambda: _student_skill_retake(db, user),
        "company_applicants": lambda: _company_applicants(db, user, internship_id),
        "company_shortlisted": lambda: _company_applicants(db, user, internship_id, True),
        "company_pipeline": lambda: _company_pipeline(db, user),
        "company_internships": lambda: _company_internships(db, user, internship_id),
        "company_interviews": lambda: _company_interviews(db, user),
        "company_unread_messages": lambda: _company_unread_messages(db, user),
        "company_verification_status": lambda: _company_verification_status(db, user),
        "admin_audit_events": lambda: _admin_audit(db, user),
        "admin_pending_approvals": lambda: _admin_pending(db),
        "admin_verification_counts": lambda: _admin_verification_counts(db),
        "admin_analytics": lambda: _admin_analytics(db),
        "admin_company_counts": lambda: _admin_company_counts(db),
        "admin_student_counts": lambda: _admin_student_counts(db),
        "admin_posting_counts": lambda: _admin_posting_counts(db),
        "admin_today_activity": lambda: _admin_today_activity(db),
        "admin_recent_registrations": lambda: _admin_recent_registrations(db),
        "admin_recent_posting_changes": lambda: _admin_recent_posting_changes(db),
        "admin_recent_posting_deletions": lambda: _admin_recent_posting_deletions(db),
        "admin_security_events": lambda: _admin_security_events(db),
        "admin_company_and_posting_counts": lambda: _admin_company_and_posting_counts(db),
        "admin_chatbot_low_confidence_questions": lambda: _admin_chatbot_low_confidence_questions(db),
        "public_open_internships_count": lambda: _public_open_internships_count(db),
        "admin_skill_assessment_stats": lambda: _admin_skill_assessment_stats(db),
        "admin_open_reports": lambda: _admin_open_reports(db),
    }
    # A slow database/tool call should not hold the chatbot request open indefinitely.
    return await asyncio.wait_for(actions[name](), timeout=TOOL_TIMEOUT_SECONDS)
