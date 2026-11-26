"""Company document upload and private access endpoints."""

import asyncio
from uuid import uuid4
from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select

from app.api.v1.dependencies import DbSession, require_roles
from app.core.config import get_settings
from app.models import CompanyDocument, CompanyProfile, User, UserRole
from app.services.asset_storage import asset_key, get_asset_storage, sanitize_filename
from app.services.company_documents import validate_company_document
from app.services.mail import send_dev_email
from app.services.notify import notify

router = APIRouter(prefix="/profiles/company/documents", tags=["company documents"])
company_only = Annotated[User, Depends(require_roles(UserRole.COMPANY))]  # type: ignore
ALLOWED_DOCUMENT_TYPES = {
    "BUSINESS_REGISTRATION",
    "GST_OR_PAN",
    "AUTHORIZATION_LETTER",
    "OTHER",
}
MAX_DOCUMENTS_PER_COMPANY = 5

def document_response(document: CompanyDocument) -> dict:
    """Build the public response fields for a company document without exposing its storage path."""
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
    """Validate and store a company verification document, enforcing allowed types and the per-company document limit."""
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
    original_filename = sanitize_filename(original_filename, fallback=f"document{extension}")
    content_type = file.content_type or ""
    stored_filename = f"{uuid4().hex}{extension}"
    key = asset_key("company_documents", stored_filename)
    storage_backend = get_settings().asset_storage_backend
    storage = get_asset_storage(storage_backend, settings=get_settings())
    await asyncio.to_thread(storage.save, key, content, content_type)

    document = CompanyDocument(
        company_id=user.id,
        document_type=clean_type,
        original_filename=original_filename,
        stored_filename=stored_filename,
        storage_key=key,
        storage_backend=storage_backend,
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
        await asyncio.to_thread(storage.delete, key)
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
    """List the authenticated company?s uploaded verification documents."""
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
) -> StreamingResponse:
    """Return a stored company document through an authenticated private stream."""
    document = await db.scalar(
        select(CompanyDocument).where(
            CompanyDocument.id == document_id,
            CompanyDocument.company_id == user.id,
        )
    )
    if document is None:
        raise HTTPException(status_code=404, detail="Company document not found.")
    key = document.storage_key or asset_key("company_documents", document.stored_filename)
    storage = get_asset_storage(document.storage_backend, settings=get_settings())
    if not await asyncio.to_thread(storage.exists, key):
        raise HTTPException(status_code=404, detail="Company document file not found.")
    stream = await asyncio.to_thread(storage.open_stream, key)
    filename = quote(sanitize_filename(document.original_filename, fallback="document"))
    return StreamingResponse(
        stream,
        media_type=document.content_type,
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{filename}"},
    )

@router.delete("/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_company_document(
    document_id: int,
    user: company_only,
    db: DbSession,
) -> None:
    """Remove a company document when deletion is allowed by the company verification state."""
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
    key = document.storage_key or asset_key("company_documents", document.stored_filename)
    storage = get_asset_storage(document.storage_backend, settings=get_settings())
    await asyncio.to_thread(storage.delete, key)
    await db.delete(document)
    await db.commit()
