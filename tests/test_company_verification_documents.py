from __future__ import annotations

from datetime import date

import pyotp
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.v1 import admin, auth, company_documents
from app.api.v1.dependencies import get_current_user, get_db
from app.core.config import Settings
from app.core.security import hash_password
from app.main import app
from app.models import (
    AuditLog,
    CompanyDocument,
    CompanyProfile,
    Internship,
    Notification,
    User,
    UserRole,
)
from app.models.base import Base
from app.services.account_deletion import erase_user


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture
async def api_context():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    async def override_db():
        async with sessions() as session:
            yield session

    app.dependency_overrides[get_db] = override_db
    client = AsyncClient(transport=ASGITransport(app=app), base_url="http://test")
    yield client, sessions
    await client.aclose()
    app.dependency_overrides.clear()
    await engine.dispose()


def make_user(user_id: int, role: UserRole, email: str) -> User:
    return User(
        id=user_id,
        email=email,
        password_hash="unused",
        role=role,
        is_active=True,
        is_verified=True,
    )


@pytest.mark.anyio
async def test_company_document_access_review_and_cleanup(api_context, monkeypatch, tmp_path):
    client, sessions = api_context
    company = make_user(20, UserRole.COMPANY, "hiring@acme.com")
    admin_user = make_user(1, UserRole.ADMIN, "admin@example.com")
    profile = CompanyProfile(
        user_id=company.id,
        company_name="Acme",
        industry="Technology",
        verification_status="PENDING",
    )
    async with sessions() as session:
        session.add_all([company, admin_user, profile])
        await session.commit()

    active_user = {"value": company}
    app.dependency_overrides[get_current_user] = lambda: active_user["value"]
    monkeypatch.setattr(
        "app.services.company_documents.get_settings",
        lambda: Settings(_env_file=None, company_document_storage_path=str(tmp_path)),
    )
    notices = []
    email_notices = []

    async def capture_notice(db, user_id, notification_type, title, body, **kwargs):
        notices.append((user_id, notification_type, kwargs.get("email")))
        return None

    monkeypatch.setattr(company_documents, "notify", capture_notice)
    monkeypatch.setattr(admin, "notify", capture_notice)

    async def capture_email(to, subject, body, **kwargs):
        email_notices.append((to, kwargs.get("message_type")))

    monkeypatch.setattr(company_documents, "send_dev_email", capture_email)
    monkeypatch.setattr(admin, "send_dev_email", capture_email)

    file_bytes = b"%PDF-1.7\nverification record"
    upload = await client.post(
        "/api/v1/profiles/company/documents",
        data={"document_type": "BUSINESS_REGISTRATION"},
        files={"file": ("registration.pdf", file_bytes, "application/pdf")},
    )
    assert upload.status_code == 201, upload.text
    document_id = upload.json()["id"]
    stored = next(tmp_path.iterdir())
    assert stored.read_bytes() == file_bytes
    assert notices == [(admin_user.id, "COMPANY_DOCUMENT_UPLOADED", None)]
    assert email_notices == [("admin@example.com", "COMPANY_DOCUMENT_UPLOADED")]

    listed = await client.get("/api/v1/profiles/company/documents")
    assert listed.status_code == 200
    assert [document["id"] for document in listed.json()] == [document_id]
    company_download = await client.get(
        f"/api/v1/profiles/company/documents/{document_id}/download"
    )
    assert company_download.content == file_bytes

    active_user["value"] = admin_user
    admin_list = await client.get(
        f"/api/v1/admin/companies/{company.id}/documents"
    )
    assert admin_list.status_code == 200
    assert admin_list.json()[0]["document_type"] == "BUSINESS_REGISTRATION"
    pending_verifications = await client.get("/api/v1/admin/verifications")
    assert pending_verifications.status_code == 200
    verification = next(
        item for item in pending_verifications.json() if item["user_id"] == company.id
    )
    assert verification["submitted_at"] is not None
    assert [item["id"] for item in verification["documents"]] == [document_id]
    admin_download = await client.get(
        f"/api/v1/admin/companies/{company.id}/documents/{document_id}/download"
    )
    assert admin_download.content == file_bytes

    approved = await client.post(
        f"/api/v1/admin/companies/{company.id}/verification",
        json={"status": "VERIFIED"},
    )
    assert approved.status_code == 200
    assert approved.json()["verification_status"] == "VERIFIED"
    assert notices[-1] == (company.id, "COMPANY_VERIFICATION", None)
    assert email_notices[-1] == ("hiring@acme.com", "COMPANY_VERIFICATION")

    active_user["value"] = company
    deletion_after_verification = await client.delete(
        f"/api/v1/profiles/company/documents/{document_id}"
    )
    assert deletion_after_verification.status_code == 400
    assert "cannot be deleted after verification" in deletion_after_verification.json()["detail"]

    async with sessions() as session:
        audit = await session.scalar(
            select(AuditLog).where(AuditLog.action == "company_verified")
        )
        assert audit is not None and audit.target_id == company.id

    async with sessions() as session:
        verified_company = await session.scalar(
            select(CompanyProfile).where(CompanyProfile.user_id == company.id)
        )
        assert verified_company is not None
        verified_company.verification_status = "PENDING"
        await session.commit()
    deletable_document = await client.delete(
        f"/api/v1/profiles/company/documents/{document_id}"
    )
    assert deletable_document.status_code == 204
    assert not stored.exists()


