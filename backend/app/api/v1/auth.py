# -----------------------------------------------------------------------------
# Authentication endpoints for login, registration, token refresh, and account flows.
# -----------------------------------------------------------------------------

from typing import Annotated, Any
import hashlib
import logging
import secrets
from datetime import datetime, timedelta, timezone
from secrets import token_urlsafe
from urllib.parse import quote_plus

import httpx
import pyotp
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy import select, update

from app.api.v1.dependencies import DbSession, get_current_user
from app.core.config import get_settings
from app.core.security import create_token, decode_token, hash_password, verify_password
from app.models import CompanyProfile, EmailVerificationToken, RefreshToken, StudentProfile, User, UserRole
from app.schemas.auth import (
    ChangePasswordRequest,
    CheckEmailRequest,
    CompanyRegister,
    ForgotPasswordRequest,
    GoogleAuthRequest,
    LoginRequest,
    LogoutRequest,
    MFADisableRequest,
    MFAEnableRequest,
    MFALoginChallengeResponse,
    MFALoginVerifyRequest,
    MFATotpSetupResponse,
    MFATotpVerifyRequest,
    MFAStatusResponse,
    RefreshRequest,
    ResendVerificationRequest,
    ResetPasswordRequest,
    StudentRegister,
    TokenResponse,
    UserResponse,
    VerifyOtpRequest,
)
from app.services.mail import send_dev_email
from app.services.notify import notify
from app.services.email_validation import validate_email_format, validate_organization_email, validate_student_email

router = APIRouter(prefix="/auth", tags=["auth"])
logger = logging.getLogger(__name__)


def _is_expired(dt: datetime | None) -> bool:
    if dt is None:
        return True
    if dt.tzinfo is not None:
        return dt < datetime.now(timezone.utc)
    return dt < datetime.utcnow()


async def verify_google_credential(
    credential: str | None,
    fallback_email: str | None,
    fallback_name: str | None,
) -> tuple[str, str]:
    """
    Verifies a Google OAuth token or claims. Returns (clean_email, display_name).
    """
    if credential:
        # 1. First attempt verification against Google's tokeninfo API
        try:
            async with httpx.AsyncClient(timeout=4.0) as client:
                res = await client.get(f"https://oauth2.googleapis.com/tokeninfo?id_token={credential}")
                if res.status_code == 200:
                    info = res.json()
                    if info.get("aud") != get_settings().google_client_id:
                        raise HTTPException(status_code=400, detail="Invalid Google token audience")
                    email = info.get("email")
                    name = info.get("name") or info.get("given_name") or (email.split("@")[0] if email else "Google User")
                    if email:
                        return email.strip().lower(), name.strip()
        except (httpx.HTTPError, ValueError) as exc:
            logger.warning("Google tokeninfo verification failed: %s", exc)
            pass

        # 2. Attempt verification against Google's userinfo API for OAuth2 access tokens
        try:
            async with httpx.AsyncClient(timeout=4.0) as client:
                res = await client.get(
                    "https://www.googleapis.com/oauth2/v3/userinfo",
                    headers={"Authorization": f"Bearer {credential}"},
                )
                if res.status_code == 200:
                    info = res.json()
                    email = info.get("email")
                    name = info.get("name") or info.get("given_name") or (email.split("@")[0] if email else "Google User")
                    if email:
                        return email.strip().lower(), name.strip()
        except (httpx.HTTPError, ValueError) as exc:
            logger.warning("Google userinfo verification failed: %s", exc)
            pass

    raise HTTPException(status_code=400, detail="A valid Google credential is required")


async def issue_tokens(
    user: User, db: DbSession, *, record_first_login: bool = False
) -> TokenResponse:
    settings = get_settings()
    is_first_login = record_first_login and user.first_login_at is None
    if is_first_login:
        user.first_login_at = datetime.now(timezone.utc)
    access_expires_at = datetime.now(timezone.utc) + timedelta(minutes=settings.access_token_expire_minutes)
    refresh_expires_at = datetime.now(timezone.utc) + timedelta(days=settings.refresh_token_expire_days)

    access = create_token(str(user.id), user.role.value, "access", timedelta(minutes=settings.access_token_expire_minutes))
    refresh = create_token(str(user.id), user.role.value, "refresh", timedelta(days=settings.refresh_token_expire_days))
    payload = decode_token(refresh)
    db.add(RefreshToken(jti=payload["jti"], user_id=user.id, expires_at=datetime.fromtimestamp(payload["exp"], timezone.utc)))
    await db.commit()

    # Resolve display name and avatar for dashboard greetings
    user_name: str | None = None
    avatar_url: str | None = None
    if user.role == UserRole.STUDENT:
        student = await db.scalar(select(StudentProfile).where(StudentProfile.user_id == user.id))
        if student:
            user_name = student.full_name
            avatar_url = student.avatar_url
    elif user.role == UserRole.COMPANY:
        company = await db.scalar(select(CompanyProfile).where(CompanyProfile.user_id == user.id))
        if company:
            user_name = company.company_name
            avatar_url = company.avatar_url

    if not user_name and user.email:
        local_part = user.email.split("@")[0]
        words = "".join(c if c.isalpha() else " " for c in local_part).split()
        user_name = " ".join(words).title() if words else local_part.title()

    return TokenResponse(
        access_token=access,
        refresh_token=refresh,
        role=user.role.value,
        user_id=user.id,
        is_first_login=is_first_login,
        name=user_name,
        email=user.email,
        avatar_url=avatar_url,
        access_token_expires_in=int(settings.access_token_expire_minutes * 60),
        refresh_token_expires_in=int(settings.refresh_token_expire_days * 24 * 60 * 60),
        access_token_expires_at=access_expires_at,
        refresh_token_expires_at=refresh_expires_at,
    )



