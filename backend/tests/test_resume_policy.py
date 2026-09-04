import pytest
from fastapi import HTTPException

from app.api.v1.profiles import assert_resume_access, validate_resume
from app.models import Resume, User, UserRole


class FakeUpload:
    def __init__(self, filename: str, content_type: str, content: bytes):
        self.filename = filename
        self.content_type = content_type
        self._content = content

    async def read(self, limit: int) -> bytes:
        return self._content[:limit]


@pytest.mark.anyio
async def test_resume_rejects_unsupported_extension() -> None:
    with pytest.raises(HTTPException) as error:
        await validate_resume(FakeUpload("resume.exe", "application/octet-stream", b"bad"))
    assert error.value.status_code == 415


@pytest.mark.anyio
async def test_resume_rejects_oversized_file(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.core.config import get_settings
    get_settings.cache_clear()
    monkeypatch.setenv("MAX_RESUME_SIZE_MB", "1")
    with pytest.raises(HTTPException) as error:
        await validate_resume(FakeUpload("resume.pdf", "application/pdf", b"x" * (5 * 1024 * 1024)))
    assert error.value.status_code == 413


def test_resume_access_is_owner_or_applied_company_only() -> None:
    resume = Resume(id=1, student_id=10, original_filename="cv.pdf", stored_filename="stored.pdf", content_type="application/pdf", file_size=3)
    assert_resume_access(User(id=10, role=UserRole.STUDENT), resume)
    with pytest.raises(HTTPException) as student_error:
        assert_resume_access(User(id=11, role=UserRole.STUDENT), resume)
    assert student_error.value.status_code == 403
    with pytest.raises(HTTPException) as company_error:
        assert_resume_access(User(id=20, role=UserRole.COMPANY), resume)
    assert company_error.value.status_code == 403
    assert_resume_access(User(id=20, role=UserRole.COMPANY), resume, company_has_application=True)