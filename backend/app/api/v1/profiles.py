# -----------------------------------------------------------------------------
# Profile endpoints for student, company, and user profile management.
# -----------------------------------------------------------------------------

from datetime import datetime, timezone
import asyncio
from pathlib import Path
from uuid import uuid4
from typing import Annotated, Any
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import RedirectResponse, StreamingResponse
from sqlalchemy import delete, or_, select

from app.api.v1.dependencies import DbSession, require_roles
from app.core.config import get_settings
from app.models import Application, CompanyProfile, Internship, Resume, StudentProfile, User, UserRole
from app.schemas.profile import CompanyProfileUpdate, ProfileResponse, ResumeResponse, StudentHandlesUpdate, StudentProfileUpdate
from app.services.application_events import record_event
from app.services.asset_storage import (
    asset_key,
    delete_asset_after_commit,
    get_asset_storage,
    legacy_avatar_key,
    materialize_asset,
    sanitize_filename,
)

router = APIRouter(prefix="/profiles", tags=["profiles"])
student_only = Annotated[User, Depends(require_roles(UserRole.STUDENT))] # type: ignore
company_only = Annotated[User, Depends(require_roles(UserRole.COMPANY))] # type: ignore
ALLOWED_TYPES = {"application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"}
ALLOWED_EXTENSIONS = {".pdf", ".doc", ".docx"}
RESUME_CONTENT_TYPES = {
    ".pdf": "application/pdf",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}


def assert_resume_access(user: User, resume: Resume, company_has_application: bool = False) -> None:
    """Enforce student ownership or the company-application relationship required to access a resume."""
    if user.role == UserRole.STUDENT and resume.student_id != user.id:
        raise HTTPException(403, "You can only access your own resume")
    if user.role == UserRole.COMPANY and not company_has_application:
        raise HTTPException(403, "Resume access requires an application to your internship")


def profile_response(profile: StudentProfile | CompanyProfile) -> ProfileResponse:
    """Validate a profile ORM object into the shared profile response schema."""
    return ProfileResponse.model_validate(profile, from_attributes=True)


@router.get("/student", response_model=ProfileResponse)
async def get_student_profile(user: student_only, db: DbSession) -> ProfileResponse:
    """Return the authenticated student?s profile or a not-found response."""
    profile = await db.scalar(select(StudentProfile).where(StudentProfile.user_id == user.id))
    if profile is None:
        raise HTTPException(404, "Student profile not found")
    return profile_response(profile)


@router.put("/student", response_model=ProfileResponse)
async def update_student_profile(data: StudentProfileUpdate, user: student_only, db: DbSession) -> ProfileResponse:
    """Apply the supplied changes to the authenticated student?s profile and return it."""
    profile = await db.scalar(select(StudentProfile).where(StudentProfile.user_id == user.id))
    if profile is None:
        profile = StudentProfile(user_id=user.id, **data.model_dump())
        db.add(profile)
    else:
        for key, value in data.model_dump(exclude_unset=True).items():
            setattr(profile, key, value)
    await db.commit()
    await db.refresh(profile)
    return profile_response(profile)


@router.put("/student/handles", response_model=ProfileResponse)
async def update_student_handles(data: StudentHandlesUpdate, user: student_only, db: DbSession) -> ProfileResponse:
    """Persist the authenticated student's GitHub and LeetCode usernames."""
    profile = await db.scalar(select(StudentProfile).where(StudentProfile.user_id == user.id))
    if profile is None:
        raise HTTPException(404, "Student profile not found")
    profile.github_username = data.github_username
    profile.leetcode_username = data.leetcode_username
    await db.commit()
    await db.refresh(profile)
    return profile_response(profile)


@router.delete("/student", status_code=204)
async def delete_student_profile(user: student_only, db: DbSession) -> None:
    """Delete the authenticated student?s profile record."""
    profile = await db.scalar(select(StudentProfile).where(StudentProfile.user_id == user.id))
    storage_key = (
        profile.avatar_storage_key
        or legacy_avatar_key(profile.avatar_url)
        if profile
        else None
    )
    backend = profile.avatar_storage_backend if profile else None
    if storage_key:
        await asyncio.to_thread(
            get_asset_storage(backend or "local", settings=get_settings()).delete,
            storage_key,
        )
    await db.execute(delete(StudentProfile).where(StudentProfile.user_id == user.id))
    await db.commit()