async def create_user(
    email: str,
    password: str,
    role: UserRole,
    db: DbSession,
    background_tasks: BackgroundTasks,
    *,
    require_verification: bool = True,
) -> User:
    clean_email = validate_email_format(email)
    if await db.scalar(select(User).where(User.email == clean_email)):
        raise HTTPException(status_code=409, detail="Email is already registered")
    user = User(
        email=clean_email,
        password_hash=hash_password(password),
        role=role,
    )
    if not require_verification:
        user.is_verified = True
        user.email_verified_at = datetime.now(timezone.utc)
        db.add(user)
        await db.flush()
        return user

    raw_token = token_urlsafe(32)
    expires_at = datetime.now(timezone.utc) + timedelta(hours=24)
    user.verification_token = raw_token
    user.verification_token_expires_at = expires_at
    db.add(user)
    await db.flush()
    db.add(EmailVerificationToken(user_id=user.id, token_digest=hashlib.sha256(raw_token.encode()).hexdigest(), expires_at=expires_at))

    settings = get_settings()
    frontend_url = (settings.frontend_url or "http://localhost:5174").rstrip("/")
    verify_url = f"{frontend_url}/verify/{raw_token}"

    plain_body = (
        f"Welcome to InternSphere!\n\n"
        f"Please verify your account to get started:\n"
        f"{verify_url}\n\n"
        "This link expires in 24 hours and can only be used once.\n"
    )
    html_body = f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 28px 24px; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px;">
        <div style="margin-bottom: 20px;">
            <span style="font-weight: 800; font-size: 22px; color: #4338ca; letter-spacing: -0.5px;">InternSphere</span>
        </div>
        <h2 style="font-size: 18px; font-weight: 600; color: #0f172a; margin: 0 0 12px 0;">Verify Your Account</h2>
        <p style="font-size: 14px; color: #475569; line-height: 1.6; margin: 0 0 20px 0;">
            Thank you for joining InternSphere! Click the button below to verify your email and activate your account:
        </p>
        <div style="text-align: center; margin: 24px 0;">
            <a href="{verify_url}" target="_blank" style="display: inline-block; background-color: #4f46e5; color: #ffffff; text-decoration: none; padding: 14px 28px; font-size: 15px; font-weight: 600; border-radius: 8px;">
                Verify Account Now →
            </a>
        </div>
        <p style="font-size: 12px; color: #64748b; line-height: 1.5; margin: 16px 0 0 0;">
            Or copy and paste this link in your browser:<br />
            <a href="{verify_url}" style="color: #4f46e5; word-break: break-all;">{verify_url}</a>
        </p>
    </div>
    """
    background_tasks.add_task(send_dev_email, clean_email, "Verify your account", plain_body, html_body, db=db)
    return user


@router.post("/check-email")
async def check_email(data: CheckEmailRequest, db: DbSession) -> dict[str, Any]:
    try:
        clean_email = validate_email_format(str(data.email))
        result = validate_organization_email(clean_email) if data.role and data.role.upper() == "COMPANY" else validate_student_email(clean_email)
    except ValueError as exc:
        return {"available": False, "reason": str(exc), "classification": None}
    existing = await db.scalar(select(User.id).where(User.email == clean_email))
    return {
        "available": existing is None,
        "reason": "This email address is already registered." if existing else None,
        "classification": result.classification,
    }


@router.post("/register/student", response_model=UserResponse, status_code=201)
async def register_student(data: StudentRegister, background_tasks: BackgroundTasks, db: DbSession) -> User:
    try:
        email_result = validate_student_email(str(data.email))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    clean_email = email_result.email
    user = await create_user(clean_email, data.password, UserRole.STUDENT, db, background_tasks)# type: ignore
    user.student_profile = StudentProfile(
        user_id=user.id,
        institution_email=clean_email if email_result.classification == "INSTITUTION_EMAIL" else None,
        **data.model_dump(exclude={"email", "password"}),
    )
    await db.commit()
    await db.refresh(user)
    return user


@router.post("/register/company", response_model=UserResponse, status_code=201)
async def register_company(data: CompanyRegister, background_tasks: BackgroundTasks, db: DbSession) -> User:
    try:
        clean_email = validate_organization_email(str(data.email)).email
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    user = await create_user(
        clean_email,
        data.password,
        UserRole.COMPANY,
        db,
        background_tasks,
        require_verification=get_settings().require_company_email_verification,
    )# type: ignore
    user.company_profile = CompanyProfile(user_id=user.id, **data.model_dump(exclude={"email", "password"}))
    admins = await db.scalars(select(User).where(User.role == UserRole.ADMIN))
    for admin in admins:
        await notify(
            db,
            admin.id,
            "COMPANY_REGISTRATION",
            "New company awaiting verification",
            f"{user.company_profile.company_name} registered and is awaiting verification.",# type: ignore
        )
    await db.commit()
    await db.refresh(user)
    return user


@router.post("/mfa/setup-totp", response_model=MFATotpSetupResponse)
async def setup_totp(user: Annotated[User, Depends(get_current_user)], db: DbSession) -> dict[str, str]:
    secret = pyotp.random_base32()
    user.mfa_type = "TOTP"
    user.mfa_secret = secret
    user.mfa_enabled = False
    user.mfa_otp = None
    user.mfa_otp_expires_at = None
    await db.commit()

    otpauth_url = f"otpauth://totp/InternSphere:{quote_plus(user.email)}?secret={secret}&issuer=InternSphere"
    return MFATotpSetupResponse(secret=secret, otpauth_url=otpauth_url, message="Authenticator app setup ready")# type: ignore


@router.post("/mfa/verify-totp")
async def verify_totp(data: MFATotpVerifyRequest, user: Annotated[User, Depends(get_current_user)], db: DbSession) -> dict[str, Any]:
    if not user.mfa_secret:
        raise HTTPException(status_code=400, detail="Authenticator setup is not complete. Please enable TOTP first.")

    secret = user.mfa_secret.strip()
    if not pyotp.TOTP(secret).verify(data.otp.strip(), valid_window=1):
        raise HTTPException(status_code=400, detail="Invalid authenticator code. Please try again.")

    user.mfa_enabled = True
    user.mfa_type = "TOTP"
    user.mfa_otp = None
    user.mfa_otp_expires_at = None
    await db.commit()

    return {"mfa_enabled": True, "mfa_type": "TOTP", "message": "Authenticator app enabled successfully."}


@router.post("/login", response_model=TokenResponse | MFALoginChallengeResponse)
async def login(data: LoginRequest, db: DbSession) -> Any:
    clean_email = str(data.email).strip().lower()
    user = await db.scalar(select(User).where(User.email == clean_email))
    
    if user is None:
        raise HTTPException(
            status_code=404,
            detail=f"No account found with email '{clean_email}'. Please check for typos or sign up first.",
        )

    if not user.is_active:
        raise HTTPException(
            status_code=403,
            detail="Your account has been deactivated or suspended. Please contact platform support.",
        )

    # Portal role validation if specified
    if data.portal:
        req_portal = data.portal.strip().upper()
        user_role = user.role.value if hasattr(user.role, "value") else str(user.role)
        if req_portal != user_role:
            raise HTTPException(
                status_code=403,
                detail=f"Role mismatch: This account is registered as a {user_role}. Please sign in through the {user_role.title()} portal.",
            )

    settings = get_settings()
    requires_email_verification = (
        settings.require_company_email_verification
        if user.role == UserRole.COMPANY
        else settings.require_email_verification and user.role != UserRole.ADMIN
    )
    if requires_email_verification and not user.is_verified:
        raise HTTPException(
            status_code=403,
            detail=f"Email verification required. Please click the activation link sent to '{user.email}' before logging in.",
        )

    if not verify_password(data.password, user.password_hash):
        raise HTTPException(
            status_code=401,
            detail="Incorrect password. Please verify your credentials or use 'Forgot password' to reset.",
        )

    # Opt-in MFA challenge flow
    if getattr(user, "mfa_enabled", False):
        user_role_str = user.role.value if hasattr(user.role, "value") else str(user.role)
        mfa_ticket = create_token(str(user.id), user_role_str, "mfa_challenge", timedelta(minutes=10))

        if getattr(user, "mfa_type", "EMAIL") == "TOTP":
            return MFALoginChallengeResponse(
                mfa_required=True,
                mfa_ticket=mfa_ticket,
                email=user.email,
                mfa_type="TOTP",
                message="Two-factor authentication required via your authenticator app",
            )

        otp = f"{secrets.randbelow(900000) + 100000:06d}"
        user.mfa_otp = otp
        user.mfa_otp_expires_at = datetime.now(timezone.utc) + timedelta(minutes=10)
        await db.commit()

        email_body = (
            f"Hello,\n\n"
            f"Your 6-digit Multi-Factor Authentication (MFA) security code is:\n\n"
            f"    {otp}\n\n"
            f"This code will expire in 10 minutes. If you did not initiate this login attempt, please change your password immediately.\n\n"
            f"— The Internship Connection Security Team"
        )
        html_body = f"""
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 28px 24px; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.04);">
            <div style="margin-bottom: 20px;">
                <span style="font-weight: 800; font-size: 22px; color: #4338ca; letter-spacing: -0.5px;">InternSphere</span>
            </div>
            <h2 style="font-size: 18px; font-weight: 700; color: #0f172a; margin: 0 0 12px 0;">Two-Factor Security Code</h2>
            <p style="font-size: 14px; color: #475569; line-height: 1.6; margin: 0 0 20px 0;">
                Use the following 6-digit security code to complete your login:
            </p>
            <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 18px; margin: 20px 0; text-align: center;">
                <div style="display: inline-block; padding: 10px 24px; background: #eef2ff; border: 1px dashed #6366f1; border-radius: 6px; font-family: monospace; font-size: 28px; font-weight: 800; letter-spacing: 6px; color: #4338ca;">
                    {otp}
                </div>
            </div>
            <p style="font-size: 12px; color: #64748b; line-height: 1.5; margin: 16px 0 0 0;">
                &#9201; This code expires in <strong>10 minutes</strong>. If you did not initiate this sign-in, change your password immediately.
            </p>
        </div>
        """
        await send_dev_email(
            to=user.email,
            subject="Two-Factor Authentication (MFA) Security Code",
            body=email_body,
            html=html_body,
            message_type="MFA_CHALLENGE",
            db=db,
        )

        return MFALoginChallengeResponse(
            mfa_required=True,
            mfa_ticket=mfa_ticket,
            email=user.email,
            mfa_type="EMAIL",
            message="Two-factor authentication code sent to your email",
        )

    return await issue_tokens(user, db, record_first_login=True)


@router.post("/mfa/verify-login", response_model=TokenResponse)
async def verify_mfa_login(data: MFALoginVerifyRequest, db: DbSession) -> TokenResponse:
    """
    Validates MFA ticket and OTP code, returning access & refresh tokens upon success.
    """
    try:
        payload = decode_token(data.mfa_ticket)
    except ValueError:
        raise HTTPException(status_code=401, detail="Invalid or expired MFA session. Please sign in again.")

    if payload.get("type") != "mfa_challenge":
        raise HTTPException(status_code=401, detail="Invalid authentication token type.")

    try:
        user_id = int(payload.get("sub"))# type: ignore
    except (TypeError, ValueError):
        raise HTTPException(status_code=401, detail="Invalid user identifier in token.")

    user = await db.scalar(select(User).where(User.id == user_id))
    if user is None or not user.is_active:
        raise HTTPException(status_code=404, detail="User account not found or deactivated.")

    if not user.mfa_enabled:
        return await issue_tokens(user, db, record_first_login=True)

    clean_otp = data.otp.strip()
    if getattr(user, "mfa_type", "EMAIL") == "TOTP":
        if not user.mfa_secret or not pyotp.TOTP(user.mfa_secret).verify(clean_otp, valid_window=1):
            raise HTTPException(status_code=400, detail="Invalid authenticator app code. Please try again.")
        await db.commit()
        return await issue_tokens(user, db, record_first_login=True)

    if not user.mfa_otp or user.mfa_otp != clean_otp:
        raise HTTPException(status_code=400, detail="Invalid two-factor authentication code. Please try again.")

    if _is_expired(user.mfa_otp_expires_at):
        raise HTTPException(status_code=400, detail="Two-factor authentication code has expired. Please sign in again.")

    user.mfa_otp = None
    user.mfa_otp_expires_at = None
    await db.commit()

    return await issue_tokens(user, db, record_first_login=True)


@router.get("/mfa/status", response_model=MFAStatusResponse)
async def get_mfa_status(user: Annotated[User, Depends(get_current_user)]) -> MFAStatusResponse:
    """
    Returns current MFA status for the authenticated user.
    """
    return MFAStatusResponse(mfa_enabled=bool(user.mfa_enabled), email=user.email, mfa_type=getattr(user, "mfa_type", "EMAIL") or "EMAIL")


@router.post("/mfa/setup-request")
async def request_mfa_setup(user: Annotated[User, Depends(get_current_user)], db: DbSession) -> dict[str, str]:
    """
    Generates and emails a 6-digit confirmation code to verify email ownership before enabling 2FA.
    """
    otp = f"{secrets.randbelow(900000) + 100000:06d}"
    user.mfa_otp = otp
    user.mfa_otp_expires_at = datetime.now(timezone.utc) + timedelta(minutes=10)
    await db.commit()

    email_body = (
        f"Hello,\n\n"
        f"Your 6-digit confirmation code to enable Two-Factor Authentication (MFA) is:\n\n"
        f"    {otp}\n\n"
        f"This code will expire in 10 minutes.\n\n"
        f"— The Internship Connection Security Team"
    )
    html_body = f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 28px 24px; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.04);">
        <div style="margin-bottom: 20px;">
            <span style="font-weight: 800; font-size: 22px; color: #4338ca; letter-spacing: -0.5px;">InternSphere</span>
        </div>
        <h2 style="font-size: 18px; font-weight: 700; color: #0f172a; margin: 0 0 12px 0;">Confirm Two-Factor Authentication Setup</h2>
        <p style="font-size: 14px; color: #475569; line-height: 1.6; margin: 0 0 20px 0;">
            Enter the 6-digit confirmation code below in your account security settings to activate 2FA:
        </p>
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 18px; margin: 20px 0; text-align: center;">
            <div style="display: inline-block; padding: 10px 24px; background: #ecfdf5; border: 1px dashed #10b981; border-radius: 6px; font-family: monospace; font-size: 28px; font-weight: 800; letter-spacing: 6px; color: #065f46;">
                {otp}
            </div>
        </div>
        <p style="font-size: 12px; color: #64748b; line-height: 1.5; margin: 16px 0 0 0;">
            &#9201; This code expires in <strong>10 minutes</strong>.
        </p>
    </div>
    """
    await send_dev_email(
        to=user.email,
        subject="MFA Setup Confirmation Code",
        body=email_body,
        html=html_body,
        message_type="MFA_SETUP",
        db=db,
    )
    return {"message": f"Verification code dispatched to {user.email}"}