@pytest.mark.anyio
async def test_document_validation_limits_rejection_reset_and_submission_gate(
    api_context, monkeypatch, tmp_path
):
    client, sessions = api_context
    company = make_user(21, UserRole.COMPANY, "hiring@resetco.com")
    admin_user = make_user(2, UserRole.ADMIN, "admin2@example.com")
    profile = CompanyProfile(
        user_id=company.id,
        company_name="Reset Co",
        industry="Technology",
        verification_status="PENDING",
    )
    internship = Internship(
        company_id=company.id,
        title="Intern",
        description="Draft position",
        location="Remote",
        industry="Technology",
        duration_months=3,
        work_mode="REMOTE",
        deadline=date(2027, 1, 1),
        status="DRAFT",
    )
    async with sessions() as session:
        session.add_all([company, admin_user, profile, internship])
        await session.commit()

    active_user = {"value": company}
    app.dependency_overrides[get_current_user] = lambda: active_user["value"]
    monkeypatch.setattr(
        "app.services.company_documents.get_settings",
        lambda: Settings(_env_file=None, company_document_storage_path=str(tmp_path)),
    )
    async def discard_notice(*args, **kwargs):
        return None

    monkeypatch.setattr(company_documents, "notify", discard_notice)
    monkeypatch.setattr(admin, "notify", discard_notice)
    monkeypatch.setattr(company_documents, "send_dev_email", discard_notice)
    monkeypatch.setattr(admin, "send_dev_email", discard_notice)

    active_user["value"] = company
    profile_update = await client.put(
        "/api/v1/profiles/company",
        json={
            "company_name": "Reset Co Updated",
            "industry": "Technology",
            "verification_status": "VERIFIED",
        },
    )
    assert profile_update.status_code == 200
    assert profile_update.json()["verification_status"] == "PENDING"
    draft_create = await client.post(
        "/api/v1/internships",
        json={
            "title": "New Draft",
            "description": "An internship draft for review later",
            "location": "Remote",
            "industry": "Technology",
            "duration_months": 3,
            "work_mode": "REMOTE",
            "skills": ["Python"],
            "deadline": "2027-01-01",
        },
    )
    assert draft_create.status_code == 201
    assert draft_create.json()["status"] == "DRAFT"

    invalid_type = await client.post(
        "/api/v1/profiles/company/documents",
        data={"document_type": "OTHER"},
        files={"file": ("file.pdf", b"%PDF-1.0", "image/png")},
    )
    assert invalid_type.status_code == 415
    invalid_magic = await client.post(
        "/api/v1/profiles/company/documents",
        data={"document_type": "OTHER"},
        files={"file": ("file.png", b"not a PNG", "image/png")},
    )
    assert invalid_magic.status_code == 415
    too_large = await client.post(
        "/api/v1/profiles/company/documents",
        data={"document_type": "OTHER"},
        files={
            "file": (
                "large.pdf",
                b"%PDF-" + b"x" * (5 * 1024 * 1024),
                "application/pdf",
            )
        },
    )
    assert too_large.status_code == 413

    active_user["value"] = admin_user
    approval_without_registration = await client.post(
        f"/api/v1/admin/companies/{company.id}/verification",
        json={"status": "VERIFIED"},
    )
    assert approval_without_registration.status_code == 400
    assert "BUSINESS_REGISTRATION" in approval_without_registration.json()["detail"]
    no_reason = await client.post(
        f"/api/v1/admin/companies/{company.id}/verification",
        json={"status": "REJECTED"},
    )
    assert no_reason.status_code == 400
    rejected = await client.post(
        f"/api/v1/admin/companies/{company.id}/verification",
        json={"status": "REJECTED", "reason": "Registration details are incomplete"},
    )
    assert rejected.status_code == 200
    assert rejected.json()["verification_note"] == "Registration details are incomplete"

    active_user["value"] = company
    document_types = [
        "BUSINESS_REGISTRATION",
        "GST_OR_PAN",
        "AUTHORIZATION_LETTER",
        "OTHER",
        "OTHER",
    ]
    uploaded_types = []
    for index, document_type in enumerate(document_types):
        upload = await client.post(
            "/api/v1/profiles/company/documents",
            data={"document_type": document_type},
            files={"file": (f"doc-{index}.png", b"\x89PNG\r\n\x1a\nvalid", "image/png")},
        )
        assert upload.status_code == 201, upload.text
        uploaded_types.append(upload.json()["document_type"])
    assert uploaded_types == document_types
    for obsolete_type in ("TAX_CERTIFICATE", "COMPANY_LICENSE"):
        rejected_type = await client.post(
            "/api/v1/profiles/company/documents",
            data={"document_type": obsolete_type},
            files={"file": ("old-type.png", b"\x89PNG\r\n\x1a\nvalid", "image/png")},
        )
        assert rejected_type.status_code == 400
    async with sessions() as session:
        updated_profile = await session.scalar(
            select(CompanyProfile).where(CompanyProfile.user_id == company.id)
        )
        assert updated_profile.verification_status == "PENDING"
        assert updated_profile.verification_note is None
    overflow = await client.post(
        "/api/v1/profiles/company/documents",
        data={"document_type": "OTHER"},
        files={"file": ("overflow.png", b"\x89PNG\r\n\x1a\nmore", "image/png")},
    )
    assert overflow.status_code == 400

    draft = await client.post(f"/api/v1/internships/{internship.id}/submit")
    assert draft.status_code == 400
    assert "Company verification is required" in draft.json()["detail"]