@router.get("/company", response_model=ProfileResponse)
async def get_company_profile(user: company_only, db: DbSession) -> ProfileResponse:
    """Return the authenticated company?s profile or a not-found response."""
    profile = await db.scalar(select(CompanyProfile).where(CompanyProfile.user_id == user.id))
    if profile is None:
        raise HTTPException(404, "Company profile not found")
    return profile_response(profile)


@router.put("/company", response_model=ProfileResponse)
async def update_company_profile(data: CompanyProfileUpdate, user: company_only, db: DbSession) -> ProfileResponse:
    """Apply the supplied changes to the authenticated company?s profile and return it."""
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
    """Delete the authenticated company?s profile record."""
    profile = await db.scalar(select(CompanyProfile).where(CompanyProfile.user_id == user.id))
    storage_key = (
        profile.avatar_storage_key
        or legacy_avatar_key(profile.avatar_url)
        if profile
        else None
    )
    backend = profile.avatar_storage_backend if profile else None
    if storage_key:
        await asyncio.to_thread(
            get_asset_storage(backend or "local", settings=get_settings()).delete,
            storage_key,
        )
    await db.execute(delete(CompanyProfile).where(CompanyProfile.user_id == user.id))
    await db.commit()


async def validate_resume(upload: UploadFile) -> bytes:
    """Read and validate a resume upload against the supported file types and configured size limit."""
    filename = (upload.filename or "").replace("\\", "/").rsplit("/", 1)[-1]
    extension = Path(filename).suffix.lower()
    if (
        extension not in ALLOWED_EXTENSIONS
        or upload.content_type not in ALLOWED_TYPES
        or upload.content_type != RESUME_CONTENT_TYPES[extension]
    ):
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "Resume must be PDF, DOC, or DOCX")
    content = await upload.read(get_settings().max_resume_size_mb * 1024 * 1024 + 1)
    if len(content) > get_settings().max_resume_size_mb * 1024 * 1024:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Resume exceeds the size limit")
    return content


@router.post("/student/resume", response_model=ResumeResponse)
async def upload_resume(user: student_only, db: DbSession, file: UploadFile = File(...)) -> Resume:
    """Validate and store the authenticated student?s resume, replacing an existing resume when present."""
    content = await validate_resume(file)
    existing = await db.scalar(select(Resume).where(Resume.student_id == user.id))
    extension = Path((file.filename or "").replace("\\", "/")).suffix.lower()
    stored_name = f"{uuid4().hex}{extension}"
    key = asset_key("resumes", stored_name)
    backend = get_settings().asset_storage_backend
    storage = get_asset_storage(backend, settings=get_settings())
    await asyncio.to_thread(
        storage.save,
        key,
        content,
        file.content_type or "application/octet-stream",
    )
    old_key = existing.storage_key if existing else None
    old_backend = existing.storage_backend if existing else None
    try:
        if existing:
            existing.original_filename = sanitize_filename(file.filename, fallback=stored_name)
            existing.stored_filename = stored_name
            existing.storage_key = key
            existing.storage_backend = backend
            existing.content_type = file.content_type or "application/octet-stream"
            existing.file_size = len(content)
            existing.uploaded_at = datetime.now(timezone.utc)
            resume = existing
        else:
            resume = Resume(
                student_id=user.id,
                original_filename=sanitize_filename(file.filename, fallback=stored_name),
                stored_filename=stored_name,
                storage_key=key,
                storage_backend=backend,
                content_type=file.content_type or "application/octet-stream",
                file_size=len(content),
            )
            db.add(resume)
        await db.commit()
        await db.refresh(resume)
    except BaseException:
        await db.rollback()
        await asyncio.to_thread(storage.delete, key)
        raise
    if old_key and old_key != key:
        await asyncio.to_thread(
            delete_asset_after_commit,
            get_asset_storage(old_backend or "local", settings=get_settings()),
            old_key,
        )
    return resume


async def get_resume_for_user(resume_id: int, user: User, db: DbSession) -> Resume:
    """Load a resume after enforcing role-specific student ownership or company access."""
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
    """Return the authenticated student?s resume record, or not found when none exists."""
    resume = await db.scalar(select(Resume).where(Resume.student_id == user.id))
    if resume is None:
        raise HTTPException(404, "No resume uploaded")
    return resume