@router.post("/mfa/enable", response_model=MFAStatusResponse)
async def enable_mfa(data: MFAEnableRequest, user: Annotated[User, Depends(get_current_user)], db: DbSession) -> dict[str, Any]:
    """
    Verifies setup OTP and activates 2FA for the account.
    """
    clean_otp = data.otp.strip()
    if not user.mfa_otp or user.mfa_otp != clean_otp:
        raise HTTPException(status_code=400, detail="Invalid verification code. Please check the code sent to your email.")

    if _is_expired(user.mfa_otp_expires_at):
        raise HTTPException(status_code=400, detail="Verification code has expired. Please request a new code.")

    user.mfa_enabled = True
    user.mfa_otp = None
    user.mfa_otp_expires_at = None
    await db.commit()

    html_body = """
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 28px 24px; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.04);">
        <div style="margin-bottom: 20px;">
            <span style="font-weight: 800; font-size: 22px; color: #4338ca; letter-spacing: -0.5px;">InternSphere</span>
        </div>
        <h2 style="font-size: 18px; font-weight: 700; color: #059669; margin: 0 0 12px 0;">✓ Two-Factor Authentication Activated</h2>
        <p style="font-size: 14px; color: #475569; line-height: 1.6; margin: 0 0 20px 0;">
            Two-Factor Authentication (MFA) has been successfully activated on your InternSphere account. On your next login, you will receive a 6-digit security code sent to this email address.
        </p>
    </div>
    """
    await send_dev_email(
        to=user.email,
        subject="Two-Factor Authentication Activated",
        body="Two-Factor Authentication (MFA) has been successfully activated on your account.",
        html=html_body,
        message_type="MFA_STATUS_CHANGE",
        db=db,
    )

    return {"mfa_enabled": True, "email": user.email, "message": "Two-factor authentication successfully enabled on your account."}


