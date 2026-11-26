# This is the main FastAPI application entry point.
# It starts the API, configures middleware, and runs supporting services like Mailpit.
import asyncio
import logging
import socket
import time
from collections.abc import Awaitable, Callable
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from alembic import command
from alembic.config import Config
from app.api.v1.router import api_router
from app.core.config import get_settings, validate_production_settings
from app.core.logging import configure_logging
from app.middleware.errors import unhandled_exception_handler
from app.middleware.security import SecurityMiddleware
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

logger = logging.getLogger(__name__)

def _run_migrations() -> None:
    """Upgrade the configured Alembic database to the latest revision."""
    backend_dir = Path(__file__).resolve().parents[1]
    config = Config(str(backend_dir / "alembic.ini"))
    config.set_main_option("script_location", str(backend_dir / "alembic"))
    command.upgrade(config, "head")

async def run_database_migrations() -> None:
    """Run synchronous Alembic upgrades in a worker thread and log migration failures."""
    try:
        await asyncio.to_thread(_run_migrations)
    except Exception:
        logger.exception(
            "Database is not migrated: run alembic upgrade head"
        )
        raise
    logger.info("Database schema is upgraded to the latest Alembic revision.")


async def seed_interview_catalog() -> None:
    """Keep the interview question bank and reusable test catalog available."""
    from app.core.database import async_session_factory
    from app.services.interview_question_seed import seed_interview_question_bank
    from app.services.learning_library_seed import seed_learning_library
    from app.services.mock_test_seed import seed_mock_test_library
    from app.services.skill_gap_seed import seed_skill_gap_catalog

    async with async_session_factory() as db:
        await seed_interview_question_bank(db)
        seeded_tests = await seed_mock_test_library(db)
        learning_seed = await seed_learning_library(db)
        skill_gap_seed = await seed_skill_gap_catalog(db)
    logger.info("Interview mock test catalog is ready.", extra={"seeded_tests": seeded_tests})
    logger.info("Student learning library is ready.", extra={"learning_catalog": learning_seed})
    logger.info("Skill gap catalog is ready.", extra={"skill_gap_catalog": skill_gap_seed})


async def _interview_reminder_worker() -> None:
    """Send pending interview reminders once per minute until the task is cancelled."""
    from app.core.database import async_session_factory
    from app.services.interview_reminders import send_interview_reminders

    while True:
        try:
            async with async_session_factory() as db:
                await send_interview_reminders(db)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Interview reminder delivery failed.")
        await asyncio.sleep(60)


async def _interview_expiry_worker() -> None:
    """Expire overdue interviews every five minutes until the task is cancelled."""
    from app.core.database import async_session_factory
    from app.services.interview_expiry import expire_overdue_interviews

    while True:
        try:
            async with async_session_factory() as db:
                await expire_overdue_interviews(db)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Overdue interview expiry failed.")
        await asyncio.sleep(300)


async def _interview_video_retention_worker() -> None:
    """Remove expired private video files and retire their metadata."""
    from app.core.database import async_session_factory
    from app.services.interview_video import expire_video_recordings

    while True:
        try:
            async with async_session_factory() as db:
                await expire_video_recordings(db)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Interview video retention cleanup failed.")
        await asyncio.sleep(600)


async def _interview_video_upload_worker() -> None:
    """Upload queued recordings one at a time and retry durable deletion records."""
    from app.core.database import async_session_factory
    from app.services.interview_video import (
        process_pending_video_uploads,
        process_recording_deletions,
    )

    while True:
        try:
            async with async_session_factory() as db:
                await process_pending_video_uploads(db, limit=1)
                await process_recording_deletions(db, limit=5)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Interview video storage worker failed.")
        await asyncio.sleep(5)


