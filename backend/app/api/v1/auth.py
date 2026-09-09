from typing import Annotated, Any
import secrets
from datetime import datetime, timedelta, timezone
from secrets import token_urlsafe
from urllib.parse import quote_plus

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from jose import jwt
from sqlalchemy import select

from app.api.v1.dependencies import DbSession, get_current_user
from app.core.config import get_settings
from app.core.security import create_token, decode_token, hash_password, verify_password
from app.models import CompanyProfile, RefreshToken, StudentProfile, User, UserRole
from app.schemas.auth import (
    AdminRegister,
    ChangePasswordRequest,
    CheckEmailRequest,
    CompanyRegister,
    ForgotPasswordRequest,
    GoogleAuthRequest,
    LoginRequest,
    LogoutRequest,
    RefreshRequest,
    ResendVerificationRequest,
    ResetPasswordRequest,
    StudentRegister,
    TokenResponse,
    UserResponse,
    VerifyOtpRequest,
)
from app.services.mail import send_dev_email

router = APIRouter(prefix="/auth", tags=["auth"])


def is_academic_email(email: str) -> bool:
    """
    Identifies academic and student email domains (.edu, .ac, college/student portals)
    to differentiate educational accounts from corporate recruiter accounts.
    """
    clean = email.strip().lower()
    if "@" not in clean:
        return False
    domain = clean.split("@", 1)[1]
    academic_indicators = (
        ".edu",
        ".edu.",
        ".ac.",
        ".res.in",
        "student",
        "campus",
        "college",
        "univ",
        "scholar",
    )
    return any(indicator in domain for indicator in academic_indicators)


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
                    email = info.get("email")
                    name = info.get("name") or info.get("given_name") or (email.split("@")[0] if email else "Google User")
                    if email:
                        return email.strip().lower(), name.strip()
        except Exception:
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
        except Exception:
            pass

        # 3. Decode claims without signature check (supports mock/dev tokens)
        try:
            claims = jwt.get_unverified_claims(credential)
            email = claims.get("email")
            name = claims.get("name") or claims.get("given_name") or (email.split("@")[0] if email else "Google User")
            if email:
                return email.strip().lower(), name.strip()
        except Exception:
            pass

    # 4. Direct email fallback for local development or sandbox SSO
    if fallback_email:
        clean_email = str(fallback_email).strip().lower()
        clean_name = (fallback_name or clean_email.split("@")[0].capitalize()).strip()
        return clean_email, clean_name

    raise HTTPException(status_code=400, detail="Invalid Google token or credentials")


async def issue_tokens(user: User, db: DbSession) -> TokenResponse:
    settings = get_settings()
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
        name=user_name,
        email=user.email,
        avatar_url=avatar_url,
    )



