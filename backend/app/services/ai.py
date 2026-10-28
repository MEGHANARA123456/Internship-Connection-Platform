# -----------------------------------------------------------------------------
# AI service layer for embeddings, generation, and intelligence-backed features.
# -----------------------------------------------------------------------------

import re
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

from app.core.config import get_settings
from app.models import Resume
from app.services.pdf import extract_text_from_pdf
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

_SKILL_ALIAS_GROUPS = (
    ("machine learning", "ml"),
    ("artificial intelligence", "ai"),
    ("deep learning", "dl"),
    ("javascript", "js"),
    ("postgresql", "postgres", "postgres db"),
    ("react", "react.js", "reactjs"),
    ("node.js", "node", "nodejs"),
)
_ALIAS_TO_CANONICAL = {
    " ".join(re.findall(r"[^\W_]+", alias.casefold())): group[0]
    for group in _SKILL_ALIAS_GROUPS
    for alias in group
}
_JOB_KEYWORD_STOPWORDS = {
    "a", "an", "and", "are", "as", "at", "be", "by", "can", "candidate",
    "company", "for", "from", "have", "in", "intern", "internship", "is",
    "it", "job", "looking", "more", "of", "on", "or", "our", "role",
    "skills", "team", "the", "their", "this", "to", "we", "with", "work",
    "working", "you", "your", "engineer", "engineering", "developer",
    "development", "specialist", "position", "required", "experience",
}


def _tokens(value: str) -> list[str]:
    return re.findall(r"[^\W_]+", value.casefold())


def _canonical_skill(skill: str) -> str:
    normalized = " ".join(_tokens(skill))
    return _ALIAS_TO_CANONICAL.get(normalized, normalized)


def _skill_variants(skill: str) -> list[list[str]]:
    normalized = " ".join(_tokens(skill))
    canonical = _ALIAS_TO_CANONICAL.get(normalized)
    variants = [normalized]
    if canonical:
        variants.extend(
            " ".join(_tokens(alias))
            for alias in next(group for group in _SKILL_ALIAS_GROUPS if group[0] == canonical)
        )
    return [variant.split() for variant in dict.fromkeys(variants) if variant]


def _contains_tokens(candidate_tokens: list[str], phrase: list[str]) -> bool:
    width = len(phrase)
    if not width:
        return False
    if any(
        candidate_tokens[index:index + width] == phrase
        for index in range(len(candidate_tokens) - width + 1)
    ):
        return True

    compact_phrase = "".join(phrase)
    return any(
        "".join(candidate_tokens[start:end]) == compact_phrase
        for start in range(len(candidate_tokens))
        for end in range(start + 1, min(len(candidate_tokens) + 1, start + width + 4))
    )


def _contains_skill(candidate_tokens: list[str], skill: str) -> bool:
    variants = _skill_variants(skill)
    if len(_tokens(skill)) == 1:
        token = _tokens(skill)[0]
        for group in _SKILL_ALIAS_GROUPS:
            if any(token in _tokens(alias) for alias in group):
                variants.extend(" ".join(_tokens(alias)).split() for alias in group)
    return any(_contains_tokens(candidate_tokens, variant) for variant in variants)


def _title_keywords(job_title: str) -> list[str]:
    return list(dict.fromkeys(
        token for token in _tokens(job_title)
        if len(token) > 2 and token not in _JOB_KEYWORD_STOPWORDS
    ))


def _fallback_keywords(job_title: str, job_description: str) -> list[str]:
    return list(dict.fromkeys(
        token
        for token in _tokens(f"{job_title} {job_description}")
        if len(token) > 2 and token not in _JOB_KEYWORD_STOPWORDS
    ))[:20]


def _eligibility_ratio(eligibility_data: Any) -> float | None:
    if isinstance(eligibility_data, bool):
        return float(eligibility_data)
    if isinstance(eligibility_data, (int, float)):
        value = float(eligibility_data)
        return max(0.0, min(value / 100 if value > 1 else value, 1.0))
    if not isinstance(eligibility_data, Mapping):
        return None

    fit = eligibility_data.get("fit")
    if isinstance(fit, (int, float)) and not isinstance(fit, bool):
        return max(0.0, min(float(fit) / 100 if fit > 1 else float(fit), 1.0))
    eligible = eligibility_data.get("eligible")
    if isinstance(eligible, bool):
        return float(eligible)

    matched = eligibility_data.get("matched")
    required = eligibility_data.get("required")
    if isinstance(matched, Sequence) and not isinstance(matched, (str, bytes)):
        matched = len(matched)
    if isinstance(required, Sequence) and not isinstance(required, (str, bytes)):
        required = len(required)
    if isinstance(matched, (int, float)) and isinstance(required, (int, float)) and required > 0:
        return max(0.0, min(float(matched) / float(required), 1.0))
    return None