@router.post("/mfa/disable", response_model=MFAStatusResponse)
async def disable_mfa(data: MFADisableRequest, user: Annotated[User, Depends(get_current_user)], db: DbSession) -> dict[str, Any]:
    """
    Requires password verification and deactivates 2FA for the account.
    """
    if not verify_password(data.password, user.password_hash):
        raise HTTPException(status_code=400, detail="Incorrect password. Password verification is required to disable 2FA.")

    user.mfa_enabled = False
    user.mfa_type = "EMAIL"
    user.mfa_secret = None
    user.mfa_otp = None
    user.mfa_otp_expires_at = None
    await db.commit()

    html_body = """
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 28px 24px; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.04);">
        <div style="margin-bottom: 20px;">
            <span style="font-weight: 800; font-size: 22px; color: #4338ca; letter-spacing: -0.5px;">InternSphere</span>
        </div>
        <h2 style="font-size: 18px; font-weight: 700; color: #e11d48; margin: 0 0 12px 0;">⚠ Two-Factor Authentication Deactivated</h2>
        <p style="font-size: 14px; color: #475569; line-height: 1.6; margin: 0 0 20px 0;">
            Two-Factor Authentication (MFA) has been turned off on your account. If you did not make this change, please contact support and change your account password immediately.
        </p>
    </div>
    """
    await send_dev_email(
        to=user.email,
        subject="Two-Factor Authentication Deactivated",
        body="Two-Factor Authentication (MFA) has been turned off on your account.",
        html=html_body,
        message_type="MFA_STATUS_CHANGE",
        db=db,
    )

    return {"mfa_enabled": False, "email": user.email, "message": "Two-factor authentication has been disabled."}