@router.get("/resume/{resume_id}", response_model=ResumeResponse)
async def resume_metadata(resume_id: int, user: Annotated[User, Depends(require_roles(UserRole.STUDENT, UserRole.COMPANY))], db: DbSession) -> Resume:   # type: ignore
    """Return metadata for a resume the current user may access without streaming its contents."""
    resume = await get_resume_for_user(resume_id, user, db)
    if user.role == UserRole.COMPANY:
        matching_apps = list(await db.scalars(
            select(Application)
            .join(Internship, Application.internship_id == Internship.id)
            .where(Application.student_id == resume.student_id, Internship.company_id == user.id)
        ))
        for app in matching_apps:
            await record_event(db, app.id, "RESUME_VIEWED", user.id, once=True)
        await db.commit()
    return resume


@router.get("/resume/{resume_id}/download")
async def download_resume(resume_id: int, user: Annotated[User, Depends(require_roles(UserRole.STUDENT, UserRole.COMPANY))], db: DbSession) -> StreamingResponse:   # type: ignore
    """Stream a stored resume file after enforcing the caller?s access and confirming the file exists."""
    resume = await get_resume_for_user(resume_id, user, db)
    if user.role == UserRole.COMPANY:
        matching_apps = list(await db.scalars(
            select(Application)
            .join(Internship, Application.internship_id == Internship.id)
            .where(Application.student_id == resume.student_id, Internship.company_id == user.id)
        ))
        for app in matching_apps:
            await record_event(db, app.id, "RESUME_VIEWED", user.id, once=True)
        await db.commit()
    key = resume.storage_key or asset_key("resumes", resume.stored_filename)
    storage = get_asset_storage(resume.storage_backend, settings=get_settings())
    if not await asyncio.to_thread(storage.exists, key):
        raise HTTPException(404, "Resume file not found")
    filename = quote(sanitize_filename(resume.original_filename, fallback="resume"))
    stream = await asyncio.to_thread(storage.open_stream, key)
    return StreamingResponse(
        stream,
        media_type=resume.content_type,
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{filename}"},
    )


@router.delete("/student/resume/{resume_id}", status_code=204)
async def delete_resume(resume_id: int, user: student_only, db: DbSession) -> None:
    """Delete the accessible resume record and its stored file."""
    resume = await get_resume_for_user(resume_id, user, db)
    key = resume.storage_key or asset_key("resumes", resume.stored_filename)
    storage = get_asset_storage(resume.storage_backend, settings=get_settings())
    await asyncio.to_thread(storage.delete, key)
    await db.delete(resume)
    await db.commit()


@router.post("/student/resume/parse")
async def parse_student_resume(user: student_only, db: DbSession) -> dict[str, Any]:
    """Extract structured resume details from the authenticated student?s stored PDF resume."""
    resume = await db.scalar(select(Resume).where(Resume.student_id == user.id))
    if resume is None:
        raise HTTPException(404, "No resume uploaded yet. Please upload a resume first.")

    from app.services.resume_parser import parse_resume_pdf
    key = resume.storage_key or asset_key("resumes", resume.stored_filename)
    storage = get_asset_storage(resume.storage_backend, settings=get_settings())
    if not await asyncio.to_thread(storage.exists, key):
        raise HTTPException(404, "Resume file not found")

    def parse():
        with materialize_asset(
            storage, key, Path(resume.original_filename).suffix.lower()
        ) as path:
            return parse_resume_pdf(path)

    parsed = await asyncio.to_thread(parse)
    return {
        "success": True,
        "filename": resume.original_filename,
        "extracted_skills": parsed["skills"],
        "extracted_education": {
            "university": parsed["university"],
            "major": parsed["major"],
            "graduation_year": parsed["graduation_year"],
        },
        "extracted_bio": parsed["bio"],
        "raw_text_length": parsed["raw_length"],
    }


