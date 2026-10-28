from datetime import datetime, timezone
from typing import Any

from app.models import (
    Application,
    CompanyProfile,
    Internship,
    Resume,
    StudentProfile,
    User,
)
from app.services.ai import compute_explicit_eligibility_fit, compute_match, get_student_resume_text
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession


async def check_eligibility(
    db: AsyncSession,
    student: User,
    internship: Internship,
) -> dict[str, Any]:
    blockers: list[dict[str, Any]] = []
    warnings: list[dict[str, str]] = []

    if not student.is_verified:
        blockers.append({
            "code": "EMAIL_NOT_VERIFIED",
            "message": "Verify your email before applying.",
            "action_url": "/verify",
        })

    profile = await db.scalar(
        select(StudentProfile).where(StudentProfile.user_id == student.id)
    )
    missing_fields: list[str] = []
    if profile is None:
        missing_fields = ["full name", "university", "major", "graduation year", "skills"]
    else:
        if not profile.full_name or len(profile.full_name.strip()) < 2:
            missing_fields.append("full name")
        if not profile.university or len(profile.university.strip()) < 2:
            missing_fields.append("university")
        if not profile.major or len(profile.major.strip()) < 2:
            missing_fields.append("major")
        if profile.graduation_year is None or not 2000 <= profile.graduation_year <= 2100:
            missing_fields.append("graduation year")
        if not profile.skills or not profile.skills.strip():
            missing_fields.append("skills")
    if missing_fields:
        blockers.append({
            "code": "PROFILE_INCOMPLETE",
            "message": f"Complete your profile. Missing: {', '.join(missing_fields)}.",
            "action_url": "/profile/student",
        })

    resume = await db.scalar(select(Resume).where(Resume.student_id == student.id))
    company = await db.scalar(
        select(CompanyProfile).where(CompanyProfile.user_id == internship.company_id)
    )
    if internship.status != "PUBLISHED" or company is None or company.verification_status != "VERIFIED":
        blockers.append({
            "code": "INTERNSHIP_NOT_OPEN",
            "message": "This internship is not open for applications.",
            "action_url": None,
        })

    today = datetime.now(timezone.utc).date()
    deadline = internship.deadline.date() if isinstance(internship.deadline, datetime) else internship.deadline
    if deadline is not None and deadline < today:
        blockers.append({
            "code": "DEADLINE_PASSED",
            "message": "The application deadline for this internship has passed.",
            "action_url": None,
        })

    existing = await db.scalar(
        select(Application).where(
            Application.internship_id == internship.id,
            Application.student_id == student.id,
        )
    )
    if existing is not None and existing.status != "WITHDRAWN":
        blockers.append({
            "code": "ALREADY_APPLIED",
            "message": f"You already applied to this internship (status: {existing.status.replace('_', ' ').title()}).",
            "action_url": f"/applications?id={existing.id}",
            "application_id": existing.id,
            "status": existing.status,
        })

    student_skills = [
        skill.strip()
        for skill in (profile.skills if profile else "").split(",")
        if skill.strip()
    ]
    job_skills = [skill.strip() for skill in (internship.skills or "").split(",") if skill.strip()]
    resume_text = await get_student_resume_text(db, student.id)
    match = compute_match(
        student_skills,
        resume_text,
        internship.title,
        internship.description,
        job_skills,
        eligibility_data=compute_explicit_eligibility_fit(
            internship.description,
            profile.graduation_year if profile else None,
            f"{profile.major} {profile.university}" if profile else "",
        ),
    )
    if match["score"] is not None and match["score"] < 50:
        warnings.append({
            "code": "LOW_MATCH",
            "message": "Your match score is below 50. You can still apply.",
        })

    uploaded_at = resume.uploaded_at if resume else None
    if uploaded_at is not None and uploaded_at.tzinfo is None:
        uploaded_at = uploaded_at.replace(tzinfo=timezone.utc)

    return {
        "blockers": blockers,
        "warnings": warnings,
        "match_score": match["score"],
        "matched_skills": match["matched_skills"],
        "missing_skills": match["missing_skills"],
        "resume": {
            "filename": resume.original_filename,
            "uploaded_at": uploaded_at.isoformat() if uploaded_at else None,
        } if resume else None,
    }
