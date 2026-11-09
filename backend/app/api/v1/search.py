"""Role-scoped global search for authenticated platform users."""

from datetime import date
from difflib import SequenceMatcher
from typing import Annotated, Any
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import String, and_, cast, func, or_, select

from app.api.v1.dependencies import DbSession, get_current_user, get_current_user_optional
from app.models import (
    Application,
    AuditLog,
    CompanyProfile,
    Conversation,
    Interview,
    Internship,
    Report,
    SavedInternship,
    SkillQuestion,
    SkillTopic,
    StudentProfile,
    User,
    UserRole,
)
from app.services.search_matching import (
    escape_search_term,
    match_search_text,
    normalize_search_text,
    search_conditions,
)

router = APIRouter(tags=["search"])
_SUGGEST_SCOPES = {
    "all",
    "internships",
    "saved",
    "applications",
    "postings",
    "applicants",
    "students",
    "companies",
    "users",
    "skill_topics",
}
_SKILL_TOPIC_POOL_REQUIREMENTS = {"EASY": 4, "MEDIUM": 4, "HARD": 2}


def _contains(value: str) -> str:
    """Escape SQL LIKE wildcard characters and wrap a search term for a contains match."""
    return f"%{escape_search_term(value)}%"


def _item(item_id: int, title: str, subtitle: str, badge: str, url: str) -> dict[str, Any]:
    """Build one normalized search-result item with its display text, badge, and destination URL."""
    return {"id": item_id, "title": title, "subtitle": subtitle, "badge": badge, "url": url}


