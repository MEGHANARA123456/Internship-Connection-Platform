from datetime import datetime, timedelta, timezone
from secrets import token_urlsafe

from fastapi import APIRouter, BackgroundTasks, HTTPException
from sqlalchemy import select

from app.api.v1.dependencies import DbSession
from app.core.config import get_settings
from app.core.security import create_token, decode_token, hash_password, verify_password
from app.models import CompanyProfile, RefreshToken, StudentProfile, User, UserRole
from app.schemas.auth import AdminRegister, CheckEmailRequest, CompanyRegister, ForgotPasswordRequest, LoginRequest, LogoutRequest, RefreshRequest, ResetPasswordRequest, StudentRegister, TokenResponse, UserResponse
from app.services.mail import send_dev_email

router = APIRouter(prefix="/auth", tags=["auth"])


async def issue_tokens(user: User, db: DbSession) -> TokenResponse:
    settings = get_settings()
    access = create_token(str(user.id), user.role.value, "access", timedelta(minutes=settings.access_token_expire_minutes))
    refresh = create_token(str(user.id), user.role.value, "refresh", timedelta(days=settings.refresh_token_expire_days))
    payload = decode_token(refresh)
    db.add(RefreshToken(jti=payload["jti"], user_id=user.id, expires_at=datetime.fromtimestamp(payload["exp"], timezone.utc)))
    await db.commit()
    return TokenResponse(access_token=access, refresh_token=refresh, role=user.role.value, user_id=user.id)


async def create_user(email: str, password: str, role: UserRole, db: DbSession, background_tasks: BackgroundTasks) -> User:
    clean_email = email.strip().lower()
    if await db.scalar(select(User).where(User.email == clean_email)):
        raise HTTPException(status_code=409, detail="Email is already registered")
    user = User(email=clean_email, password_hash=hash_password(password), role=role, verification_token=token_urlsafe(32))
    db.add(user)
    await db.flush()
    background_tasks.add_task(send_dev_email, clean_email, "Verify your account", f"Verification token: {user.verification_token}")
    return user


@router.post("/check-email")
async def check_email(data: CheckEmailRequest, db: DbSession) -> dict[str, bool]:
    clean_email = str(data.email).strip().lower()
    existing = await db.scalar(select(User.id).where(User.email == clean_email))
    return {"available": existing is None}


@router.post("/register/student", response_model=UserResponse, status_code=201)
async def register_student(data: StudentRegister, background_tasks: BackgroundTasks, db: DbSession) -> User:
    user = await create_user(str(data.email), data.password, UserRole.STUDENT, db, background_tasks)
    user.student_profile = StudentProfile(user_id=user.id, **data.model_dump(exclude={"email", "password"}))
    await db.commit()
    await db.refresh(user)
    return user


@router.post("/register/company", response_model=UserResponse, status_code=201)
async def register_company(data: CompanyRegister, background_tasks: BackgroundTasks, db: DbSession) -> User:
    user = await create_user(str(data.email), data.password, UserRole.COMPANY, db, background_tasks)
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
    if user is None or not verify_password(data.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")
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
    user = await db.scalar(select(User).where(User.email == str(data.email)))
    if user:
        user.reset_token = token_urlsafe(32)
        user.reset_token_expires_at = datetime.now(timezone.utc) + timedelta(hours=1)
        await db.commit()
        background_tasks.add_task(send_dev_email, user.email, "Reset your password", f"Reset token: {user.reset_token}")
    return {"message": "If that email exists, reset instructions have been sent"}


@router.post("/reset-password")
async def reset_password(data: ResetPasswordRequest, db: DbSession) -> dict[str, str]:
    user = await db.scalar(select(User).where(User.reset_token == data.token))
    if user is None or user.reset_token_expires_at is None or user.reset_token_expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Invalid or expired reset token")
    user.password_hash = hash_password(data.new_password)
    user.reset_token = None
    user.reset_token_expires_at = None
    await db.commit()
    return {"message": "Password reset successfully"}