@router.post("/google", response_model=TokenResponse)
async def google_auth(data: GoogleAuthRequest, db: DbSession) -> TokenResponse:
    """
    Authenticate or register a user via Google SSO.
    """
    email, name = await verify_google_credential(
        data.credential,
        str(data.email) if data.email else None,
        data.name,
    )

    user = await db.scalar(select(User).where(User.email == email))

    if user is None:
        req_role = data.role.upper() if data.role else "STUDENT"
        if req_role == "COMPANY":
            try:
                validate_organization_email(email)
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=str(exc))
            role = UserRole.COMPANY
        else:
            role = UserRole.STUDENT

        user = User(
            email=email,
            password_hash=hash_password(token_urlsafe(32)),
            role=role,
            is_verified=True,
            email_verified_at=datetime.now(timezone.utc),
            is_active=True,
        )
        db.add(user)
        await db.flush()

        if role == UserRole.STUDENT:
            student_profile = StudentProfile(
                user_id=user.id,
                full_name=name,
                university="University Campus",
                major="Computer Science",
                graduation_year=2026,
            )
            db.add(student_profile)
        elif role == UserRole.COMPANY:
            company_profile = CompanyProfile(
                user_id=user.id,
                company_name=name or f"{email.split('@')[0].capitalize()} Technologies",
                industry="Technology",
            )
            db.add(company_profile)
            admins = await db.scalars(select(User).where(User.role == UserRole.ADMIN))
            for admin in admins:
                await notify(
                    db,
                    admin.id,
                    "COMPANY_REGISTRATION",
                    "New company awaiting verification",
                    f"{company_profile.company_name} registered and is awaiting verification.",
                )

        await db.commit()
        await db.refresh(user)
    else:
        if not user.is_active:
            raise HTTPException(status_code=403, detail="Account has been suspended")
        was_verified = user.is_verified
        if not user.is_verified:
            user.is_verified = True
            user.email_verified_at = datetime.now(timezone.utc)
        admin_emails = {
            value.strip().lower()
            for value in get_settings().admin_emails.split(",")
            if value.strip()
        }
        if was_verified and email in admin_emails:
            user.role = UserRole.ADMIN # type: ignore
        if not was_verified or (was_verified and email in admin_emails):
            await db.commit()

    return await issue_tokens(user, db)



