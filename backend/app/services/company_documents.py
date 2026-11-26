"""Validation and private storage helpers for company verification documents."""

from pathlib import Path

from fastapi import HTTPException, UploadFile, status

MAX_COMPANY_DOCUMENT_BYTES = 5 * 1024 * 1024
DOCUMENT_FORMATS = {
    ".pdf": ("application/pdf", b"%PDF-"),
    ".jpg": ("image/jpeg", b"\xff\xd8\xff"),
    ".jpeg": ("image/jpeg", b"\xff\xd8\xff"),
    ".png": ("image/png", b"\x89PNG\r\n\x1a\n"),
}


async def validate_company_document(upload: UploadFile) -> tuple[bytes, str, str]:
    """Read and validate a PDF/JPG/PNG upload; return its bytes, basename, and normalized extension."""
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
