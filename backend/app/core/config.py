# Central application configuration.
# Values are loaded from environment variables and the local .env file.
from functools import lru_cache
from typing import Literal
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    # Database connection used by the app and by Alembic migrations.
    database_url: str = "postgresql+asyncpg://postgres:postgres@db:5432/internship_platform"
    secret_key: str = "change-me-in-development"
    frontend_url: str = "http://localhost:5174"
    google_client_id: str | None = None
    admin_emails: str = ""
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
    mail_use_tls: bool = True
    mail_use_ssl: bool = False
    mail_timeout: int = 15
    notify_email_on_role_close: bool = False
    max_resume_size_mb: int = 5
    resume_storage_path: str = "storage/resumes"
    company_document_storage_path: str = "storage/company_documents"
    rate_limit_requests: int = 300
    rate_limit_window_seconds: int = 60
    auth_rate_limit_requests: int = 10
    auth_rate_limit_window_seconds: int = 60
    trusted_proxies: str = ""
    rate_limit_backend: Literal["memory", "redis"] = "memory"
    rate_limit_redis_url: str | None = None
    gemini_api_key: str | None = None
    require_email_verification: bool = True
    require_company_email_verification: bool = False
    interview_auto_cancel_grace_minutes: int = 60
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

# Cache settings so environment values are loaded once for the runtime.
@lru_cache
def get_settings() -> Settings:
    return Settings()