"""Bounded read-only data tools with per-role ownership checks."""

import asyncio
import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Any

from app.api.v1.skills import (
    ASSESSMENT_ATTEMPT_LIMIT,
    ASSESSMENT_RETAKE_COOLDOWN,
    RETENTION_WINDOW,
)
from app.models import (
    Application,
    AuditLog,
    ChatbotLowConfidenceLog,
    CompanyProfile,
    Conversation,
    Internship,
    Interview,
    Message,
    Notification,
    Report,
    Resume,
    SavedInternship,
    SkillAttempt,
    SkillBadge,
    SkillQuestion,
    SkillTopic,
    StudentProfile,
    User,
    UserRole,
)
from app.services.audit import audit_action_label
from app.services.company_metrics import get_company_metrics
from app.services.interview_display import (
    get_interview_state,
)
from fastapi import HTTPException
from sqlalchemy import and_, case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

TOOL_ROLES = {
    "student_applications": UserRole.STUDENT,
    "student_application_counts": UserRole.STUDENT,
    "student_account_summary": UserRole.STUDENT,
    "student_interviews": UserRole.STUDENT,
    "student_notifications": UserRole.STUDENT,
    "student_profile_completeness": UserRole.STUDENT,
    "student_saved_internships": UserRole.STUDENT,
    "student_recommended_internships": UserRole.STUDENT,
    "student_skill_assessments": UserRole.STUDENT,
    "student_unread_messages": UserRole.STUDENT,
    "student_skills_improvement": UserRole.STUDENT,
    "student_skill_gap": UserRole.STUDENT,
    "student_skill_retake": UserRole.STUDENT,
    "company_applicants": UserRole.COMPANY,
    "company_shortlisted": UserRole.COMPANY,
    "company_pipeline": UserRole.COMPANY,
    "company_internships": UserRole.COMPANY,
    "company_interviews": UserRole.COMPANY,
    "company_unread_messages": UserRole.COMPANY,
    "company_verification_status": UserRole.COMPANY,
    "company_account_summary": UserRole.COMPANY,
    "admin_audit_events": UserRole.ADMIN,
    "admin_pending_approvals": UserRole.ADMIN,
    "admin_verification_counts": UserRole.ADMIN,
    "admin_analytics": UserRole.ADMIN,
    "admin_skill_assessment_stats": UserRole.ADMIN,
    "admin_open_reports": UserRole.ADMIN,
    "admin_platform_summary": UserRole.ADMIN,
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


def _validated_args(name: str, args: dict[str, Any]) -> int | str | None:
    """Validate the bounded status or company-internship arguments for read tools."""
    allowed = {"status"} if name == "student_application_counts" else {"internship_id"}
    if set(args) - allowed:
        raise HTTPException(status_code=422, detail="Unsupported tool arguments.")
    if name == "student_application_counts":
        value = args.get("status")
        allowed_statuses = {
            "APPLIED", "UNDER_REVIEW", "SHORTLISTED", "INTERVIEW_SCHEDULED",
            "OFFER", "REJECTED", "WITHDRAWN",
        }
        if value is None:
            return None
        if not isinstance(value, str) or value not in allowed_statuses:
            raise HTTPException(status_code=422, detail="Invalid application status.")
        return value
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


def _count_phrase(count: int, singular: str, plural: str | None = None) -> str:
    """Format a count without zero-valued noise and with the correct noun form."""
    if count <= 0:
        return ""
    return f"{count} {singular if count == 1 else plural or singular + 's'}"


def _short_words(value: str, limit: int = 7) -> str:
    words = value.split()
    return value if len(words) <= limit else " ".join(words[:limit])


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
    """Return a status breakdown and latest postings for only the authenticated student."""
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
    grouped_counts = {
        label: sum(counts.get(status, 0) for status in statuses)
        for label, statuses in status_groups
    }
    known_statuses = {status for _, statuses in status_groups for status in statuses}
    other_count = sum(count for status, count in counts.items() if status not in known_statuses)
    if other_count:
        grouped_counts["Other"] = other_count
    if not total:
        return ToolResult("student_applications", "You have no applications.", "/applications")
    status_labels = {
        "Applied": ("applied", "applied"),
        "Under review": ("under review", "under review"),
        "Shortlisted": ("shortlisted", "shortlisted"),
        "Interview": ("interview", "interviews"),
        "Offer": ("offer", "offers"),
        "Rejected": ("rejected", "rejected"),
        "Withdrawn": ("withdrawn", "withdrawn"),
        "Other": ("other", "other"),
    }
    status_summary = ", ".join(
        _count_phrase(grouped_counts[label], *status_labels[label])
        for label in grouped_counts
        if grouped_counts[label]
    )
    latest_rows = (await db.execute(
        select(Application.status, Internship.title, CompanyProfile.company_name)
        .join(Internship, Internship.id == Application.internship_id)
        .outerjoin(CompanyProfile, CompanyProfile.user_id == Internship.company_id)
        .where(Application.student_id == user.id)
        .order_by(Application.created_at.desc(), Application.id.desc())
        .limit(5)
    )).all()
    latest = "; ".join(
        f"{_short_words(title, 6)} at {_short_words(company_name or 'Company', 4)}: "
        f"{str(status).replace('_', ' ').title()}"
        for status, title, company_name in latest_rows
    )
    answer = (
        f"You have {total} {_count_phrase(total, 'application', 'applications').split(' ', 1)[1]} "
        f"({status_summary}). Latest: {latest}."
    )
    if total > len(latest_rows):
        answer += f" +{total - len(latest_rows)} more."
    return ToolResult("student_applications", answer, "/applications")


async def _student_application_counts(
    db: AsyncSession,
    user: User,
    status: str | None,
) -> ToolResult:
    if status is None:
        result = await _student_applications(db, user)
        return ToolResult("student_application_counts", result.answer, result.route)
    status_groups = {
        "APPLIED": ("APPLIED",),
        "UNDER_REVIEW": ("UNDER_REVIEW",),
        "SHORTLISTED": ("SHORTLISTED",),
        "INTERVIEW_SCHEDULED": ("INTERVIEW_SCHEDULED",),
        "OFFER": ("SELECTED", "ACCEPTED"),
        "REJECTED": ("REJECTED",),
        "WITHDRAWN": ("WITHDRAWN",),
    }
    count = int(await db.scalar(
        select(func.count(Application.id)).where(
            Application.student_id == user.id,
            Application.status.in_(status_groups[status]),
        )
    ) or 0)
    display = {
        "APPLIED": ("applied application", "applied applications"),
        "UNDER_REVIEW": ("application under review", "applications under review"),
        "SHORTLISTED": ("shortlisted application", "shortlisted applications"),
        "INTERVIEW_SCHEDULED": ("scheduled interview", "scheduled interviews"),
        "OFFER": ("offer", "offers"),
        "REJECTED": ("rejected application", "rejected applications"),
        "WITHDRAWN": ("withdrawn application", "withdrawn applications"),
    }[status]
    answer = (
        f"You have no {display[1]}."
        if not count
        else f"You have {_count_phrase(count, *display)}."
    )
    return ToolResult("student_application_counts", answer, "/applications")


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
    answer = (
        "You have no notifications."
        if total == 0
        else f"You have {_count_phrase(total, 'notification')}."
    )
    if unread:
        answer = (
            "You have no notifications."
            if total == 0
            else f"You have {_count_phrase(total, 'notification')}, "
            f"including {_count_phrase(unread, 'unread notification')}."
        )
    return ToolResult("student_notifications", answer, "/notifications")


async def _student_account_summary(db: AsyncSession, user: User) -> ToolResult:
    rows = (await db.execute(
        select(Application.status, func.count(Application.id))
        .where(Application.student_id == user.id)
        .group_by(Application.status)
    )).all()
    counts = {str(status).upper(): int(count) for status, count in rows}
    total = sum(counts.values())

    if total == 1:
        status_order = (
            ("APPLIED", ("applied application", "applied applications")),
            ("UNDER_REVIEW", ("application under review", "applications under review")),
            ("SHORTLISTED", ("shortlisted application", "shortlisted applications")),
            ("INTERVIEW_SCHEDULED", ("scheduled interview", "scheduled interviews")),
            ("SELECTED", ("selected application", "selected applications")),
            ("ACCEPTED", ("accepted offer", "accepted offers")),
            ("REJECTED", ("rejected application", "rejected applications")),
            ("WITHDRAWN", ("withdrawn application", "withdrawn applications")),
        )
        for status, display in status_order:
            if counts.get(status, 0) == 1:
                application_summary = f"You have {_count_phrase(1, *display)}."
                break
        else:
            application_summary = "You have 1 application."
    else:
        applications = await _student_applications(db, user)
        application_summary = applications.answer.split(" Latest:", 1)[0].rstrip(".")

    interviews = await _student_interviews(db, user)
    if interviews.answer.startswith("You have no upcoming interviews"):
        interview_summary = "Upcoming interviews: none"
    else:
        interview_summary = interviews.answer.replace("Your next interviews:", "Upcoming interviews:", 1).rstrip(".")
    unread = int(await db.scalar(
        select(func.count(Notification.id)).where(
            Notification.user_id == user.id,
            Notification.read_at.is_(None),
        )
    ) or 0)
    notification_summary = (
        "No unread notifications."
        if unread == 0
        else f"{_count_phrase(unread, 'unread notification')}."
    )
    application_summary = application_summary.rstrip(".")
    return ToolResult(
        "student_account_summary",
        f"{application_summary}. {interview_summary}. {notification_summary}",
        "/applications",
        (("Interviews", "/interviews"),),
    )


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
        "You have no unread messages."
        if count == 0
        else f"You have {_count_phrase(count, 'unread message')}.",
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
    open_role = and_(
        Internship.status == "PUBLISHED",
        Internship.deadline >= date.today(),
        CompanyProfile.verification_status == "VERIFIED",
        or_(Application.id.is_(None), Application.status == "WITHDRAWN"),
    )
    active_application = and_(Application.id.is_not(None), Application.status != "WITHDRAWN")
    total, open_count, applied_count = (
        await db.execute(
            select(
                func.count(SavedInternship.id),
                func.sum(case((open_role, 1), else_=0)),
                func.sum(case((active_application, 1), else_=0)),
            )
            .select_from(SavedInternship)
            .join(Internship, Internship.id == SavedInternship.internship_id)
            .outerjoin(
                Application,
                (Application.internship_id == Internship.id)
                & (Application.student_id == user.id),
            )
            .outerjoin(CompanyProfile, CompanyProfile.user_id == Internship.company_id)
            .where(SavedInternship.student_id == user.id)
        )
    ).one()
    total = int(total or 0)
    open_count = int(open_count or 0)
    applied_count = int(applied_count or 0)
    rows = (await db.execute(
        select(Internship.title, Internship.id, CompanyProfile.company_name)
        .join(SavedInternship, SavedInternship.internship_id == Internship.id)
        .outerjoin(CompanyProfile, CompanyProfile.user_id == Internship.company_id)
        .where(SavedInternship.student_id == user.id)
        .order_by(SavedInternship.created_at.desc(), SavedInternship.id.desc())
        .limit(MAX_ROWS)
    )).all()
    answer = f"{total} saved roles ({open_count} open, {applied_count} applied)."
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
    failed_topics = []
    expired_topics = []
    untaken_topics = []
    passed_topics = []
    for topic, name in ready_topics.items():
        attempt = latest_attempts.get(topic)
        if attempt is None:
            weak_topics.append((101, f"{name} (not attempted yet)"))
            untaken_topics.append(name)
            continue
        status, score, passed = attempt
        if status == "EXPIRED":
            weak_topics.append((100, f"{name} (latest attempt expired)"))
            expired_topics.append(name)
        elif passed is False:
            weak_topics.append((score if score is not None else 0, f"{name} (latest score {score if score is not None else 'not recorded'}%)"))
            failed_topics.append(name)
        elif passed is True:
            passed_topics.append(name)
    weak_topics.sort(key=lambda item: (item[0], item[1]))
    now = datetime.now(timezone.utc)
    verified_badges = list((await db.scalars(
        select(SkillBadge)
        .where(SkillBadge.student_id == user.id, SkillBadge.expires_at > now)
        .order_by(SkillBadge.expires_at.desc(), SkillBadge.id.desc())
    )).all())
    unique_skills = list(dict.fromkeys(skills))
    skills_text = ", ".join(_short_words(skill, 3) for skill in unique_skills[:6])
    remaining_skills = len(unique_skills) - min(len(unique_skills), 6)
    if not skills_text:
        skills_text = "none listed"
    if remaining_skills:
        skills_text += f" (+{remaining_skills} more)"
    badges_text = ", ".join(_short_words(badge.title, 3) for badge in verified_badges[:2])
    if not badges_text:
        badges_text = "none yet"
    next_topics = ", ".join(
        _short_words(name.split(" (", 1)[0], 5)
        for _, name in weak_topics[:3]
    ) or "none identified"
    answer = f"Skills: {skills_text}. Verified badges: {badges_text}. Next to improve: {next_topics}."
    return ToolResult("student_skills_improvement", answer, "/profile/student")


async def _student_skill_gap(db: AsyncSession, user: User) -> ToolResult:
    result = await _student_skills_improvement(db, user)
    return ToolResult("student_skill_gap", result.answer, "/skills/history")


async def _student_skill_retake(db: AsyncSession, user: User) -> ToolResult:
    """Explain configured retry limits and determine this student's next eligible assessment time."""
    now = datetime.now(timezone.utc)
    attempts = list((await db.scalars(
        select(SkillAttempt)
        .where(SkillAttempt.student_id == user.id)
        .order_by(SkillAttempt.started_at.desc(), SkillAttempt.id.desc())
    )).all())
    weekly_attempts = [
        attempt for attempt in attempts
        if _utc_datetime(attempt.started_at) >= now - RETENTION_WINDOW
    ]
    weekly_retry = None
    if len(weekly_attempts) >= ASSESSMENT_ATTEMPT_LIMIT:
        weekly_retry = _utc_datetime(weekly_attempts[-1].started_at) + RETENTION_WINDOW
    topics = list((await db.execute(
        select(SkillTopic.slug, SkillTopic.name, SkillTopic.archived_at)
        .where(SkillTopic.archived_at.is_(None))
        .order_by(SkillTopic.name, SkillTopic.slug)
    )).all())
    names = {slug: name for slug, name, _ in topics}
    latest_by_topic: dict[str, SkillAttempt] = {}
    for attempt in attempts:
        latest_by_topic.setdefault(attempt.topic, attempt)

    blocked = []
    for topic, name, _ in topics:
        latest = latest_by_topic.get(topic)
        eligible_at = (
            _utc_datetime(latest.started_at) + ASSESSMENT_RETAKE_COOLDOWN
            if latest is not None
            else now
        )
        if weekly_retry is not None:
            eligible_at = max(eligible_at, weekly_retry)
        if eligible_at > now:
            remaining = eligible_at - now
            hours = max(1, int((remaining.total_seconds() + 3599) // 3600))
            blocked.append((name, hours))
    rule = (
        f"You can retake a topic 24 hours after your last attempt starts, with at most "
        f"{ASSESSMENT_ATTEMPT_LIMIT} attempts in any {RETENTION_WINDOW.days} days."
    )
    if not blocked:
        answer = f"{rule} Right now you can take all available topics."
    else:
        locked = ", ".join(
            f"{_short_words(name, 5)} ({hours}h left)"
            for name, hours in blocked[:3]
        )
        if len(blocked) > 3:
            locked += f", +{len(blocked) - 3} more"
        answer = f"{rule} Blocked: {locked}."
    return ToolResult("student_skill_retake", answer, "/skills/history")


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
            Internship.id.not_in(
                select(Application.internship_id).where(
                    Application.student_id == user.id,
                )
            )
        )
        .where(
            Internship.status == "PUBLISHED",
            Internship.deadline >= date.today(),
            Internship.closed_at.is_(None),
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
        if match["score"] is not None and match["score"] > 0:
            matches.append((match["score"], internship, company_name, match["matched"]))
    # Break equal scores by internship ID, then retain the best duplicate title/company pair.
    matches.sort(key=lambda item: (-item[0], item[1].id))
    unique_matches = []
    seen_roles: set[tuple[str, str]] = set()
    for match in matches:
        _, internship, company_name, _ = match
        role_key = (
            internship.title.strip().casefold(),
            (company_name or "company name unavailable").strip().casefold(),
        )
        if role_key in seen_roles:
            continue
        seen_roles.add(role_key)
        unique_matches.append(match)
    matches = unique_matches
    matches = matches[:5]
    answer = (
        "You've applied to or seen all the internships that match your skills right now. Browse more under Opportunities."
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
        f"You have {total} postings: {metrics['active_roles']} active, {pending} pending approval, "
        f"{closed} closed."
    )
    if other:
        answer += f" {other} other posting(s) need attention."
    if rows:
        answer += " Recent postings: " + " ".join(
            f"{title}: {status.replace('_', ' ').title()}, {role_counts.get(role_id, 0)} applicants, "
            f"deadline {_when(deadline)}."
            for role_id, title, status, deadline in rows[:3]
        )
    if total > min(len(rows), 3):
        answer += f" +{total - min(len(rows), 3)} more."
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
        count = int(metrics["shortlisted"])
        answer = "You have no shortlisted candidates." if not count else (
            f"You have {_count_phrase(count, 'shortlisted candidate')}."
        )
    else:
        status_counts = metrics["status_counts"]
        statuses = (
            ("Applied", ("APPLIED",), "applied"),
            ("Under review", ("UNDER_REVIEW",), "under review"),
            ("Shortlisted", ("SHORTLISTED",), "shortlisted"),
            ("Interview", ("INTERVIEW_SCHEDULED",), "interviews"),
            ("Offer", ("SELECTED", "ACCEPTED"), "offers"),
            ("Rejected", ("REJECTED",), "rejected"),
        )
        breakdown = ", ".join(
            _count_phrase(
                sum(status_counts.get(status, 0) for status in group),
                label.casefold(),
                plural,
            )
            for label, group, plural in statuses
            if sum(status_counts.get(status, 0) for status in group)
        )
        total_applicants = int(metrics["total_applicants"])
        answer = (
            "You have no applicants."
            if total_applicants == 0
            else f"You have {_count_phrase(total_applicants, 'applicant')}."
        )
        if breakdown:
            answer += f" Statuses: {breakdown}."
        postings = sorted(
            (
                posting for posting in metrics["applications_by_role"]
                if int(posting["applications"]) > 0
            ),
            key=lambda posting: (-int(posting["applications"]), int(posting["id"])),
        )
        if internship_id is not None:
            postings = [posting for posting in postings if posting["id"] == internship_id]
        if postings:
            posting_summaries = [
                f"{_short_words(posting['title'], 4)} "
                f"({_count_phrase(int(posting['applications']), 'applicant')})"
                for posting in postings[:3]
            ]
            answer += " Top postings: " + "; ".join(posting_summaries) + "."
        if len(postings) > 3:
            answer += f" +{len(postings) - 3} more postings."
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
        "You have no unread messages."
        if count == 0
        else f"You have {_count_phrase(count, 'unread message')}.",
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


async def _company_account_summary(db: AsyncSession, user: User) -> ToolResult:
    metrics = await get_company_metrics(db, user.id)
    unread_notifications = int(await db.scalar(
        select(func.count(Notification.id)).where(
            Notification.user_id == user.id,
            Notification.read_at.is_(None),
        )
    ) or 0)
    verification = await db.scalar(
        select(CompanyProfile.verification_status)
        .where(CompanyProfile.user_id == user.id)
    )
    details = (
        _count_phrase(int(metrics["active_roles"]), "active posting"),
        _count_phrase(int(metrics["new_applications_this_week"]), "new applicant"),
        _count_phrase(int(metrics["interviews_scheduled"]), "interview scheduled"),
        _count_phrase(unread_notifications, "unread notification"),
    )
    summary = ", ".join(item for item in details if item)
    status_text = str(verification or "not submitted").replace("_", " ").lower()
    answer = (
        f"Your account: {summary + '; ' if summary else ''}"
        f"verification status is {status_text}."
    )
    return ToolResult(
        "company_account_summary",
        answer,
        "/company",
        (("Applicants", "/company/applicants"),),
    )


async def _admin_audit(db: AsyncSession, user: User) -> ToolResult:
    """Aggregate tracked actions from the last seven days without personal details."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=7)
    rows = (await db.execute(
        select(AuditLog.action, func.count(AuditLog.id))
        .where(AuditLog.created_at >= cutoff)
        .group_by(AuditLog.action)
    )).all()
    actions = [action for action, count in rows for _ in range(int(count))]
    from app.chatbot.audit_summary import summarize_audit_actions

    return ToolResult(
        "admin_audit_events",
        summarize_audit_actions(actions),
        "/admin/audit-logs",
    )


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
    summary = ", ".join(filter(None, (
        _count_phrase(postings, "current internship"),
        _count_phrase(companies, "verified company"),
    )))
    return ToolResult(
        "public_open_internships_count",
        f"There are {summary}." if summary else "There are no current internships or verified companies.",
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


async def _admin_platform_summary(db: AsyncSession) -> ToolResult:
    cutoff = datetime.now(timezone.utc) - timedelta(days=7)
    pending_verifications = int(await db.scalar(
        select(func.count(CompanyProfile.id)).where(
            CompanyProfile.verification_status == "PENDING"
        )
    ) or 0)
    pending_postings = int(await db.scalar(
        select(func.count(Internship.id)).where(Internship.status == "PENDING_APPROVAL")
    ) or 0)
    open_reports = int(await db.scalar(
        select(func.count(Report.id)).where(Report.status.in_(("OPEN", "INVESTIGATING")))
    ) or 0)
    new_users = int(await db.scalar(
        select(func.count(User.id)).where(User.created_at >= cutoff)
    ) or 0)
    details = list(filter(None, (
        _count_phrase(pending_verifications, "pending company verification"),
        _count_phrase(pending_postings, "pending posting"),
        _count_phrase(open_reports, "open report/dispute", "open reports/disputes"),
    )))
    if new_users:
        details.append(f"{_count_phrase(new_users, 'new user')} in the last 7 days")
    answer = (
        f"Platform summary: {', '.join(details)}."
        if details
        else "No pending verifications, postings, reports, or new users in the last 7 days."
    )
    return ToolResult(
        "admin_platform_summary",
        answer,
        "/admin",
        (
            ("Company Verifications", "/admin/verifications"),
            ("Jobs Queue", "/admin/moderation"),
        ),
    )


async def _admin_skill_assessment_stats(db: AsyncSession) -> ToolResult:
    """Summarize assessment attempts, pass rates, pool readiness, and archived topics."""
    active_topics = list((await db.scalars(
        select(SkillTopic)
        .where(SkillTopic.archived_at.is_(None))
        .order_by(SkillTopic.name.asc(), SkillTopic.slug.asc())
    )).all())
    active_topic_count = len(active_topics)
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
    if active_topic_count == ready_count:
        topic_summary = f"{active_topic_count} active topics (all ready)"
    else:
        topic_summary = (
            f"{active_topic_count} active topics, {ready_count} ready, "
            f"{active_topic_count - ready_count} not ready"
        )
    details = [topic_summary]
    if archived_count:
        details.append(_count_phrase(archived_count, "archived topic"))
    most_attempted = sorted(
        (
            (attempts_by_topic.get(topic.slug, (0, 0, 0))[0], topic.name)
            for topic in active_topics
        ),
        key=lambda item: (-item[0], item[1]),
    )
    if most_attempted and most_attempted[0][0]:
        details.append(
            f"Most attempts: {_short_words(most_attempted[0][1], 6)} "
            f"({most_attempted[0][0]})"
        )
    answer = ". ".join(details) + "."
    return ToolResult(
        "admin_skill_assessment_stats",
        answer,
        "/admin/skill-assessments",
        (("Skill Assessments", "/admin/skill-assessments"),),
    )


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
    validated_arg = _validated_args(name, args)
    internship_id = validated_arg if isinstance(validated_arg, int) else None
    application_status = validated_arg if isinstance(validated_arg, str) else None
    # Keep tool dispatch explicit so the allowlist above and its role mapping stay auditable.
    actions = {
        "student_applications": lambda: _student_applications(db, user),
        "student_application_counts": lambda: _student_application_counts(
            db,
            user,
            application_status,
        ),
        "student_account_summary": lambda: _student_account_summary(db, user),
        "student_interviews": lambda: _student_interviews(db, user),
        "student_notifications": lambda: _student_notifications(db, user),
        "student_unread_messages": lambda: _student_unread_messages(db, user),
        "student_profile_completeness": lambda: _student_profile(db, user),
        "student_saved_internships": lambda: _student_saved_internships(db, user),
        "student_recommended_internships": lambda: _student_recommended_internships(db, user),
        "student_skill_assessments": lambda: _student_skill_assessments(db, user),
        "student_skills_improvement": lambda: _student_skills_improvement(db, user),
        "student_skill_gap": lambda: _student_skill_gap(db, user),
        "student_skill_retake": lambda: _student_skill_retake(db, user),
        "company_applicants": lambda: _company_applicants(db, user, internship_id),
        "company_shortlisted": lambda: _company_applicants(db, user, internship_id, True),
        "company_pipeline": lambda: _company_pipeline(db, user),
        "company_internships": lambda: _company_internships(db, user, internship_id),
        "company_interviews": lambda: _company_interviews(db, user),
        "company_unread_messages": lambda: _company_unread_messages(db, user),
        "company_verification_status": lambda: _company_verification_status(db, user),
        "company_account_summary": lambda: _company_account_summary(db, user),
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
        "admin_platform_summary": lambda: _admin_platform_summary(db),
    }
    # A slow database/tool call should not hold the chatbot request open indefinitely.
    return await asyncio.wait_for(actions[name](), timeout=TOOL_TIMEOUT_SECONDS)
