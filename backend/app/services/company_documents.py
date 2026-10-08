"""Validation and private storage helpers for company verification documents."""

from pathlib import Path
import re

from fastapi import HTTPException, UploadFile, status

from app.core.config import get_settings

MAX_COMPANY_DOCUMENT_BYTES = 5 * 1024 * 1024
DOCUMENT_FORMATS = {
    ".pdf": ("application/pdf", b"%PDF-"),
    ".jpg": ("image/jpeg", b"\xff\xd8\xff"),
    ".jpeg": ("image/jpeg", b"\xff\xd8\xff"),
    ".png": ("image/png", b"\x89PNG\r\n\x1a\n"),
}
STORED_FILENAME_PATTERN = re.compile(r"^[a-f0-9]{32}\.(pdf|jpg|jpeg|png)$")


async def validate_company_document(upload: UploadFile) -> tuple[bytes, str, str]:
    filename = (upload.filename or "").replace("\\", "/").rsplit("/", 1)[-1]
    extension = Path(filename).suffix.lower()
    format_info = DOCUMENT_FORMATS.get(extension)
    content_type = (upload.content_type or "").lower().strip()
    if format_info is None or content_type != format_info[0]:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Company documents must be PDF, JPG, or PNG with a matching content type.",
        )
    if (
        not filename
        or len(filename) > 255
        or any(ord(character) < 32 for character in filename)
    ):
        raise HTTPException(status_code=400, detail="A valid document filename is required.")

    content = await upload.read(MAX_COMPANY_DOCUMENT_BYTES + 1)
    if len(content) > MAX_COMPANY_DOCUMENT_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Company document exceeds the 5 MB size limit.",
        )
    if not content.startswith(format_info[1]):
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="The uploaded file content does not match its extension and content type.",
        )
    return content, filename, extension


def company_document_path(stored_filename: str) -> Path:
    if not STORED_FILENAME_PATTERN.fullmatch(stored_filename):
        raise HTTPException(status_code=404, detail="Company document file not found.")
    storage = Path(get_settings().company_document_storage_path).resolve()
    path = (storage / stored_filename).resolve()
    if path.parent != storage:
        raise HTTPException(status_code=404, detail="Company document file not found.")
    return path