@router.post("/refresh", response_model=TokenResponse)
async def refresh(data: RefreshRequest, db: DbSession) -> TokenResponse:
    try:
        payload = decode_token(data.refresh_token)
        if payload.get("type") != "refresh":
            raise ValueError
        token = await db.scalar(select(RefreshToken).where(RefreshToken.jti == payload.get("jti")))
        user = await db.scalar(select(User).where(User.id == int(payload["sub"])))
        if token is None or token.revoked_at is not None or token.expires_at < datetime.now(timezone.utc) or user is None:
            raise ValueError
        token.revoked_at = datetime.now(timezone.utc)
        return await issue_tokens(user, db)
    except (ValueError, TypeError, KeyError):
        raise HTTPException(status_code=401, detail="Invalid refresh token")


@router.post("/logout", status_code=204)
async def logout(data: LogoutRequest, db: DbSession) -> None:
    try:
        payload = decode_token(data.refresh_token)
        token = await db.scalar(select(RefreshToken).where(RefreshToken.jti == payload.get("jti")))
        if token:
            token.revoked_at = datetime.now(timezone.utc)
            await db.commit()
    except ValueError:
        pass


@router.get("/verify/{token}")
async def verify_email(token: str, db: DbSession) -> dict[str, str]:
    now = datetime.now(timezone.utc)
    digest = hashlib.sha256(token.encode()).hexdigest()
    token_row = await db.scalar(
        select(EmailVerificationToken).where(
            EmailVerificationToken.token_digest == digest,
            EmailVerificationToken.used_at.is_(None),
            EmailVerificationToken.expires_at > now,
        )
    )
    if token_row is None:
        legacy_user = await db.scalar(select(User).where(User.verification_token == token))
        if legacy_user is None or _is_expired(legacy_user.verification_token_expires_at):
            raise HTTPException(status_code=400, detail="Invalid or expired verification token")
        legacy_user.is_verified = True
        legacy_user.email_verified_at = now
        legacy_user.verification_token = None
        legacy_user.verification_token_expires_at = None
        await db.commit()
        return {"message": "Email verified"}
    claimed = await db.execute(
        update(EmailVerificationToken)
        .execution_options(synchronize_session=False)
        .where(
            EmailVerificationToken.id == token_row.id,
            EmailVerificationToken.used_at.is_(None),
            EmailVerificationToken.expires_at > now,
        )
        .values(used_at=now)
    )
    if claimed.rowcount != 1:
        raise HTTPException(status_code=400, detail="Invalid verification token")
    user = await db.get(User, token_row.user_id)
    if user is None:
        raise HTTPException(status_code=400, detail="Invalid verification token")
    user.is_verified = True
    user.email_verified_at = now
    user.verification_token = None
    user.verification_token_expires_at = None
    await db.commit()
    return {"message": "Email verified"}