def _group(group_type: str, label: str, items: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Build a labeled result group, returning None when it contains no items."""
    return {"type": group_type, "label": label, "items": items} if items else None


def _suggestion_match_text(text: str, query: str) -> str:
    """Return the title word most closely matching the user's query."""
    query_terms = normalize_search_text(query).split()
    words = normalize_search_text(text).split()
    if not query_terms or not words:
        return text
    best_word = max(
        words,
        key=lambda word: max(
            (SequenceMatcher(None, term, word).ratio() for term in query_terms),
            default=0,
        ),
    )
    return best_word


@router.get("/search/suggest")
async def search_suggestions(
    db: DbSession,
    user: Annotated[User | None, Depends(get_current_user_optional)],
    q: str = Query("", max_length=100),
    scope: str = Query("all"),
) -> dict[str, list[dict[str, Any]]]:
    """Suggest role-visible titles, companies, and skills without exposing applicant PII."""
    if scope not in _SUGGEST_SCOPES:
        raise HTTPException(422, "Unsupported suggestion scope")
    if len(normalize_search_text(q)) < 2:
        return {"items": []}

    role = user.role if user is not None else None
    if scope in {"students", "companies", "users"} and role != UserRole.ADMIN:
        raise HTTPException(403, "Directory suggestions are admin-only")
    if scope in {"postings", "applicants"} and role not in {UserRole.COMPANY, UserRole.ADMIN}:
        raise HTTPException(403, "Posting suggestions are not available for this role")
    if scope in {"saved", "applications"} and role != UserRole.STUDENT:
        raise HTTPException(403, "Student application suggestions are not available for this role")

    if scope == "users":
        users = list(
            (
                await db.execute(
                    select(User.id, User.email, User.role)
                    .order_by(User.id.desc())
                    .limit(1000)
                )
            ).all()
        )
        candidates = [
            {
                "id": item.id,
                "text": item.email,
                "kind": "user",
                "subtitle": item.role.value.title(),
                "url": "/admin/users",
            }
            for item in users
        ]
    elif scope == "students":
        profiles = list(
            (
                await db.execute(
                    select(StudentProfile.user_id, StudentProfile.skills, StudentProfile.university, StudentProfile.major)
                    .order_by(StudentProfile.user_id.desc())
                    .limit(1000)
                )
            ).all()
        )
        candidates = [
            {
                "id": profile.user_id,
                "text": value.strip(),
                "kind": "skill",
                "subtitle": "Student profile search term",
                "url": "/admin/students",
            }
            for profile in profiles
            for value in (profile.skills or "").split(",") + [profile.university or "", profile.major or ""]
            if value.strip()
        ]
    elif scope == "companies":
        companies = list(
            (
                await db.execute(
                    select(CompanyProfile.user_id, CompanyProfile.company_name, CompanyProfile.industry, CompanyProfile.location)
                    .order_by(CompanyProfile.company_name)
                    .limit(1000)
                )
            ).all()
        )
        candidates = [
            {
                "id": company.user_id,
                "text": value.strip(),
                "kind": "company",
                "subtitle": "Company profile search term",
                "url": "/admin/companies",
            }
            for company in companies
            for value in (company.company_name or "", company.industry or "", company.location or "")
            if value.strip()
        ]
    elif scope == "skill_topics":
        topic_query = select(SkillTopic).where(SkillTopic.archived_at.is_(None))
        if role != UserRole.ADMIN:
            question_rows = (await db.execute(
                select(SkillQuestion.topic, SkillQuestion.difficulty, func.count(SkillQuestion.id))
                .where(SkillQuestion.active.is_(True))
                .group_by(SkillQuestion.topic, SkillQuestion.difficulty)
            )).all()
            counts: dict[str, dict[str, int]] = {}
            for topic_id, difficulty, count in question_rows:
                counts.setdefault(topic_id, {})[difficulty.upper()] = int(count)
            ready_topics = {
                topic_id for topic_id, pool in counts.items()
                if all(
                    pool.get(difficulty, 0) >= needed
                    for difficulty, needed in _SKILL_TOPIC_POOL_REQUIREMENTS.items()
                )
            }
            if ready_topics:
                topic_query = topic_query.where(SkillTopic.slug.in_(ready_topics))
            else:
                topic_query = topic_query.where(SkillTopic.slug == "")
        topics = list(await db.scalars(topic_query.order_by(SkillTopic.name)))
        topic_items = [(topic.slug, topic.name) for topic in topics]
        if role != UserRole.ADMIN:
            known_topic_slugs = set(await db.scalars(select(SkillTopic.slug)))
            topic_items.extend(
                (topic_id, topic_id.replace("-", " ").replace("_", " ").title())
                for topic_id in sorted(ready_topics - known_topic_slugs)
            )
        candidates = [
            {
                "id": index,
                "text": name,
                "kind": "skill",
                "subtitle": "Skill assessment topic",
                "url": "/admin/skill-assessments" if role == UserRole.ADMIN else "/profile/student",
            }
            for index, (_, name) in enumerate(topic_items, start=1)
        ]
    else:
        candidates = []
    internship_query = (
        select(Internship, CompanyProfile.company_name)
        .outerjoin(CompanyProfile, CompanyProfile.user_id == Internship.company_id)
        .order_by(Internship.created_at.desc())
    )
    if role == UserRole.STUDENT:
        own_applications = Internship.id.in_(
            select(Application.internship_id).where(Application.student_id == user.id)
        )
        public_postings = and_(
            Internship.status == "PUBLISHED",
            Internship.deadline >= date.today(),
        )
        internship_query = internship_query.where(
            own_applications
            if scope == "applications"
            else or_(public_postings, own_applications)
            if scope == "all"
            else public_postings
        )
    elif role is None:
        internship_query = internship_query.where(
            Internship.status == "PUBLISHED",
            Internship.deadline >= date.today(),
        )
    elif role == UserRole.COMPANY:
        internship_query = internship_query.where(Internship.company_id == user.id)
    if scope == "saved" and role == UserRole.STUDENT:
        internship_query = internship_query.where(
            Internship.id.in_(
                select(SavedInternship.internship_id).where(SavedInternship.student_id == user.id)
            )
        )
    elif scope == "applications" and role == UserRole.STUDENT:
        internship_query = internship_query.where(
            Internship.id.in_(
                select(Application.internship_id).where(Application.student_id == user.id)
            )
        )
    elif scope == "applicants" and role == UserRole.COMPANY:
        internship_query = internship_query.where(
            Internship.id.in_(
                select(Application.internship_id)
                .join(Internship, Internship.id == Application.internship_id)
                .where(Internship.company_id == user.id)
            )
        )

    if scope not in {"users", "students", "companies", "skill_topics"}:
        postgres = db.get_bind().dialect.name == "postgresql"
        if postgres:
            fields = (
                Internship.title,
                CompanyProfile.company_name,
                Internship.skills,
                Internship.location,
                Internship.industry,
            )
            internship_query = internship_query.where(
                *search_conditions(q, fields, postgres=True)
            )
        rows = (await db.execute(internship_query.limit(1000))).all()
        for internship, company_name in rows:
            base_url = (
                f"/company/internships/{internship.id}/edit"
                if role == UserRole.COMPANY
                else f"/opportunities/{internship.id}"
            )
            candidates.append(
                {
                    "id": internship.id,
                    "text": internship.title,
                    "kind": "internship",
                    "subtitle": company_name or "Internship",
                    "url": base_url,
                }
            )
            if company_name:
                candidates.append(
                    {
                        "id": internship.company_id,
                        "text": company_name,
                        "kind": "company",
                        "subtitle": "Company",
                        "url": f"/opportunities?search={quote(company_name)}",
                    }
                )
            for skill in (internship.skills or "").split(","):
                if skill.strip():
                    candidates.append(
                        {
                            "id": internship.id,
                            "text": skill.strip(),
                            "kind": "skill",
                            "subtitle": internship.title,
                            "url": base_url,
                        }
                    )

    ranked: list[tuple[float, dict[str, Any]]] = []
    seen: set[tuple[str, str]] = set()
    for candidate in candidates:
        score = match_search_text(q, (candidate["text"],))
        if score is None:
            continue
        key = (candidate["kind"], normalize_search_text(candidate["text"]))
        if key in seen:
            continue
        seen.add(key)
        candidate["match_text"] = _suggestion_match_text(candidate["text"], q)
        ranked.append((score, candidate))
    ranked.sort(key=lambda result: (result[0], result[1]["kind"] == "internship"), reverse=True)
    return {"items": [candidate for _, candidate in ranked[:8]]}


@router.get("/search")
async def global_search(
    db: DbSession,
    user: Annotated[User, Depends(get_current_user)],
    q: str = Query("", max_length=100),
    limit: int = Query(5, ge=1, le=20),
) -> dict[str, list[dict[str, Any]]]:
    """Search only records visible to the authenticated user's role."""
    if len(q.strip()) < 2:
        return {"groups": []}
    pattern = _contains(q.strip())
    groups: list[dict[str, Any]] = []

    if user.role == UserRole.STUDENT:
        roles = (await db.execute(
            select(Internship.id, Internship.title, CompanyProfile.company_name, Internship.skills)
            .join(CompanyProfile, CompanyProfile.user_id == Internship.company_id)
            .where(
                Internship.status == "PUBLISHED",
                CompanyProfile.verification_status == "VERIFIED",
                or_(
                    Internship.title.ilike(pattern, escape="\\"),
                    CompanyProfile.company_name.ilike(pattern, escape="\\"),
                    Internship.skills.ilike(pattern, escape="\\"),
                ),
            )
            .order_by(Internship.created_at.desc())
            .limit(limit)
        )).all()
        groups.append(_group("internships", "Internships", [
            _item(row.id, row.title, f"{row.company_name} · {row.skills or 'Skills not listed'}", "Internship", f"/opportunities/{row.id}")
            for row in roles
        ]))

        applications = (await db.execute(
            select(Application.id, Internship.title, Application.status)
            .join(Internship, Internship.id == Application.internship_id)
            .where(
                Application.student_id == user.id,
                or_(Internship.title.ilike(pattern, escape="\\"), Application.status.ilike(pattern, escape="\\")),
            )
            .order_by(Application.created_at.desc())
            .limit(limit)
        )).all()
        groups.append(_group("applications", "Applications", [
            _item(row.id, row.title, f"Application · {row.status.replace('_', ' ').title()}", row.status, f"/applications/{row.id}")
            for row in applications
        ]))

        saved = (await db.execute(
            select(SavedInternship.id, Internship.id.label("internship_id"), Internship.title, CompanyProfile.company_name)
            .join(Internship, Internship.id == SavedInternship.internship_id)
            .join(CompanyProfile, CompanyProfile.user_id == Internship.company_id)
            .where(
                SavedInternship.student_id == user.id,
                or_(Internship.title.ilike(pattern, escape="\\"), CompanyProfile.company_name.ilike(pattern, escape="\\")),
            )
            .order_by(SavedInternship.created_at.desc())
            .limit(limit)
        )).all()
        groups.append(_group("saved_roles", "Saved roles", [
            _item(row.id, row.title, row.company_name, "Saved", "/saved")
            for row in saved
        ]))

        interviews = (await db.execute(
            select(Interview.id, Internship.title, Interview.status, Interview.scheduled_at)
            .join(Application, Application.id == Interview.application_id)
            .join(Internship, Internship.id == Application.internship_id)
            .where(
                Application.student_id == user.id,
                or_(Internship.title.ilike(pattern, escape="\\"), Interview.status.ilike(pattern, escape="\\")),
            )
            .order_by(Interview.scheduled_at.desc())
            .limit(limit)
        )).all()
        groups.append(_group("interviews", "Interviews", [
            _item(row.id, row.title, f"{row.status.title()} · {row.scheduled_at:%b %d, %Y}", "Interview", f"/interviews?tab=upcoming&highlight={row.id}")
            for row in interviews
        ]))

    elif user.role == UserRole.COMPANY:
        roles = (await db.execute(
            select(Internship.id, Internship.title, Internship.status)
            .where(
                Internship.company_id == user.id,
                or_(Internship.title.ilike(pattern, escape="\\"), Internship.status.ilike(pattern, escape="\\")),
            )
            .order_by(Internship.created_at.desc())
            .limit(limit)
        )).all()
        groups.append(_group("internships", "My roles", [
            _item(row.id, row.title, row.status.replace("_", " ").title(), "Role", f"/company/internships/{row.id}/edit")
            for row in roles
        ]))

        applicants = (await db.execute(
            select(Application.id, StudentProfile.full_name, Internship.id.label("internship_id"), Internship.title)
            .join(Internship, Internship.id == Application.internship_id)
            .join(StudentProfile, StudentProfile.user_id == Application.student_id)
            .where(
                Internship.company_id == user.id,
                StudentProfile.full_name.ilike(pattern, escape="\\"),
            )
            .order_by(Application.created_at.desc())
            .limit(limit)
        )).all()
        groups.append(_group("applicants", "Applicants", [
            _item(row.id, row.full_name, row.title, "Applicant", f"/company/jobs/{row.internship_id}/applicants")
            for row in applicants
        ]))

        interviews = (await db.execute(
            select(Interview.id, StudentProfile.full_name, Internship.title, Interview.status, Interview.scheduled_at)
            .join(Application, Application.id == Interview.application_id)
            .join(Internship, Internship.id == Application.internship_id)
            .join(StudentProfile, StudentProfile.user_id == Application.student_id)
            .where(
                Internship.company_id == user.id,
                or_(StudentProfile.full_name.ilike(pattern, escape="\\"), Internship.title.ilike(pattern, escape="\\")),
            )
            .order_by(Interview.scheduled_at.desc())
            .limit(limit)
        )).all()
        groups.append(_group("interviews", "Interviews", [
            _item(row.id, row.full_name, f"{row.title} · {row.status.title()}", "Interview", f"/interviews?tab=upcoming&highlight={row.id}")
            for row in interviews
        ]))

        contacts = (await db.execute(
            select(Conversation.id, StudentProfile.full_name)
            .join(StudentProfile, StudentProfile.user_id == Conversation.student_id)
            .where(Conversation.company_id == user.id, StudentProfile.full_name.ilike(pattern, escape="\\"))
            .order_by(Conversation.created_at.desc())
            .limit(limit)
        )).all()
        groups.append(_group("contacts", "Conversation contacts", [
            _item(row.id, row.full_name, "Conversation", "Contact", f"/messages?conversation={row.id}")
            for row in contacts
        ]))

    else:
        users = (await db.execute(
            select(User.id, User.email, User.role, StudentProfile.full_name, CompanyProfile.company_name)
            .outerjoin(StudentProfile, StudentProfile.user_id == User.id)
            .outerjoin(CompanyProfile, CompanyProfile.user_id == User.id)
            .where(or_(
                User.email.ilike(pattern, escape="\\"),
                cast(User.role, String).ilike(pattern, escape="\\"),
                StudentProfile.full_name.ilike(pattern, escape="\\"),
                CompanyProfile.company_name.ilike(pattern, escape="\\"),
            ))
            .order_by(User.id.desc())
            .limit(limit)
        )).all()
        groups.append(_group("users", "Users", [
            _item(row.id, row.full_name or row.company_name or row.email, f"{row.email} · {row.role.value}", "User", f"/admin/users")
            for row in users
        ]))

        companies = (await db.execute(
            select(CompanyProfile.user_id, CompanyProfile.company_name, CompanyProfile.verification_status)
            .where(or_(
                CompanyProfile.company_name.ilike(pattern, escape="\\"),
                CompanyProfile.verification_status.ilike(pattern, escape="\\"),
            ))
            .order_by(CompanyProfile.company_name)
            .limit(limit)
        )).all()
        groups.append(_group("companies", "Companies", [
            _item(row.user_id, row.company_name, f"Verification · {row.verification_status.title()}", row.verification_status, f"/admin/companies/{row.user_id}/postings")
            for row in companies
        ]))

        roles = (await db.execute(
            select(Internship.id, Internship.title, Internship.status, CompanyProfile.company_name)
            .outerjoin(CompanyProfile, CompanyProfile.user_id == Internship.company_id)
            .where(or_(
                Internship.title.ilike(pattern, escape="\\"),
                Internship.status.ilike(pattern, escape="\\"),
                CompanyProfile.company_name.ilike(pattern, escape="\\"),
            ))
            .order_by(Internship.created_at.desc())
            .limit(limit)
        )).all()
        groups.append(_group("internships", "Internships / postings", [
            _item(row.id, row.title, f"{row.company_name or 'Company'} · {row.status.replace('_', ' ').title()}", "Posting", "/admin/moderation")
            for row in roles
        ]))

        reports = (await db.execute(
            select(Report.id, Report.reason, Report.status)
            .where(or_(Report.reason.ilike(pattern, escape="\\"), Report.status.ilike(pattern, escape="\\")))
            .order_by(Report.created_at.desc())
            .limit(limit)
        )).all()
        groups.append(_group("reports", "Reports", [
            _item(row.id, f"Report #{row.id}", row.reason[:160], row.status, "/admin/reports")
            for row in reports
        ]))

        audit_logs = (await db.execute(
            select(AuditLog.id, AuditLog.action, AuditLog.actor_email)
            .where(or_(
                AuditLog.action.ilike(pattern, escape="\\"),
                AuditLog.actor_email.ilike(pattern, escape="\\"),
            ))
            .order_by(AuditLog.created_at.desc())
            .limit(limit)
        )).all()
        groups.append(_group("audit_logs", "Audit logs", [
            _item(row.id, row.action.replace("_", " ").title(), row.actor_email or "System", "Audit log", "/admin/audit-logs")
            for row in audit_logs
        ]))

    return {"groups": [group for group in groups if group is not None]}