@pytest.mark.anyio
async def test_company_email_requirement_and_first_login_for_password_and_mfa(
    api_context, monkeypatch
):
    client, sessions = api_context
    settings = Settings(
        _env_file=None,
        require_email_verification=True,
        require_company_email_verification=False,
    )
    monkeypatch.setattr(auth, "get_settings", lambda: settings)

    registered = await client.post(
        "/api/v1/auth/register/company",
        json={
            "email": "recruiter@firstco.com",
            "password": "CompanyPassword123!",
            "company_name": "First Co",
            "industry": "Technology",
        },
    )
    assert registered.status_code == 201, registered.text
    assert registered.json()["is_verified"] is True
    async with sessions() as session:
        company = await session.scalar(
            select(User).where(User.email == "recruiter@firstco.com")
        )
        assert company is not None
        assert company.verification_token is None
        company.mfa_enabled = False
        await session.commit()

    login = await client.post(
        "/api/v1/auth/login",
        json={
            "email": "recruiter@firstco.com",
            "password": "CompanyPassword123!",
            "portal": "COMPANY",
        },
    )
    assert login.status_code == 200
    assert login.json()["is_first_login"] is True
    repeated_login = await client.post(
        "/api/v1/auth/login",
        json={
            "email": "recruiter@firstco.com",
            "password": "CompanyPassword123!",
            "portal": "COMPANY",
        },
    )
    assert repeated_login.status_code == 200
    assert repeated_login.json()["is_first_login"] is False

    settings.require_company_email_verification = True
    async with sessions() as session:
        company = await session.scalar(
            select(User).where(User.email == "recruiter@firstco.com")
        )
        company.is_verified = False
        await session.commit()
    blocked = await client.post(
        "/api/v1/auth/login",
        json={"email": "recruiter@firstco.com", "password": "CompanyPassword123!"},
    )
    assert blocked.status_code == 403

    mfa_secret = pyotp.random_base32()
    mfa_user = make_user(40, UserRole.STUDENT, "mfa@school.edu")
    mfa_user.is_verified = True
    mfa_user.password_hash = hash_password("MfaPassword123!")
    mfa_user.mfa_enabled = True
    mfa_user.mfa_type = "TOTP"
    mfa_user.mfa_secret = mfa_secret
    async with sessions() as session:
        session.add(mfa_user)
        await session.commit()
    challenge = await client.post(
        "/api/v1/auth/login",
        json={"email": mfa_user.email, "password": "MfaPassword123!"},
    )
    assert challenge.status_code == 200
    completed = await client.post(
        "/api/v1/auth/mfa/verify-login",
        json={
            "mfa_ticket": challenge.json()["mfa_ticket"],
            "otp": pyotp.TOTP(mfa_secret).now(),
        },
    )
    assert completed.status_code == 200
    assert completed.json()["is_first_login"] is True
    async with sessions() as session:
        logged_in_user = await session.scalar(
            select(User).where(User.email == mfa_user.email)
        )
        assert logged_in_user.first_login_at is not None


