from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.api.v1.dependencies import DbSession, get_current_user, require_roles
from app.core.config import get_settings
from app.models import CompanyProfile, Internship, Resume, StudentProfile, User, UserRole
from app.services.ai import (
    compute_ats_score,
    evaluate_mock_interview_answer,
    generate_mock_interview_questions,
    generate_tailored_pitch,
)
from app.services.pdf import extract_text_from_pdf

router = APIRouter(prefix="/ai", tags=["ai"])
student_only = Annotated[User, Depends(require_roles(UserRole.STUDENT))]


class EvaluateAnswerRequest(BaseModel):
    question: str
    answer: str = Field(min_length=3, max_length=5000)
    rubric: str = ""


@router.get("/internships/{internship_id}/ats-score")
async def get_ats_score(internship_id: int, user: student_only, db: DbSession) -> dict:
    internship = await db.scalar(select(Internship).where(Internship.id == internship_id))
    if internship is None:
        raise HTTPException(404, "Internship not found")

    student_prof = await db.scalar(select(StudentProfile).where(StudentProfile.user_id == user.id))
    student_skills = [s.strip() for s in (student_prof.skills if student_prof else "").split(",") if s.strip()]

    resume = await db.scalar(select(Resume).where(Resume.student_id == user.id))
    resume_text = ""
    if resume:
        resume_path = Path(get_settings().resume_storage_path) / resume.stored_filename
        if resume_path.is_file() and resume_path.suffix.lower() == ".pdf":
            resume_text = extract_text_from_pdf(resume_path)

    job_skills = [s.strip() for s in (internship.skills or "").split(",") if s.strip()]

    return compute_ats_score(
        resume_text=resume_text,
        student_skills=student_skills,
        job_title=internship.title,
        job_description=internship.description,
        job_skills=job_skills,
    )


@router.post("/internships/{internship_id}/generate-pitch")
async def generate_pitch(internship_id: int, user: student_only, db: DbSession) -> dict[str, str]:
    internship = await db.scalar(select(Internship).where(Internship.id == internship_id))
    if internship is None:
        raise HTTPException(404, "Internship not found")

    company_prof = await db.scalar(select(CompanyProfile).where(CompanyProfile.user_id == internship.company_id))
    company_name = company_prof.company_name if company_prof else "your esteemed organization"

    student_prof = await db.scalar(select(StudentProfile).where(StudentProfile.user_id == user.id))
    student_name = student_prof.full_name if student_prof else "Applicant"
    university = student_prof.university if student_prof else "University"
    major = student_prof.major if student_prof else "Student"
    skills = [s.strip() for s in (student_prof.skills if student_prof else "").split(",") if s.strip()]

    pitch = generate_tailored_pitch(
        student_name=student_name,
        university=university,
        major=major,
        skills=skills,
        bio=student_prof.bio if student_prof else None,
        job_title=internship.title,
        company_name=company_name,
        job_description=internship.description,
    )

    return {"pitch": pitch}


@router.get("/internships/{internship_id}/mock-interview")
async def get_mock_interview(internship_id: int, user: student_only, db: DbSession) -> dict:
    internship = await db.scalar(select(Internship).where(Internship.id == internship_id))
    if internship is None:
        raise HTTPException(404, "Internship not found")

    job_skills = [s.strip() for s in (internship.skills or "").split(",") if s.strip()]
    questions = generate_mock_interview_questions(
        job_title=internship.title,
        industry=internship.industry,
        skills=job_skills,
    )

    return {
        "internship_id": internship.id,
        "job_title": internship.title,
        "questions": questions,
    }


@router.post("/mock-interview/evaluate")
async def evaluate_answer(data: EvaluateAnswerRequest, user: student_only) -> dict:
    return evaluate_mock_interview_answer(
        question=data.question,
        answer=data.answer,
        rubric=data.rubric,
    )
