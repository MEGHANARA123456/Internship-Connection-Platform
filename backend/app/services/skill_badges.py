"""Shared privacy and matching rules for verified skill badges."""

from datetime import datetime, timezone
import re
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import SkillBadge


TOPIC_SKILL_TERMS: dict[str, tuple[str, ...]] = {
    "python": ("python", "fastapi", "django", "flask", "backend architecture"),
    "react": ("react", "react.js", "reactjs", "frontend", "front-end"),
    "sql": ("sql", "postgresql", "mysql", "database design", "database"),
    "dsa": ("dsa", "data structures", "algorithms"),
    "ai": ("machine learning", "deep learning", "artificial intelligence", "ai", "ml"),
    "devops": ("devops", "docker", "kubernetes", "cloud", "aws", "azure"),
    "security": ("security", "cybersecurity", "web security", "system design"),
    "typescript": ("typescript", "javascript"),
}


async def get_valid_badges(db: AsyncSession, student_id: int) -> list[SkillBadge]:
    """Fetch unexpired badges for a student, retaining only the latest badge per topic."""
    now = datetime.now(timezone.utc)
    badges = list(await db.scalars(
        select(SkillBadge)
        .where(SkillBadge.student_id == student_id, SkillBadge.expires_at > now)
        .order_by(SkillBadge.earned_at.desc())
    ))
    latest: dict[str, SkillBadge] = {}
    for badge in badges:
        latest.setdefault(badge.topic, badge)
    return list(latest.values())


def badge_matches_skill(topic: str, skill: str) -> bool:
    """Match a skill against the configured aliases for a badge topic, using token boundaries for short terms."""
    normalized = " ".join(skill.casefold().replace("_", " ").replace("-", " ").split())
    terms = TOPIC_SKILL_TERMS.get(topic, (topic.replace("_", " ").replace("-", " "),))
    return any(
        bool(re.search(rf"\b{re.escape(term.casefold())}\b", normalized))
        if len(term) <= 3
        else term.casefold() in normalized
        for term in terms
    )


def apply_verified_badge_boost(
    match: dict[str, Any],
    required_skills: list[str],
    badges: list[SkillBadge],
) -> dict[str, Any]:
    """Add up to 15 points for matched required skills covered by valid badges and explain the resulting score."""
    if match.get("score") is None:
        return {
            **match,
            "base_match_score": None,
            "verified_skill_bonus": 0,
            "verified_skills": [],
            "match_explanation": "No score is available until the student adds profile skills or resume text.",
        }
    matched = {skill.casefold().strip() for skill in match.get("matched_skills", [])}
    boosted_skills: list[str] = []
    for skill in required_skills:
        normalized = skill.casefold().strip()
        if normalized not in matched or normalized in {value.casefold() for value in boosted_skills}:
            continue
        if any(badge_matches_skill(badge.topic, skill) for badge in badges):
            boosted_skills.append(skill.strip().title())

    boost = min(15, 5 * len(boosted_skills))
    base_score = int(match.get("score") or 0)
    final_score = min(100, base_score + boost)
    return {
        **match,
        "score": final_score,
        "base_match_score": base_score,
        "verified_skill_bonus": min(boost, final_score - base_score),
        "verified_skills": boosted_skills,
        "match_explanation": (
            f"Base match {base_score}%. Verified skills add +5 points per matched required skill, capped at +15; "
            f"applied +{min(boost, final_score - base_score)} for {', '.join(boosted_skills)}."
            if boosted_skills and final_score > base_score
            else "No verified-skill points applied. Eligible matching badges add +5 points per required skill, capped at +15."
        ),
    }


def badge_response(badge: SkillBadge) -> dict[str, Any]:
    """Serialize the public badge fields without exposing student or internal record data."""
    return {
        "id": badge.id,
        "topic": badge.topic,
        "title": badge.title,
        "level": badge.level,
        "score": badge.score,
        "earned_at": badge.earned_at,
        "expires_at": badge.expires_at,
    }
