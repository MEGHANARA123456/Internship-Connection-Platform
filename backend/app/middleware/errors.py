# -----------------------------------------------------------------------------
# Custom error handling middleware for consistent API error responses.
# -----------------------------------------------------------------------------

import logging
import re

from fastapi import Request
from fastapi.responses import JSONResponse
from app.core.config import get_settings

logger = logging.getLogger(__name__)
LOCAL_CORS_ORIGIN = re.compile(
    r"^https?://(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+)(:\d+)?$"
)

async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Log an unhandled request error and return a generic 500 with allowed-origin CORS headers."""
    logger.exception("Unhandled request exception", extra={"path": request.url.path, "method": request.method})
    
    headers = {}
    origin = request.headers.get("origin")
    if origin and (
        origin == get_settings().frontend_url
        or LOCAL_CORS_ORIGIN.fullmatch(origin)
    ):
        headers["Access-Control-Allow-Origin"] = origin
        headers["Access-Control-Allow-Credentials"] = "true"
        headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD"
        headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type, X-Requested-With"
        headers["Vary"] = "Origin"

    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"},
        headers=headers,
    )