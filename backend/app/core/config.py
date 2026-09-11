from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://postgres:postgres@db:5432/internship_platform"
    secret_key: str = "change-me-in-development"
    frontend_url: str = "http://localhost:5174"
    access_token_expire_minutes: int = 30
    refresh_token_expire_days: int = 7
    mailpit_host: str = "127.0.0.1"
    mailpit_port: int = 1025
    mail_username: str | None = None
    mail_password: str | None = None
    mail_from: str = "noreply@internship.local"
    mail_port: int = 587
    mail_server: str | None = None
    mail_from_name: str = "Internship Platform"
    max_resume_size_mb: int = 5
    resume_storage_path: str = "storage/resumes"
    rate_limit_requests: int = 120
    rate_limit_window_seconds: int = 60
    admin_signup_key: str = "change-admin-signup-key"
    gemini_api_key: str | None = None
    require_email_verification: bool = True
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


@lru_cache
def get_settings() -> Settings:
    return Settings()