@router.post("/student/resume/apply-parsed")
async def apply_parsed_resume_to_profile(user: student_only, db: DbSession) -> dict[str, Any]:
    """Parse the student?s resume and apply extracted profile fields, returning the fields updated."""
    resume = await db.scalar(select(Resume).where(Resume.student_id == user.id))
    if resume is None:
        raise HTTPException(404, "No resume uploaded yet")

    from app.services.resume_parser import parse_resume_pdf
    key = resume.storage_key or asset_key("resumes", resume.stored_filename)
    storage = get_asset_storage(resume.storage_backend, settings=get_settings())
    if not await asyncio.to_thread(storage.exists, key):
        raise HTTPException(404, "Resume file not found")

    def parse():
        with materialize_asset(
            storage, key, Path(resume.original_filename).suffix.lower()
        ) as path:
            return parse_resume_pdf(path)

    parsed = await asyncio.to_thread(parse)

    profile = await db.scalar(select(StudentProfile).where(StudentProfile.user_id == user.id))
    if profile is None:
        raise HTTPException(404, "Student profile not found")

    updated_fields = []
    if parsed["skills"]:
        current_skills = {s.strip() for s in profile.skills.split(",") if s.strip()}
        merged_skills = sorted(list(current_skills.union(set(parsed["skills"]))))
        profile.skills = ", ".join(merged_skills)
        updated_fields.append("skills")

    if parsed["university"] and (not profile.university or profile.university in ("University", "")):
        profile.university = parsed["university"]
        updated_fields.append("university")

    if parsed["major"] and (not profile.major or profile.major in ("Student", "")):
        profile.major = parsed["major"]
        updated_fields.append("major")

    if parsed["graduation_year"]:
        profile.graduation_year = parsed["graduation_year"]
        updated_fields.append("graduation_year")

    if parsed["bio"] and not profile.bio:
        profile.bio = parsed["bio"]
        updated_fields.append("bio")

    await db.commit()
    await db.refresh(profile)

    return {
        "success": True,
        "updated_fields": updated_fields,
        "profile": profile_response(profile),
    }



ALLOWED_AVATAR_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".svg", ".gif"}
ALLOWED_AVATAR_TYPES = {"image/jpeg", "image/png", "image/webp", "image/svg+xml", "image/gif"}
MAX_AVATAR_SIZE_BYTES = 5 * 1024 * 1024


@router.post("/avatar")
async def upload_avatar(
    user: Annotated[User, Depends(require_roles(UserRole.STUDENT, UserRole.COMPANY))], # type: ignore
    db: DbSession,
    file: UploadFile = File(...),
) -> dict[str, str]:
    """Validate and store the user?s avatar image within the supported format and size limits."""
    filename = (file.filename or "").replace("\\", "/").rsplit("/", 1)[-1]
    ext = Path(filename).suffix.lower()
    avatar_content_types = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
        ".svg": "image/svg+xml",
        ".gif": "image/gif",
    }
    if (
        ext not in ALLOWED_AVATAR_EXTENSIONS
        or avatar_content_types[ext] not in ALLOWED_AVATAR_TYPES
        or file.content_type != avatar_content_types[ext]
    ):
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "Avatar must be a JPEG, PNG, WEBP, or SVG image")

    content = await file.read(MAX_AVATAR_SIZE_BYTES + 1)
    if len(content) > MAX_AVATAR_SIZE_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Image exceeds 5MB size limit")

    stored_name = f"avatar_{user.id}_{uuid4().hex}{ext}"
    key = asset_key("avatars", stored_name)
    backend = get_settings().asset_storage_backend
    storage = get_asset_storage(backend, settings=get_settings())
    await asyncio.to_thread(
        storage.save, key, content, file.content_type or "application/octet-stream"
    )

    old_key = None
    old_backend = None
    if user.role == UserRole.STUDENT:
        profile = await db.scalar(select(StudentProfile).where(StudentProfile.user_id == user.id))
        if profile is None:
            profile = StudentProfile(
                user_id=user.id,
                full_name=user.email.split("@")[0].title(),
                university="University",
                major="Computer Science",
                graduation_year=2026,
            )
            db.add(profile)
        old_key = profile.avatar_storage_key
        old_backend = profile.avatar_storage_backend
        profile.avatar_url = f"/api/v1/profiles/avatar/{stored_name}"
        profile.avatar_storage_key = key
        profile.avatar_storage_backend = backend
    elif user.role == UserRole.COMPANY:
        profile = await db.scalar(select(CompanyProfile).where(CompanyProfile.user_id == user.id))
        if profile is None:
            profile = CompanyProfile(
                user_id=user.id,
                company_name=user.email.split("@")[0].title(),
                industry="Technology",
            )
            db.add(profile)
        old_key = profile.avatar_storage_key
        old_backend = profile.avatar_storage_backend
        profile.avatar_url = f"/api/v1/profiles/avatar/{stored_name}"
        profile.avatar_storage_key = key
        profile.avatar_storage_backend = backend

    try:
        await db.commit()
    except BaseException:
        await db.rollback()
        await asyncio.to_thread(storage.delete, key)
        raise
    if old_key and old_key != key:
        await asyncio.to_thread(
            delete_asset_after_commit,
            get_asset_storage(old_backend or "local", settings=get_settings()),
            old_key,
        )
    return {"avatar_url": f"/api/v1/profiles/avatar/{stored_name}"}


