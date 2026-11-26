# Central application configuration.
# Values are loaded from environment variables, the project-root .env, and the runtime .env.
from functools import lru_cache
from pathlib import Path
from typing import Literal
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import make_url

_ENV_FILES = tuple(dict.fromkeys((
    Path(__file__).resolve().parents[3] / ".env",
    Path.cwd() / ".env",
)))


class Settings(BaseSettings):
    # Database connection used by the app and by Alembic migrations.
    database_url: str = "postgresql+asyncpg://postgres:postgres@db:5432/internship_platform"
    secret_key: str = Field(default="change-me-in-development", repr=False)
    environment: str = "development"
    debug: bool = False
    frontend_url: str = "http://localhost:5174"
    cors_allowed_origins: str = ""
    google_client_id: str | None = None
    admin_emails: str = ""
    access_token_expire_minutes: int = 30
    refresh_token_expire_days: int = 7
    remember_me_refresh_token_expire_days: int = 30
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
    gemini_api_key: str | None = Field(default=None, repr=False)
    llm_providers: str = "groq"
    llm_tpm_limit: int = Field(default=6000, gt=0)
    llm_concurrency: int = Field(default=1, ge=1, le=2)
    llm_max_retries: int = Field(default=5, ge=1, le=10)
    llm_batch_max_prompt_tokens: int = Field(default=5000, gt=0)
    llm_batch_large_prompt_tokens: int = Field(default=2000, gt=0)
    llm_batch_provider_order: str = "gemini,groq,openrouter"
    groq_api_key: str = Field(default="", repr=False)
    groq_base_url: str = ""
    groq_model: str = ""
    groq_tpm_limit: int | None = Field(default=None, gt=0)
    groq_concurrency: int | None = Field(default=None, ge=1, le=2)
    gemini_base_url: str = "https://generativelanguage.googleapis.com/v1beta/openai"
    gemini_model: str = "gemini-2.0-flash"
    gemini_tpm_limit: int | None = Field(default=None, gt=0)
    gemini_concurrency: int | None = Field(default=None, ge=1, le=2)
    openrouter_api_key: str = Field(default="", repr=False)
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    openrouter_model: str = ""
    openrouter_tpm_limit: int | None = Field(default=None, gt=0)
    openrouter_concurrency: int | None = Field(default=None, ge=1, le=2)
    interview_llm_provider: str = "groq"
    interview_llm_base_url: str = "https://api.groq.com/openai"
    interview_llm_model: str = "openai/gpt-oss-20b"
    interview_llm_api_key: str = Field(default="", repr=False)
    interview_llm_timeout_seconds: float = Field(default=12.0, gt=0, le=60)
    interview_allowed_provider_hosts: list[str] = [
        "api.groq.com",
        "generativelanguage.googleapis.com",
        "openrouter.ai",
    ]
    interview_proctoring_max_violations: int = Field(default=3, gt=0, le=10)
    skill_gap_llm_enabled: bool = False
    interview_stt_base_url: str = "https://api.groq.com/openai"
    interview_stt_model: str = "whisper-large-v3-turbo"
    interview_stt_api_key: str = Field(default="", repr=False)
    interview_stt_timeout_seconds: float = Field(default=45.0, gt=0, le=120)
    interview_stt_max_audio_bytes: int = Field(default=10 * 1024 * 1024, gt=0)
    interview_stt_max_duration_seconds: int = Field(default=180, gt=0, le=600)
    interview_stt_requests_per_minute: int = Field(default=5, gt=0, le=60)
    interview_ffprobe_path: str = "ffprobe"
    interview_video_storage_path: str = "storage/interview_recordings"
    interview_video_max_chunk_bytes: int = Field(default=5 * 1024 * 1024, gt=0)
    interview_video_max_bytes: int = Field(default=250 * 1024 * 1024, gt=0)
    interview_video_max_duration_seconds: int = Field(default=1200, gt=0, le=3600)
    interview_video_retention_days: int = Field(default=30, gt=0, le=365)
    storage_backend: Literal["local", "gdrive", "s3"] = "local"
    interview_video_storage_backend: Literal["local", "gdrive"] | None = None
    s3_endpoint_url: str = ""
    s3_bucket: str = ""
    s3_access_key_id: str = Field(default="", repr=False)
    s3_secret_access_key: str = Field(default="", repr=False)
    s3_region: str = "auto"
    google_service_account_json: str = Field(default="", repr=False)
    gdrive_folder_id: str = ""
    video_retention_days: int | None = Field(default=None, ge=0, le=365)
    video_max_mb: int | None = Field(default=None, gt=0)
    video_max_seconds: int | None = Field(default=None, gt=0, le=3600)
    require_email_verification: bool = True
    require_company_email_verification: bool = False
    interview_auto_cancel_grace_minutes: int = 60
    model_config = SettingsConfigDict(env_file=_ENV_FILES, extra="ignore")

    @property
    def sqlalchemy_database_url(self) -> str:
        """Normalize PostgreSQL URLs and translate libpq sslmode for asyncpg."""
        url = make_url(self.database_url)
        if url.drivername in {"postgres", "postgresql"}:
            url = url.set(drivername="postgresql+asyncpg")
        query = dict(url.query)
        sslmode = query.pop("sslmode", None)
        if sslmode is not None and "ssl" not in query:
            query["ssl"] = sslmode
        return url.set(query=query).render_as_string(hide_password=False)

    @property
    def allowed_cors_origins(self) -> list[str]:
        return list(dict.fromkeys(
            origin.strip().rstrip("/")
            for origin in self.cors_allowed_origins.split(",")
            if origin.strip()
        ))

    @property
    def asset_storage_backend(self) -> Literal["local", "s3"]:
        """Select durable asset storage without changing legacy Drive recording setups."""
        return "s3" if self.storage_backend == "s3" else "local"

    @property
    def effective_interview_video_storage_backend(self) -> Literal["local", "gdrive"]:
        """Keep recording storage independently configurable from profile assets."""
        if self.interview_video_storage_backend is not None:
            return self.interview_video_storage_backend
        return "gdrive" if self.storage_backend == "gdrive" else "local"


