from pydantic import BaseModel, ConfigDict, EmailStr, Field


class StudentRegister(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)
    full_name: str = Field(min_length=2, max_length=255)
    university: str = Field(min_length=2, max_length=255)
    major: str = Field(min_length=2, max_length=255)
    graduation_year: int = Field(ge=2000, le=2100)
    bio: str | None = None
    skills: str | None = None


class CompanyRegister(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)
    company_name: str = Field(min_length=2, max_length=255)
    industry: str = Field(min_length=2, max_length=255)
    website: str | None = None
    description: str | None = None


class AdminRegister(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)
    signup_key: str = Field(min_length=1)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str
    portal: str | None = None


class RefreshRequest(BaseModel):
    refresh_token: str


class LogoutRequest(BaseModel):
    refresh_token: str


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class VerifyOtpRequest(BaseModel):
    email: EmailStr
    otp: str = Field(min_length=6, max_length=6)


class ResetPasswordRequest(BaseModel):
    email: EmailStr | None = None
    token: str | None = None
    otp: str | None = None
    new_password: str = Field(min_length=8)


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8)


class ResendVerificationRequest(BaseModel):
    email: EmailStr


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    role: str
    user_id: int
    name: str | None = None
    email: str | None = None
    avatar_url: str | None = None


class CheckEmailRequest(BaseModel):
    email: EmailStr
    role: str | None = None


class GoogleAuthRequest(BaseModel):
    credential: str | None = None
    email: EmailStr | None = None
    name: str | None = None
    role: str = "STUDENT"


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    email: EmailStr
    role: str
    is_verified: bool
    verification_token: str | None = None