# Check whether Mailpit is already running before starting a local one.
def is_port_in_use(port: int, host: str = "127.0.0.1") -> bool:
    """Return whether the given host accepts a TCP connection on the specified port."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.5)
        return sock.connect_ex((host, port)) == 0

async def _cancel_task(task: asyncio.Task | None) -> None:
    """Cancel and await a task when present, swallowing its expected cancellation."""
    if task is None:
        return
    if task.done():
        return
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass

async def _cancel_tasks(*tasks: asyncio.Task | None) -> None:
    """Cancel multiple tasks sequentially and ignore anticipated shutdown cancellations."""
    for task in tasks:
        await _cancel_task(task)


async def _run_startup_step(
    name: str,
    operation: Callable[[], Awaitable[Any]],
    *,
    timeout_seconds: float | None = 10,
    required: bool = False,
) -> Any | None:
    """Time one startup operation, allowing optional dependencies to fail without blocking startup."""
    started_at = time.monotonic()
    logger.info("Startup step started.", extra={"startup_step": name})
    try:
        if timeout_seconds is None:
            result = await operation()
        else:
            result = await asyncio.wait_for(operation(), timeout=timeout_seconds)
    except asyncio.TimeoutError:
        elapsed = time.monotonic() - started_at
        logger.warning(
            "Startup step timed out%s.",
            "" if required else "; continuing",
            extra={"startup_step": name, "elapsed_seconds": elapsed},
        )
        if required:
            raise
        return None
    except Exception as error:
        elapsed = time.monotonic() - started_at
        logger.warning(
            "Startup step failed%s.",
            "" if required else "; continuing",
            extra={
                "startup_step": name,
                "elapsed_seconds": elapsed,
                "error_type": type(error).__name__,
            },
        )
        if required:
            raise
        return None
    elapsed = time.monotonic() - started_at
    logger.info(
        "Startup step completed.",
        extra={"startup_step": name, "elapsed_seconds": elapsed},
    )
    return result


async def _load_startup_settings():
    settings = await asyncio.to_thread(get_settings)
    await asyncio.to_thread(validate_production_settings, settings)
    return settings


async def _initialize_asset_storage(settings) -> None:
    if settings.asset_storage_backend != "s3":
        return
    from app.services.asset_storage import get_asset_storage

    await asyncio.to_thread(get_asset_storage, "s3", settings=settings)


async def _log_interview_llm_configuration(settings) -> None:
    logger.info(
        "INTERVIEW_LLM_API_KEY set: %s, provider: %s, model: %s",
        bool(settings.interview_llm_api_key.strip()),
        settings.interview_llm_provider.strip() or "unknown",
        settings.interview_llm_model.strip() or "unknown",
    )
    missing_interview_settings = [
        name
        for name, value in (
            ("INTERVIEW_LLM_PROVIDER", settings.interview_llm_provider),
            ("INTERVIEW_LLM_API_KEY", settings.interview_llm_api_key),
            ("INTERVIEW_LLM_MODEL", settings.interview_llm_model),
            ("INTERVIEW_LLM_BASE_URL", settings.interview_llm_base_url),
        )
        if not value.strip()
    ]
    if missing_interview_settings:
        logger.warning(
            "AI provider not configured: set %s",
            ", ".join(missing_interview_settings),
        )
    if settings.secret_key == "change-me-in-development" or len(settings.secret_key) < 32:
        logger.warning(
            "SECRET_KEY is using a development or short value; configure one stable secret "
            "shared by all API workers.",
        )


async def _recover_startup_work() -> tuple[int, int]:
    from app.core.database import async_session_factory
    from app.services.interview_studio import recover_stuck_evaluations
    from app.services.interview_video import recover_video_uploads

    async with async_session_factory() as db:
        recovered_evaluations = await recover_stuck_evaluations(db)
        recovered_video_uploads = await recover_video_uploads(db)
    return recovered_evaluations, recovered_video_uploads


async def _prepare_chatbot_knowledge() -> None:
    from app.chatbot.chatbot_config import load_config
    from app.chatbot.rag.ingest import ingest_knowledge

    chatbot_config = await asyncio.to_thread(load_config)
    if not chatbot_config.rag_enabled:
        return
    try:
        await ingest_knowledge(chatbot_config)
    except (SQLAlchemyError, OSError, RuntimeError, ValueError) as error:
        from app.chatbot.router import _service

        _service.vector_available = False
        logger.warning(
            "Chatbot hybrid index unavailable; using BM25 retrieval.",
            extra={"chatbot_meta": {"reason": type(error).__name__, "retrieval": "bm25"}},
        )
    except Exception:
        from app.chatbot.router import _service

        _service.vector_available = False
        raise


async def _start_background_workers() -> tuple[asyncio.Task, ...]:
    from app.services.interview_studio import interview_evaluation_worker

    return (
        asyncio.create_task(interview_evaluation_worker()),
        asyncio.create_task(_interview_reminder_worker()),
        asyncio.create_task(_interview_expiry_worker()),
        asyncio.create_task(_interview_video_retention_worker()),
        asyncio.create_task(_interview_video_upload_worker()),
    )


async def _start_mailpit_if_available() -> asyncio.Task | None:
    if await asyncio.to_thread(is_port_in_use, 8025):
        return None
    import uvicorn
    from app.services.mailpit_server import mailpit_app

    config = uvicorn.Config(
        mailpit_app,
        host="0.0.0.0",
        port=8025,
        log_level="warning",
    )
    return asyncio.create_task(uvicorn.Server(config).serve())


# Application startup and shutdown lifecycle.
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Migrate the database, ingest enabled chatbot knowledge, start workers, and stop them on shutdown."""
    settings = await _run_startup_step(
        "load and validate settings",
        _load_startup_settings,
        required=True,
    )
    await _run_startup_step(
        "initialize profile asset storage",
        lambda: _initialize_asset_storage(settings),
    )
    await _run_startup_step(
        "database migrations",
        run_database_migrations,
        timeout_seconds=None,
        required=True,
    )
    from app.services.interview_video import check_recording_storage_health

    await _run_startup_step(
        "recording storage health check",
        check_recording_storage_health,
    )
    await _run_startup_step(
        "interview LLM configuration",
        lambda: _log_interview_llm_configuration(settings),
    )
    await _run_startup_step("interview catalog seeding", seed_interview_catalog)
    recovery_result = await _run_startup_step(
        "interview evaluation and recording recovery",
        _recover_startup_work,
    )
    recovered_evaluations, recovered_video_uploads = recovery_result or (0, 0)
    if recovered_evaluations:
        logger.info(
            "Recovered interview evaluations after restart.",
            extra={"recovered_evaluations": recovered_evaluations},
        )
    if recovered_video_uploads:
        logger.info(
            "Recovered interview recording uploads after restart.",
            extra={"recovered_video_uploads": recovered_video_uploads},
        )
    await _run_startup_step("chatbot knowledge ingestion", _prepare_chatbot_knowledge)
    worker_tasks = await _run_startup_step(
        "background worker startup",
        _start_background_workers,
        required=True,
    )
    mailpit_task = await _run_startup_step(
        "embedded Mailpit startup",
        _start_mailpit_if_available,
    )
    try:
        yield
    finally:
        await _cancel_tasks(
            *(worker_tasks or ()),
            mailpit_task,
        )