def validate_production_settings(settings: Settings) -> None:
    """Reject unsafe or incomplete public deployment configuration."""
    if settings.environment.strip().lower() != "production":
        return
    if (
        not settings.secret_key.strip()
        or settings.secret_key == "change-me-in-development"
        or settings.secret_key.startswith("REPLACE_WITH_")
        or len(settings.secret_key) < 32
    ):
        raise RuntimeError(
            "Production startup requires SECRET_KEY with at least 32 characters."
        )
    if settings.debug:
        raise RuntimeError("DEBUG must be false in production.")
    origins = settings.allowed_cors_origins
    if not origins:
        raise RuntimeError(
            "Production startup requires CORS_ALLOWED_ORIGINS with HTTPS origins."
        )
    if any("*" in origin for origin in origins):
        raise RuntimeError("CORS_ALLOWED_ORIGINS must not contain a wildcard in production.")
    if any(not origin.startswith("https://") for origin in origins):
        raise RuntimeError("Production CORS origins must use HTTPS.")
    if not settings.frontend_url.startswith("https://"):
        raise RuntimeError("FRONTEND_URL must use HTTPS in production.")
    s3_values = (
        settings.s3_bucket.strip(),
        settings.s3_access_key_id.strip(),
        settings.s3_secret_access_key.strip(),
    )
    if settings.asset_storage_backend == "s3" and (
        not all(s3_values)
        or any(value.startswith("REPLACE_WITH_") for value in s3_values)
    ):
        raise RuntimeError(
            "STORAGE_BACKEND=s3 requires S3_BUCKET, S3_ACCESS_KEY_ID, "
            "and S3_SECRET_ACCESS_KEY in production."
        )


# Cache settings so environment values are loaded once for the runtime.
@lru_cache
def get_settings() -> Settings:
    """Return the cached application settings loaded from environment and .env."""
    return Settings()