@router.post("/forgot-password")
async def forgot_password(data: ForgotPasswordRequest, background_tasks: BackgroundTasks, db: DbSession) -> dict[str, str]:
    clean_email = str(data.email).strip().lower()
    user = await db.scalar(select(User).where(User.email == clean_email))
    if user is None:
        raise HTTPException(
            status_code=404,
            detail=f"No account found with email '{clean_email}'. Please check for typos or register for an account.",
        )

    # Generate 6-digit numerical OTP
    otp = f"{secrets.randbelow(900000) + 100000}"
    user.reset_token = otp
    user.reset_token_expires_at = datetime.now(timezone.utc) + timedelta(minutes=15)
    await db.commit()

    settings = get_settings()
    frontend_url = (settings.frontend_url or "http://localhost:5174").rstrip("/")
    reset_link = f"{frontend_url}/reset-password?email={quote_plus(user.email)}&otp={otp}"

    plain_body = (
        f"Hello,\n\n"
        f"You requested a password reset for your InternSphere account.\n\n"
        f"👉 Click the link below to set your new password directly:\n"
        f"{reset_link}\n\n"
        f"Alternatively, you can enter your 6-digit verification code on the reset page:\n"
        f"Verification Code: {otp}\n\n"
        f"This link and code will expire in 15 minutes.\n\n"
        f"If you did not request a password reset, please disregard this email."
    )
    html_body = f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 540px; margin: 0 auto; padding: 32px 24px; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 14px; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
        <div style="margin-bottom: 22px; border-bottom: 1px solid #f1f5f9; padding-bottom: 16px;">
            <span style="font-weight: 800; font-size: 22px; color: #4338ca; letter-spacing: -0.5px;">InternSphere</span>
            <span style="display: block; font-size: 12px; color: #64748b; margin-top: 2px;">Verified Internship & Career Platform</span>
        </div>
        <h2 style="font-size: 19px; font-weight: 700; color: #0f172a; margin: 0 0 12px 0;">Reset Your Password</h2>
        <p style="font-size: 14px; color: #475569; line-height: 1.6; margin: 0 0 20px 0;">
            We received a request to reset the password for your account (<strong>{user.email}</strong>). Click the button below to set a new password:
        </p>
        <div style="text-align: center; margin: 26px 0;">
            <a href="{reset_link}" target="_blank" style="display: inline-block; background-color: #4f46e5; color: #ffffff; text-decoration: none; padding: 14px 32px; font-size: 15px; font-weight: 700; border-radius: 8px; box-shadow: 0 4px 10px rgba(79, 70, 229, 0.35);">
                Reset Password Now →
            </a>
        </div>
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px; margin: 20px 0; text-align: center;">
            <p style="font-size: 12px; color: #64748b; margin: 0 0 6px 0;">Or manually enter your 6-digit verification code:</p>
            <div style="display: inline-block; padding: 8px 20px; background: #f0fdf4; border: 1px dashed #16a34a; border-radius: 6px; font-family: monospace; font-size: 26px; font-weight: 800; letter-spacing: 6px; color: #15803d;">
                {otp}
            </div>
        </div>
        <p style="font-size: 12px; color: #64748b; line-height: 1.5; margin: 0 0 12px 0;">
            Direct link: <a href="{reset_link}" style="color: #4f46e5; word-break: break-all;">{reset_link}</a>
        </p>
        <p style="font-size: 12px; color: #94a3b8; line-height: 1.4; margin: 16px 0 0 0; border-top: 1px solid #f1f5f9; padding-top: 16px;">
            &#9201; This link and code expire in <strong>15 minutes</strong>. If you did not request this, your account remains secure and no changes have been made.
        </p>
    </div>
    """
    background_tasks.add_task(
        send_dev_email,
        user.email,
        "InternSphere Password Reset Code",
        plain_body,
        html_body,
        db=db,
    )
    return {"message": f"Verification code and reset link have been dispatched to {user.email}."}


@router.post("/verify-otp")
async def verify_otp(data: VerifyOtpRequest, db: DbSession) -> dict[str, str]:
    user = await db.scalar(select(User).where(User.email == str(data.email).strip().lower()))
    if (
        user is None
        or not user.reset_token
        or user.reset_token.strip() != data.otp.strip()
        or _is_expired(user.reset_token_expires_at)
    ):
        raise HTTPException(status_code=400, detail="Invalid or expired verification code")
    return {"message": "OTP verified successfully"}


@router.post("/reset-password")
async def reset_password(data: ResetPasswordRequest, background_tasks: BackgroundTasks, db: DbSession) -> dict[str, str]:
    code = (data.otp or data.token or "").strip()
    if not code:
        raise HTTPException(status_code=400, detail="Verification code or reset token is required")

    user = None
    if data.email:
        user = await db.scalar(select(User).where(User.email == str(data.email).strip().lower()))
        if user is None or (user.reset_token or "").strip() != code:
            raise HTTPException(status_code=400, detail="Invalid or expired verification code")
    else:
        # Fallback query for token-only backwards compatibility
        user = await db.scalar(select(User).where(User.reset_token == code))
        if user is None:
            raise HTTPException(status_code=400, detail="Invalid or expired reset token")

    if _is_expired(user.reset_token_expires_at):
        raise HTTPException(status_code=400, detail="Verification code has expired. Please request a new one.")

    user.is_verified = True
    user.password_hash = hash_password(data.new_password)
    user.reset_token = None
    user.reset_token_expires_at = None
    await db.commit()

    # Send confirmation notification email
    conf_body = (
        f"Hello,\n\n"
        f"Your password for {user.email} has been successfully updated.\n\n"
        f"If you performed this action, you can safely ignore this notification. If you did not make this change, please contact support immediately."
    )
    background_tasks.add_task(send_dev_email, user.email, "Your password has been changed", conf_body, db=db)

    return {"message": "Password reset successfully"}


@router.post("/change-password")
async def change_password(
    data: ChangePasswordRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    background_tasks: BackgroundTasks,
    db: DbSession,
) -> dict[str, str]:
    if not verify_password(data.current_password, current_user.password_hash):
        raise HTTPException(status_code=400, detail="Current password is incorrect.")
    
    if data.current_password == data.new_password:
        raise HTTPException(status_code=400, detail="New password must be different from current password.")

    current_user.password_hash = hash_password(data.new_password)
    await db.commit()

    conf_body = (
        f"Hello,\n\n"
        f"Your password for {current_user.email} was successfully changed.\n\n"
        f"If you performed this action, you can safely ignore this notification. If you did not authorize this change, please contact support immediately."
    )
    background_tasks.add_task(send_dev_email, current_user.email, "Security Alert: Password Changed", conf_body, db=db)
    return {"message": "Password updated successfully"}


@router.post("/resend-verification")
async def resend_verification(data: ResendVerificationRequest, background_tasks: BackgroundTasks, db: DbSession) -> dict[str, str]:
    clean_email = str(data.email).strip().lower()
    user = await db.scalar(select(User).where(User.email == clean_email))
    if user is None:
        raise HTTPException(
            status_code=404,
            detail=f"No account found with email '{clean_email}'. Please sign up first.",
        )
    if user.is_verified:
        return {"message": "Your email is already verified. You can log in directly."}

    raw_token = token_urlsafe(32)
    expires_at = datetime.now(timezone.utc) + timedelta(hours=24)
    await db.execute(
        update(EmailVerificationToken)
        .where(EmailVerificationToken.user_id == user.id, EmailVerificationToken.used_at.is_(None))
        .values(used_at=datetime.now(timezone.utc))
    )
    user.verification_token = raw_token
    user.verification_token_expires_at = expires_at
    db.add(EmailVerificationToken(user_id=user.id, token_digest=hashlib.sha256(raw_token.encode()).hexdigest(), expires_at=expires_at))
    await db.commit()

    settings = get_settings()
    frontend_url = (settings.frontend_url or "http://localhost:5174").rstrip("/")
    verify_url = f"{frontend_url}/verify/{raw_token}"

    plain_body = (
        f"Welcome to InternSphere!\n\n"
        f"Please verify your account to get started:\n"
        f"{verify_url}\n\n"
        "This link expires in 24 hours and can only be used once.\n"
    )
    html_body = f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 28px 24px; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px;">
        <div style="margin-bottom: 20px;">
            <span style="font-weight: 800; font-size: 22px; color: #4338ca; letter-spacing: -0.5px;">InternSphere</span>
        </div>
        <h2 style="font-size: 18px; font-weight: 600; color: #0f172a; margin: 0 0 12px 0;">Verify Your Account</h2>
        <p style="font-size: 14px; color: #475569; line-height: 1.6; margin: 0 0 20px 0;">
            Click the button below to verify your email and activate your account:
        </p>
        <div style="text-align: center; margin: 24px 0;">
            <a href="{verify_url}" target="_blank" style="display: inline-block; background-color: #4f46e5; color: #ffffff; text-decoration: none; padding: 14px 28px; font-size: 15px; font-weight: 600; border-radius: 8px;">
                Verify Account Now →
            </a>
        </div>
        <p style="font-size: 12px; color: #64748b; line-height: 1.5; margin: 16px 0 0 0;">
            Or copy and paste this link in your browser:<br />
            <a href="{verify_url}" style="color: #4f46e5; word-break: break-all;">{verify_url}</a>
        </p>
    </div>
    """
    background_tasks.add_task(send_dev_email, clean_email, "Verify your account", plain_body, html_body, db=db)
    return {"message": f"Verification link has been sent to {clean_email}."}


@router.get("/me")
async def get_me(user: Annotated[User, Depends(get_current_user)], db: DbSession) -> dict[str, Any]:
    """Return authenticated user profile details with resolved display name for greetings."""
    user_name: str | None = None
    if user.role == UserRole.STUDENT:
        student = await db.scalar(select(StudentProfile).where(StudentProfile.user_id == user.id))
        if student and student.full_name:
            user_name = student.full_name
    elif user.role == UserRole.COMPANY:
        company = await db.scalar(select(CompanyProfile).where(CompanyProfile.user_id == user.id))
        if company and company.company_name:
            user_name = company.company_name

    if not user_name and user.email:
        local_part = user.email.split("@")[0]
        words = "".join(c if c.isalpha() else " " for c in local_part).split()
        user_name = " ".join(words).title() if words else local_part.title()

    return {
        "id": user.id,
        "email": user.email,
        "role": user.role.value,
        "name": user_name,
        "is_verified": user.is_verified,
    }