# Set up app logging before creating the FastAPI instance.
configure_logging()

# Create the API app and attach middleware and API routes.
settings = get_settings()
is_production = settings.environment.strip().lower() == "production"
api_app = FastAPI(
    title="Internship Connection Platform API",
    version="0.1.0",
    lifespan=lifespan,
    debug=settings.debug and not is_production,
    docs_url=None if is_production else "/docs",
    redoc_url=None if is_production else "/redoc",
    openapi_url=None if is_production else "/openapi.json",
)
api_app.add_middleware(SecurityMiddleware)
api_app.add_exception_handler(Exception, unhandled_exception_handler)
api_app.include_router(api_router, prefix="/api/v1")


@api_app.get("/health", include_in_schema=False)
async def health_check() -> dict[str, str]:
    """Report healthy only when the configured database accepts a query."""
    from app.core.database import engine

    try:
        async with engine.connect() as connection:
            await connection.execute(text("SELECT 1"))
    except (SQLAlchemyError, OSError, TimeoutError) as error:
        logger.warning(
            "Health check database query failed.",
            extra={"error_type": type(error).__name__},
        )
        raise HTTPException(status_code=503, detail="Database unavailable") from error
    return {"status": "ok"}


class ApplicationCORSMiddleware(CORSMiddleware):
    """Keep FastAPI application attributes accessible while wrapping its full ASGI stack."""

    def __getattr__(self, name: str):
        return getattr(self.app, name)


app = ApplicationCORSMiddleware(
    app=api_app,
    allow_origins=(
        settings.allowed_cors_origins
        if is_production
        else list(dict.fromkeys([
            settings.frontend_url,
            *settings.allowed_cors_origins,
            "http://localhost:5173",
            "http://localhost:5174",
            "http://localhost:5175",
            "http://127.0.0.1:5173",
            "http://127.0.0.1:5174",
            "http://127.0.0.1:5175",
        ]))
    ),
    allow_origin_regex=(
        None
        if is_production
        else r"^https?://(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+)(:\d+)?$"
    ),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Retry-After"],
)