@router.get("/avatar/{filename}")
async def get_avatar(filename: str, db: DbSession):
    """Serve a profile avatar through local storage or a short-lived private S3 URL."""
    clean_filename = sanitize_filename(filename, fallback="avatar")
    if clean_filename != filename or Path(clean_filename).suffix.lower() not in ALLOWED_AVATAR_EXTENSIONS:
        raise HTTPException(404, "Avatar not found")
    key = asset_key("avatars", clean_filename)
    student_profile = await db.scalar(
        select(StudentProfile).where(
            or_(
                StudentProfile.avatar_storage_key == key,
                StudentProfile.avatar_url.endswith(
                    f"/api/v1/profiles/avatar/{clean_filename}"
                ),
            )
        )
    )
    company_profile = None
    if student_profile is None:
        company_profile = await db.scalar(
            select(CompanyProfile).where(
                or_(
                    CompanyProfile.avatar_storage_key == key,
                    CompanyProfile.avatar_url.endswith(
                        f"/api/v1/profiles/avatar/{clean_filename}"
                    ),
                )
            )
        )
    profile = student_profile or company_profile
    if profile is None:
        raise HTTPException(404, "Avatar not found")
    key = profile.avatar_storage_key or legacy_avatar_key(profile.avatar_url) or key
    storage = get_asset_storage(
        profile.avatar_storage_backend or "local", settings=get_settings()
    )
    if not await asyncio.to_thread(storage.exists, key):
        raise HTTPException(404, "Avatar not found")

    content_types = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
        ".svg": "image/svg+xml",
        ".gif": "image/gif",
    }
    content_type = content_types.get(
        Path(clean_filename).suffix.lower(), "application/octet-stream"
    )
    signed_url = getattr(storage, "signed_url", None)
    if signed_url is not None:
        url = await asyncio.to_thread(signed_url, key, 300)
        return RedirectResponse(
            url,
            headers={
                "Cache-Control": "private, max-age=300",
                "X-Content-Type-Options": "nosniff",
            },
        )
    stream = await asyncio.to_thread(storage.open_stream, key)
    return StreamingResponse(
        stream,
        media_type=content_type,
        headers={
            "Cache-Control": "public, max-age=300",
            "Content-Security-Policy": "sandbox; default-src 'none'",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.delete("/avatar")
async def delete_avatar(
    user: Annotated[User, Depends(require_roles(UserRole.STUDENT, UserRole.COMPANY))],  # type: ignore
    db: DbSession,
) -> dict[str, Any]:
    """Remove the current user?s avatar file and clear its profile URL."""
    if user.role == UserRole.STUDENT:
        profile = await db.scalar(select(StudentProfile).where(StudentProfile.user_id == user.id))
    else:
        profile = await db.scalar(select(CompanyProfile).where(CompanyProfile.user_id == user.id))

    if profile and (profile.avatar_url or profile.avatar_storage_key):
        key = profile.avatar_storage_key or legacy_avatar_key(profile.avatar_url)
        if key is None:
            profile.avatar_url = None
            profile.avatar_storage_key = None
            profile.avatar_storage_backend = None
            await db.commit()
            return {"message": "Avatar removed", "avatar_url": None}
        storage = get_asset_storage(
            profile.avatar_storage_backend or "local", settings=get_settings()
        )
        await asyncio.to_thread(storage.delete, key)
        profile.avatar_url = None
        profile.avatar_storage_key = None
        profile.avatar_storage_backend = None
        await db.commit()
    return {"message": "Avatar removed", "avatar_url": None}