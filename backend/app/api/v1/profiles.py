from pathlib import Path
from uuid import uuid4
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import delete, select

from app.api.v1.dependencies import DbSession, require_roles
from app.core.config import get_settings
from app.models import Application, CompanyProfile, Internship, Resume, StudentProfile, User, UserRole
from app.schemas.profile import CompanyProfileUpdate, ProfileResponse, ResumeResponse, StudentProfileUpdate

router = APIRouter(prefix="/profiles", tags=["profiles"])
student_only = Annotated[User, Depends(require_roles(UserRole.STUDENT))]
company_only = Annotated[User, Depends(require_roles(UserRole.COMPANY))]
ALLOWED_TYPES = {"application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"}
ALLOWED_EXTENSIONS = {".pdf", ".doc", ".docx"}


def assert_resume_access(user: User, resume: Resume, company_has_application: bool = False) -> None:
    if user.role == UserRole.STUDENT and resume.student_id != user.id:
        raise HTTPException(403, "You can only access your own resume")
    if user.role == UserRole.COMPANY and not company_has_application:
        raise HTTPException(403, "Resume access requires an application to your internship")


def profile_response(profile: StudentProfile | CompanyProfile) -> ProfileResponse:
    return ProfileResponse.model_validate(profile, from_attributes=True)


@router.get("/student", response_model=ProfileResponse)
async def get_student_profile(user: student_only, db: DbSession) -> ProfileResponse:
    profile = await db.scalar(select(StudentProfile).where(StudentProfile.user_id == user.id))
    if profile is None:
        raise HTTPException(404, "Student profile not found")
    return profile_response(profile)


@router.put("/student", response_model=ProfileResponse)
async def update_student_profile(data: StudentProfileUpdate, user: student_only, db: DbSession) -> ProfileResponse:
    profile = await db.scalar(select(StudentProfile).where(StudentProfile.user_id == user.id))
    if profile is None:
        profile = StudentProfile(user_id=user.id, **data.model_dump())
        db.add(profile)
    else:
        for key, value in data.model_dump().items():
            setattr(profile, key, value)
    await db.commit()
    await db.refresh(profile)
    return profile_response(profile)


@router.delete("/student", status_code=204)
async def delete_student_profile(user: student_only, db: DbSession) -> None:
    await db.execute(delete(StudentProfile).where(StudentProfile.user_id == user.id))
    await db.commit()


@router.get("/company", response_model=ProfileResponse)
async def get_company_profile(user: company_only, db: DbSession) -> ProfileResponse:
    profile = await db.scalar(select(CompanyProfile).where(CompanyProfile.user_id == user.id))
    if profile is None:
        raise HTTPException(404, "Company profile not found")
    return profile_response(profile)


@router.put("/company", response_model=ProfileResponse)
async def update_company_profile(data: CompanyProfileUpdate, user: company_only, db: DbSession) -> ProfileResponse:
    profile = await db.scalar(select(CompanyProfile).where(CompanyProfile.user_id == user.id))
    if profile is None:
        profile = CompanyProfile(user_id=user.id, **data.model_dump())
        db.add(profile)
    else:
        for key, value in data.model_dump().items():
            setattr(profile, key, value)
    await db.commit()
    await db.refresh(profile)
    return profile_response(profile)


@router.delete("/company", status_code=204)
async def delete_company_profile(user: company_only, db: DbSession) -> None:
    await db.execute(delete(CompanyProfile).where(CompanyProfile.user_id == user.id))
    await db.commit()


async def validate_resume(upload: UploadFile) -> bytes:
    extension = Path(upload.filename or "").suffix.lower()
    if extension not in ALLOWED_EXTENSIONS or upload.content_type not in ALLOWED_TYPES:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "Resume must be PDF, DOC, or DOCX")
    content = await upload.read(get_settings().max_resume_size_mb * 1024 * 1024 + 1)
    if len(content) > get_settings().max_resume_size_mb * 1024 * 1024:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Resume exceeds the size limit")
    return content


@router.post("/student/resume", response_model=ResumeResponse)
async def upload_resume(user: student_only, db: DbSession, file: UploadFile = File(...)) -> Resume:
    content = await validate_resume(file)
    existing = await db.scalar(select(Resume).where(Resume.student_id == user.id))
    storage = Path(get_settings().resume_storage_path)
    storage.mkdir(parents=True, exist_ok=True)
    stored_name = f"{uuid4().hex}{Path(file.filename or '').suffix.lower()}"
    (storage / stored_name).write_bytes(content)
    if existing:
        old_path = storage / existing.stored_filename
        old_path.unlink(missing_ok=True)
        existing.original_filename, existing.stored_filename = file.filename or stored_name, stored_name
        existing.content_type, existing.file_size = file.content_type or "application/octet-stream", len(content)
        resume = existing
    else:
        resume = Resume(student_id=user.id, original_filename=file.filename or stored_name, stored_filename=stored_name, content_type=file.content_type or "application/octet-stream", file_size=len(content))
        db.add(resume)
    await db.commit()
    await db.refresh(resume)
    return resume


async def get_resume_for_user(resume_id: int, user: User, db: DbSession) -> Resume:
    resume = await db.scalar(select(Resume).where(Resume.id == resume_id))
    if resume is None:
        raise HTTPException(404, "Resume not found")
    if user.role == UserRole.COMPANY:
        allowed = await db.scalar(select(Application.id).join(Internship, Application.internship_id == Internship.id).where(Application.student_id == resume.student_id, Internship.company_id == user.id))
        assert_resume_access(user, resume, allowed is not None)
    else:
        assert_resume_access(user, resume)
    return resume


@router.get("/student/resume", response_model=ResumeResponse)
async def get_my_resume(user: student_only, db: DbSession) -> Resume:
    resume = await db.scalar(select(Resume).where(Resume.student_id == user.id))
    if resume is None:
        raise HTTPException(404, "No resume uploaded")
    return resume


@router.get("/resume/{resume_id}", response_model=ResumeResponse)
async def resume_metadata(resume_id: int, user: Annotated[User, Depends(require_roles(UserRole.STUDENT, UserRole.COMPANY))], db: DbSession) -> Resume:
    return await get_resume_for_user(resume_id, user, db)


@router.get("/resume/{resume_id}/download")
async def download_resume(resume_id: int, user: Annotated[User, Depends(require_roles(UserRole.STUDENT, UserRole.COMPANY))], db: DbSession) -> FileResponse:
    resume = await get_resume_for_user(resume_id, user, db)
    path = Path(get_settings().resume_storage_path) / resume.stored_filename
    if not path.is_file():
        raise HTTPException(404, "Resume file not found")
    return FileResponse(path, media_type=resume.content_type, filename=resume.original_filename)


@router.delete("/student/resume/{resume_id}", status_code=204)
async def delete_resume(resume_id: int, user: student_only, db: DbSession) -> None:
    resume = await get_resume_for_user(resume_id, user, db)
    (Path(get_settings().resume_storage_path) / resume.stored_filename).unlink(missing_ok=True)
    await db.delete(resume)
    await db.commit()