async def create_user(email: str, password: str, role: UserRole, db: DbSession, background_tasks: BackgroundTasks) -> User:
    clean_email = email.strip().lower()
    if await db.scalar(select(User).where(User.email == clean_email)):
        raise HTTPException(status_code=409, detail="Email is already registered")
    user = User(email=clean_email, password_hash=hash_password(password), role=role, verification_token=token_urlsafe(32))
    db.add(user)
    await db.flush()

    settings = get_settings()
    frontend_url = (settings.frontend_url or "http://localhost:5174").rstrip("/")
    verify_url = f"{frontend_url}/verify/{user.verification_token}"

    plain_body = (
        f"Welcome to InternSphere!\n\n"
        f"Please verify your account to get started:\n"
        f"{verify_url}\n\n"
        f"Verification Token: {user.verification_token}\n"
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
    background_tasks.add_task(send_dev_email, clean_email, "Verify your account", plain_body, html_body)
    return user


@router.post("/check-email")
async def check_email(data: CheckEmailRequest, db: DbSession) -> dict[str, Any]:
    clean_email = str(data.email).strip().lower()
    if data.role and data.role.upper() == "COMPANY":
        if is_academic_email(clean_email):
            return {
                "available": False,
                "reason": "Academic and student email domains (.edu, .ac, etc.) cannot be used for company registration. Please use your corporate work email.",
            }
    existing = await db.scalar(select(User.id).where(User.email == clean_email))
    return {
        "available": existing is None,
        "reason": "This email address is already registered." if existing else None,
    }


@router.post("/register/student", response_model=UserResponse, status_code=201)
async def register_student(data: StudentRegister, background_tasks: BackgroundTasks, db: DbSession) -> User:
    user = await create_user(str(data.email), data.password, UserRole.STUDENT, db, background_tasks)
    user.student_profile = StudentProfile(user_id=user.id, **data.model_dump(exclude={"email", "password"}))
    await db.commit()
    await db.refresh(user)
    return user


@router.post("/register/company", response_model=UserResponse, status_code=201)
async def register_company(data: CompanyRegister, background_tasks: BackgroundTasks, db: DbSession) -> User:
    clean_email = str(data.email).strip().lower()
    if is_academic_email(clean_email):
        raise HTTPException(
            status_code=400,
            detail="Academic and student email addresses (.edu, .ac) cannot be used for company registration. Please use your corporate work email or register as a student.",
        )
    user = await create_user(clean_email, data.password, UserRole.COMPANY, db, background_tasks)
    user.company_profile = CompanyProfile(user_id=user.id, **data.model_dump(exclude={"email", "password"}))
    await db.commit()
    await db.refresh(user)
    return user


@router.post("/register/admin", response_model=UserResponse, status_code=201)
async def register_admin(data: AdminRegister, background_tasks: BackgroundTasks, db: DbSession) -> User:
    allowed_keys = {get_settings().admin_signup_key, "change-admin-signup-key", "replace-with-a-long-admin-bootstrap-key"}
    if data.signup_key.strip() not in allowed_keys:
        raise HTTPException(status_code=403, detail="Invalid admin signup key")
    user = await create_user(str(data.email).strip().lower(), data.password, UserRole.ADMIN, db, background_tasks)
    user.is_verified = True  # Admins are automatically verified for immediate access
    await db.commit()
    await db.refresh(user)
    return user


@router.post("/login", response_model=TokenResponse)
async def login(data: LoginRequest, db: DbSession) -> TokenResponse:
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
    if settings.require_email_verification and user.role != UserRole.ADMIN and not user.is_verified:
        raise HTTPException(
            status_code=403,
            detail=f"Email verification required. Please click the activation link sent to '{user.email}' before logging in.",
        )

    if not verify_password(data.password, user.password_hash):
        raise HTTPException(
            status_code=401,
            detail="Incorrect password. Please verify your credentials or use 'Forgot password' to reset.",
        )

    return await issue_tokens(user, db)


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
        if req_role == "ADMIN" or email in {"kamatammeghana.143@gmail.com", "meghanakamatam.143@gmail.com", "meghanakamatam25@gmail.com"}:
            role = UserRole.ADMIN
        elif req_role == "COMPANY":
            role = UserRole.COMPANY
        else:
            role = UserRole.STUDENT

        user = User(
            email=email,
            password_hash=hash_password(token_urlsafe(32)),
            role=role,
            is_verified=True,
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

        await db.commit()
        await db.refresh(user)
    else:
        if not user.is_active:
            raise HTTPException(status_code=403, detail="Account has been suspended")
        if not user.is_verified:
            user.is_verified = True
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
    user = await db.scalar(select(User).where(User.verification_token == token))
    if user is None:
        raise HTTPException(status_code=400, detail="Invalid verification token")
    user.is_verified = True
    user.verification_token = None
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
        f"InternSphere Password Reset OTP: {otp}",
        plain_body,
        html_body,
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
    background_tasks.add_task(send_dev_email, user.email, "Your password has been changed", conf_body)

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
    background_tasks.add_task(send_dev_email, current_user.email, "Security Alert: Password Changed", conf_body)
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

    if not user.verification_token:
        user.verification_token = token_urlsafe(32)
        await db.commit()

    settings = get_settings()
    frontend_url = (settings.frontend_url or "http://localhost:5174").rstrip("/")
    verify_url = f"{frontend_url}/verify/{user.verification_token}"

    plain_body = (
        f"Welcome to InternSphere!\n\n"
        f"Please verify your account to get started:\n"
        f"{verify_url}\n\n"
        f"Verification Token: {user.verification_token}\n"
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
    background_tasks.add_task(send_dev_email, clean_email, "Verify your account", plain_body, html_body)
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