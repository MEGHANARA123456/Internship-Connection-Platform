# This is the main FastAPI application entry point.
# It starts the API, configures middleware, and runs supporting services like Mailpit.
import asyncio
from contextlib import asynccontextmanager
import logging
import socket

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.v1.router import api_router
from app.core.config import get_settings
from app.core.logging import configure_logging
from app.middleware.errors import unhandled_exception_handler
from app.middleware.security import SecurityMiddleware

logger = logging.getLogger(__name__)

# Check whether Mailpit is already running before starting a local one.
def is_port_in_use(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(('127.0.0.1', port)) == 0

# Application startup and shutdown lifecycle.
@asynccontextmanager
async def lifespan(app: FastAPI):
    mailpit_task = None
    if not is_port_in_use(8025):
        try:
            import uvicorn
            from app.services.mailpit_server import mailpit_app
            config = uvicorn.Config(mailpit_app, host="0.0.0.0", port=8025, log_level="warning")
            server = uvicorn.Server(config)
            mailpit_task = asyncio.create_task(server.serve())
        except Exception as exc:
            logger.warning("Could not start embedded Mailpit server: %s", exc)
            pass
    yield
    if mailpit_task:
        mailpit_task.cancel()

# Set up app logging before creating the FastAPI instance.
configure_logging()

# Create the API app and attach middleware and API routes.
app = FastAPI(title="Internship Connection Platform API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
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
)
app.add_middleware(SecurityMiddleware)
app.add_exception_handler(Exception, unhandled_exception_handler)
app.include_router(api_router, prefix="/api/v1")