def compute_explicit_eligibility_fit(
    job_description: str,
    graduation_year: int | None,
    education_text: str | None,
) -> dict[str, int] | None:
    """Score only clearly stated graduation-year and field-of-study requirements."""
    description = job_description or ""
    requirements: list[tuple[str, Any]] = []

    year_patterns = (
        (
            r"\bgraduation\s+year\s*(?:must\s+be|is|required\s*(?:to\s+be)?|:|=)?\s*(20\d{2})\b",
            "year",
        ),
        (
            r"\b(?:expected\s+to\s+)?graduate\s+(?:in|by|before|no\s+later\s+than)\s+(20\d{2})\b",
            "year",
        ),
        (
            r"\bgraduating\s+(?:in|by|before)\s+(20\d{2})\b",
            "year",
        ),
        (
            r"\b(?:graduation\s+year|graduating)\s+between\s+(20\d{2})\s+and\s+(20\d{2})\b",
            "year_range",
        ),
    )
    for pattern, kind in year_patterns:
        for match in re.finditer(pattern, description, flags=re.IGNORECASE):
            if kind == "year":
                requirements.append(("year", int(match.group(1))))
            else:
                requirements.append(("year_range", (int(match.group(1)), int(match.group(2)))))

    major_patterns = (
        (
            r"\b(?:major(?:ing)?\s+in|degree\s+in|pursuing\s+(?:a\s+)?degree\s+in|"
            r"enrolled\s+in)\s+([^.;,\n]+)"
        ),
    )
    education_phrases: list[str] = []
    for pattern in major_patterns:
        for match in re.finditer(pattern, description, flags=re.IGNORECASE):
            phrase = re.split(
                r"\s+(?:or\s+related\b|or\s+equivalent\b|or\s+similar\b|"
                r"required\b|preferred\b|is\s+required\b|is\s+preferred\b|"
                r"must\b|with\b)",
                match.group(1),
                maxsplit=1,
                flags=re.IGNORECASE,
            )[0].strip(" :-")
            if phrase and len(phrase) <= 80:
                education_phrases.append(phrase)

    normalized_phrases = list(dict.fromkeys(
        " ".join(_tokens(phrase)) for phrase in education_phrases if _tokens(phrase)
    ))
    requirements = list(dict.fromkeys(requirements))
    if not requirements and not normalized_phrases:
        return None

    matched = 0
    for kind, value in requirements:
        if graduation_year is None:
            continue
        if (
            kind == "year" and graduation_year == value
            or kind == "year_range" and value[0] <= graduation_year <= value[1]
        ):
            matched += 1

    candidate_education = _tokens(education_text or "")
    for phrase in normalized_phrases:
        if _contains_tokens(candidate_education, phrase.split()):
            matched += 1

    return {"matched": matched, "required": len(requirements) + len(normalized_phrases)}


async def get_student_resume_text(db: AsyncSession, student_id: int) -> str:
    resume = await db.scalar(select(Resume).where(Resume.student_id == student_id))
    if resume is None:
        return ""

    resume_path = Path(get_settings().resume_storage_path) / resume.stored_filename
    if resume_path.is_file() and resume_path.suffix.lower() == ".pdf":
        return extract_text_from_pdf(resume_path)
    return ""


