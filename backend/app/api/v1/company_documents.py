"""Company document upload and private access endpoints."""

from uuid import uuid4
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import func, select

from app.api.v1.dependencies import DbSession, require_roles
from app.models import CompanyDocument, CompanyProfile, User, UserRole
from app.services.company_documents import company_document_path, validate_company_document
from app.services.mail import send_dev_email
from app.services.notify import notify

router = APIRouter(prefix="/profiles/company/documents", tags=["company documents"])
company_only = Annotated[User, Depends(require_roles(UserRole.COMPANY))]
ALLOWED_DOCUMENT_TYPES = {
    "BUSINESS_REGISTRATION",
    "GST_OR_PAN",
    "AUTHORIZATION_LETTER",
    "OTHER",
}
MAX_DOCUMENTS_PER_COMPANY = 5


def document_response(document: CompanyDocument) -> dict:
    return {
        "id": document.id,
        "company_id": document.company_id,
        "document_type": document.document_type,
        "original_filename": document.original_filename,
        "content_type": document.content_type,
        "file_size": document.file_size,
        "created_at": document.created_at,
    }


@router.post("", status_code=status.HTTP_201_CREATED)
async def upload_company_document(
    user: company_only,
    db: DbSession,
    file: UploadFile = File(...),
    document_type: str = Form(...),
) -> dict:
    clean_type = document_type.strip().upper()
    if clean_type not in ALLOWED_DOCUMENT_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Document type must be one of: {', '.join(sorted(ALLOWED_DOCUMENT_TYPES))}.",
        )

    await db.scalar(select(User.id).where(User.id == user.id).with_for_update())
    count = await db.scalar(
        select(func.count()).select_from(CompanyDocument).where(CompanyDocument.company_id == user.id)
    )
    if (count or 0) >= MAX_DOCUMENTS_PER_COMPANY:
        raise HTTPException(status_code=400, detail="A company may upload no more than 5 verification documents.")

    content, original_filename, extension = await validate_company_document(file)
    content_type = file.content_type or ""
    stored_filename = f"{uuid4().hex}{extension}"
    path = company_document_path(stored_filename)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("xb") as stored_file:
        stored_file.write(content)

    document = CompanyDocument(
        company_id=user.id,
        document_type=clean_type,
        original_filename=original_filename,
        stored_filename=stored_filename,
        content_type=content_type,
        file_size=len(content),
    )
    try:
        db.add(document)
        profile = await db.scalar(select(CompanyProfile).where(CompanyProfile.user_id == user.id))
        if profile is not None and profile.verification_status == "REJECTED":
            profile.verification_status = "PENDING"
            profile.verification_note = None

        admins = list(await db.scalars(select(User).where(User.role == UserRole.ADMIN)))
        for admin in admins:
            await notify(
                db,
                admin.id,
                "COMPANY_DOCUMENT_UPLOADED",
                "Company verification document uploaded",
                f"{user.email} uploaded a {clean_type.replace('_', ' ').lower()} document for review.",
            )
        await db.commit()
        await db.refresh(document)
    except BaseException:
        await db.rollback()
        path.unlink(missing_ok=True)
        raise
    for admin in admins:
        await send_dev_email(
            admin.email,
            "Company verification document uploaded",
            f"{user.email} uploaded a {clean_type.replace('_', ' ').lower()} document for review.",
            message_type="COMPANY_DOCUMENT_UPLOADED",
            db=db,
        )
    return document_response(document)


@router.get("")
async def list_company_documents(user: company_only, db: DbSession) -> list[dict]:
    documents = await db.scalars(
        select(CompanyDocument)
        .where(CompanyDocument.company_id == user.id)
        .order_by(CompanyDocument.created_at.desc(), CompanyDocument.id.desc())
    )
    return [document_response(document) for document in documents]


@router.get("/{document_id}/download")
async def download_company_document(
    document_id: int,
    user: company_only,
    db: DbSession,
) -> FileResponse:
    document = await db.scalar(
        select(CompanyDocument).where(
            CompanyDocument.id == document_id,
            CompanyDocument.company_id == user.id,
        )
    )
    if document is None:
        raise HTTPException(status_code=404, detail="Company document not found.")
    path = company_document_path(document.stored_filename)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Company document file not found.")
    return FileResponse(path, media_type=document.content_type, filename=document.original_filename)


@router.delete("/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_company_document(
    document_id: int,
    user: company_only,
    db: DbSession,
) -> None:
    document = await db.scalar(
        select(CompanyDocument).where(
            CompanyDocument.id == document_id,
            CompanyDocument.company_id == user.id,
        )
    )
    if document is None:
        raise HTTPException(status_code=404, detail="Company document not found.")
    profile = await db.scalar(
        select(CompanyProfile).where(CompanyProfile.user_id == user.id)
    )
    if profile is not None and profile.verification_status == "VERIFIED":
        raise HTTPException(
            status_code=400,
            detail="Company verification documents cannot be deleted after verification.",
        )
    path = company_document_path(document.stored_filename)
    await db.delete(document)
    await db.commit()
    try:
        path.unlink(missing_ok=True)
    except OSError:
        pass
