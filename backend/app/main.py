# This is the main FastAPI application entry point.
# It starts the API, configures middleware, and runs supporting services like Mailpit.
import asyncio
from contextlib import asynccontextmanager
import logging
from pathlib import Path
import socket

from alembic import command
from alembic.config import Config
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.exc import SQLAlchemyError
from app.api.v1.router import api_router
from app.core.config import get_settings
from app.core.logging import configure_logging
from app.middleware.errors import unhandled_exception_handler
from app.middleware.security import SecurityMiddleware

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


# Application startup and shutdown lifecycle. 
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Migrate the database, ingest enabled chatbot knowledge, start workers, and stop them on shutdown."""
    await run_database_migrations()
    settings = get_settings()
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
    await seed_interview_catalog()
    from app.chatbot.chatbot_config import load_config
    from app.chatbot.rag.ingest import ingest_knowledge

    chatbot_config = load_config()
    if chatbot_config.rag_enabled:
        try:
            await ingest_knowledge(chatbot_config)
        except (SQLAlchemyError, OSError, RuntimeError, ValueError) as error:
            from app.chatbot.router import _service

            _service.vector_available = False
            logger.warning(
                "Chatbot hybrid index unavailable; using BM25 retrieval.",
                extra={"chatbot_meta": {"reason": type(error).__name__, "retrieval": "bm25"}},
            )
    mailpit_task: asyncio.Task | None = None
    reminder_task = asyncio.create_task(_interview_reminder_worker())
    expiry_task = asyncio.create_task(_interview_expiry_worker())
    video_retention_task = asyncio.create_task(_interview_video_retention_worker())
    try:
        if not is_port_in_use(8025):
            try:
                import uvicorn
                from app.services.mailpit_server import mailpit_app
                config = uvicorn.Config(mailpit_app, host="0.0.0.0", port=8025, log_level="warning")
                server = uvicorn.Server(config)
                mailpit_task = asyncio.create_task(server.serve())
            except Exception as exc:
                logger.warning("Could not start embedded Mailpit server: %s", exc)
        yield
    finally:
        await _cancel_tasks(
            reminder_task,
            expiry_task,
            video_retention_task,
            mailpit_task,
        )

# Set up app logging before creating the FastAPI instance.
configure_logging()

# Create the API app and attach middleware and API routes.
api_app = FastAPI(title="Internship Connection Platform API", version="0.1.0", lifespan=lifespan)
api_app.add_middleware(SecurityMiddleware)
api_app.add_exception_handler(Exception, unhandled_exception_handler)
api_app.include_router(api_router, prefix="/api/v1")


class ApplicationCORSMiddleware(CORSMiddleware):
    """Keep FastAPI application attributes accessible while wrapping its full ASGI stack."""

    def __getattr__(self, name: str):
        return getattr(self.app, name)


app = ApplicationCORSMiddleware(
    app=api_app,
    allow_origins=[
        get_settings().frontend_url,
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:5175",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:5174",
        "http://127.0.0.1:5175",
    ],
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Retry-After"],
)