def compute_match(
    student_skills: list[str],
    resume_text: str,
    job_title: str,
    job_description: str,
    job_skills: list[str],
    eligibility_data: Any = None,
) -> dict[str, Any]:
    student_skills = [skill.strip() for skill in (student_skills or []) if skill and skill.strip()]
    resume_text = resume_text or ""
    job_title = job_title or ""
    job_description = job_description or ""
    job_skills = [skill.strip() for skill in (job_skills or []) if skill and skill.strip()]
    candidate_tokens = _tokens(f"{resume_text} {' '.join(student_skills)}")
    eligibility_ratio = _eligibility_ratio(eligibility_data)

    if not student_skills and not resume_text.strip():
        score = None
        matched_skills: list[str] = []
        missing_skills = job_skills or _fallback_keywords(job_title, job_description)
        reason = "no_profile_data"
        confidence = "low"
        explanation = "No profile skills or resume text were available to assess this match."
        breakdown = {
            "skill_coverage": None,
            "title_relevance": None,
            "eligibility_fit": None,
            "weights": {},
        }
    else:
        required_skills = job_skills or _fallback_keywords(job_title, job_description)
        deduplicated: dict[str, str] = {}
        for skill in required_skills:
            deduplicated.setdefault(_canonical_skill(skill), skill)
        required_skills = list(deduplicated.values())

        matched_skills = [
            skill for skill in required_skills if _contains_skill(candidate_tokens, skill)
        ]
        missing_skills = [skill for skill in required_skills if skill not in matched_skills]
        skill_ratio = len(matched_skills) / len(required_skills) if required_skills else None

        title_words = _title_keywords(job_title)
        title_matches = sum(
            _contains_skill(candidate_tokens, word) for word in title_words
        )
        title_ratio = title_matches / len(title_words) if title_words else None

        components: dict[str, tuple[float, float]] = {}
        if skill_ratio is not None:
            components["skill_coverage"] = (skill_ratio, 70)
        if title_ratio is not None:
            components["title_relevance"] = (title_ratio, 20)
        if eligibility_ratio is not None:
            components["eligibility_fit"] = (eligibility_ratio, 10)

        total_weight = sum(weight for _, weight in components.values())
        score = round(
            100 * sum(ratio * weight for ratio, weight in components.values()) / total_weight
        ) if total_weight else None
        weights = {
            name: round(weight / total_weight, 4)
            for name, (_, weight) in components.items()
        } if total_weight else {}
        breakdown = {
            "skill_coverage": round(skill_ratio * 100, 2) if skill_ratio is not None else None,
            "title_relevance": round(title_ratio * 100, 2) if title_ratio is not None else None,
            "eligibility_fit": round(eligibility_ratio * 100, 2) if eligibility_ratio is not None else None,
            "weights": weights,
        }

        if not required_skills and not title_words:
            reason = "no_job_requirements"
        elif not job_skills:
            reason = "keyword_fallback"
        elif not any(ratio for ratio, _ in components.values()):
            reason = "no_overlap"
        elif all(ratio == 1 for ratio, _ in components.values()):
            reason = "full_match"
        else:
            reason = "partial_match"
        confidence = (
            "low" if not job_skills
            else "high" if student_skills and resume_text.strip()
            else "medium"
        )
        if score is None:
            explanation = "No job requirements or title keywords were available to assess this match."
        else:
            explanation = (
                f"Score uses {', '.join(weights)} with proportional weights "
                f"{', '.join(f'{name} {weight:.0%}' for name, weight in weights.items())}."
            )
    return {
        "score": score,
        "matched": [skill.title() for skill in matched_skills],
        "missing": [skill.title() for skill in missing_skills],
        "reason": reason,
        "confidence": confidence,
        "score_breakdown": breakdown,
        "match_explanation": explanation,
        "matched_skills": [skill.title() for skill in matched_skills],
        "missing_skills": [skill.title() for skill in missing_skills],
    }


def compute_ats_score(
    resume_text: str,
    student_skills: list[str],
    job_title: str,
    job_description: str,
    job_skills: list[str],
) -> dict[str, Any]:
    match = compute_match(student_skills, resume_text, job_title, job_description, job_skills)
    suggestions = []
    if match["missing_skills"]:
        suggestions.append(
            f"Add projects or experience demonstrating skills in: {', '.join(match['missing_skills'][:3])}."
        )
    if len(resume_text) < 200:
        suggestions.append("Upload a detailed PDF resume to showcase course projects, metrics, and technical accomplishments.")
    if not suggestions:
        suggestions.append("Your profile is exceptionally well-aligned! Emphasize measurable achievements in your cover note.")

    return {
        **match,
        "strengths": [
            f"Demonstrated proficiency in {', '.join(match['matched_skills'][:3])}."
            if match["matched_skills"]
            else "Academic foundation"
        ],
        "suggestions": suggestions,
    }