@pytest.mark.anyio
async def test_account_erasure_removes_company_documents(api_context, monkeypatch, tmp_path):
        _, sessions = api_context
        monkeypatch.setattr(
            "app.services.company_documents.get_settings",
            lambda: Settings(_env_file=None, company_document_storage_path=str(tmp_path)),
        )
        company = make_user(50, UserRole.COMPANY, "erase@company.com")
        document = CompanyDocument(
            company_id=company.id,
            document_type="BUSINESS_REGISTRATION",
            original_filename="registration.png",
            stored_filename="b" * 32 + ".png",
            content_type="image/png",
            file_size=8,
        )
        document_path = tmp_path / document.stored_filename
        document_path.write_bytes(b"\x89PNG\r\n\x1a\n")
        async with sessions() as session:
            session.add_all(
                [
                    company,
                    CompanyProfile(
                        user_id=company.id,
                        company_name="Erase Co",
                        industry="Technology",
                    ),
                    document,
                ]
            )
            await session.commit()
            result = await erase_user(session, company, reason="Account deletion request")
            assert result["success"] is True
            assert await session.scalar(
                select(CompanyDocument.id).where(CompanyDocument.company_id == company.id)
            ) is None
            assert await session.scalar(select(User.id).where(User.id == company.id)) is None
        assert not document_path.exists()


@pytest.mark.anyio
async def test_admin_user_list_reports_role_specific_email_verification(
        api_context, monkeypatch
):
        client, sessions = api_context
        admin_user = make_user(60, UserRole.ADMIN, "admin@platform.com")
        student = make_user(61, UserRole.STUDENT, "student@school.edu")
        company = make_user(62, UserRole.COMPANY, "recruiter@company.com")
        async with sessions() as session:
            session.add_all([admin_user, student, company])
            await session.commit()

        app.dependency_overrides[get_current_user] = lambda: admin_user
        settings = Settings(
            _env_file=None,
            require_email_verification=True,
            require_company_email_verification=False,
        )
        monkeypatch.setattr("app.schemas.admin.get_settings", lambda: settings)

        response = await client.get("/api/v1/admin/users")
        assert response.status_code == 200
        by_role = {user["role"]: user for user in response.json()}
        assert by_role["ADMIN"]["email_verification_required"] is False
        assert by_role["STUDENT"]["email_verification_required"] is True
        assert by_role["COMPANY"]["email_verification_required"] is False

        settings.require_company_email_verification = True
        response_with_company_verification = await client.get("/api/v1/admin/users")
        assert response_with_company_verification.status_code == 200
        company_response = next(
            user
            for user in response_with_company_verification.json()
            if user["role"] == "COMPANY"
        )
        assert company_response["email_verification_required"] is True