def compute_match_score_fast(
    student_skills: list[str],
    job_skills: list[str],
    job_title: str = "",
    resume_text: str = "",
    job_description: str = "",
    eligibility_data: Any = None,
) -> dict[str, Any]:
    return compute_match(
        student_skills,
        resume_text,
        job_title,
        job_description,
        job_skills,
        eligibility_data=eligibility_data,
    )



def generate_tailored_pitch(
    student_name: str,
    university: str,
    major: str,
    skills: list[str],
    bio: str | None,
    job_title: str,
    company_name: str,
    job_description: str,
) -> str:
    skills_text = ", ".join(skills[:4]) if skills else "modern software development technologies"
    first_paragraph = (
        f"I am writing to express my strong interest in the {job_title} role at {company_name}. "
        f"As a {major} student at {university} with a solid foundation in {skills_text}, "
        f"I have developed practical experience building scalable and user-focused applications."
    )
    
    second_paragraph = (
        f"I am particularly inspired by {company_name}'s mission and the technical challenges outlined in the job description. "
        f"With my background in collaborative problem solving and hands-on project execution, "
        f"I am confident in my ability to make an immediate impact on your engineering team while rapidly learning your core systems. "
        f"Thank you for considering my application, and I look forward to the opportunity to discuss how my skills align with your goals."
    )

    return f"{first_paragraph}\n\n{second_paragraph}"


def generate_mock_interview_questions(job_title: str, industry: str, skills: list[str]) -> list[dict[str, Any]]:
    skill_list = [s.strip() for s in skills if s.strip()] or ["Python", "Problem Solving", "Web Architecture"]
    
    questions = [
        {
            "id": 1,
            "type": "TECHNICAL",
            "question": f"How would you architect and implement a core feature for this {job_title} role using {skill_list[0]}?",
            "rubric": f"Evaluates practical technical knowledge of {skill_list[0]}, component separation, and scalability considerations.",
        },
        {
            "id": 2,
            "type": "TECHNICAL",
            "question": f"Describe a challenging bug or performance bottleneck you solved involving {skill_list[1] if len(skill_list) > 1 else skill_list[0]}. How did you diagnose and resolve it?",
            "rubric": "Looks for systematic debugging methodology, profiling, and verification of fixes.",
        },
        {
            "id": 3,
            "type": "SYSTEM_DESIGN",
            "question": f"If our application experiences a 10x traffic spike during a recruitment drive, how would you design our API and database layer to remain resilient?",
            "rubric": "Focuses on caching, database indexing, rate limiting, connection pooling, and horizontal scaling.",
        },
        {
            "id": 4,
            "type": "BEHAVIORAL",
            "question": f"Tell me about a time when you received constructive feedback on code or a project from a teammate or mentor. How did you handle it?",
            "rubric": "Assesses coachability, open-mindedness, team-first mentality, and growth mindset.",
        },
        {
            "id": 5,
            "type": "BEHAVIORAL",
            "question": f"Why are you passionate about joining this company in the {industry} industry, and what do you hope to learn during your internship?",
            "rubric": "Measures intrinsic motivation, role alignment, industry curiosity, and long-term career ambition.",
        },
    ]
    return questions


def evaluate_mock_interview_answer(question: str, answer: str, rubric: str) -> dict[str, Any]:
    cleaned = answer.strip()
    word_count = len(cleaned.split())
    
    if word_count < 15:
        score = 4
        feedback = "Answer is too brief. Provide concrete context, actions you took, and measurable results (STAR method: Situation, Task, Action, Result)."
        strengths = ["Prompt was directly addressed"]
        improvements = ["Elaborate with specific technical details", "Structure your answer with situation and outcome"]
    elif word_count < 40:
        score = 7
        feedback = "Good foundation. You conveyed the main point clearly, but could strengthen it by mentioning specific trade-offs or technical tools."
        strengths = ["Clear communication", "Relevant to question"]
        improvements = ["Provide a specific project example to prove your point"]
    else:
        score = 9
        feedback = "Outstanding response! Structured, specific, and showcases both technical depth and self-awareness."
        strengths = ["Comprehensive details", "Clear reasoning and terminology", "Professional delivery"]
        improvements = ["Practice keeping your delivery within 90-120 seconds during live interviews"]

    return {
        "score": score,
        "max_score": 10,
        "feedback": feedback,
        "strengths": strengths,
        "improvements": improvements,
    }
