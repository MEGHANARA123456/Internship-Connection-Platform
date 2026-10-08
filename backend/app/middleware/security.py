# -----------------------------------------------------------------------------
# Security middleware that applies request protections, rate limiting, and headers.
# -----------------------------------------------------------------------------

import time
from collections import defaultdict, deque

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from app.core.config import get_settings


class SecurityMiddleware(BaseHTTPMiddleware):
    def __init__(self, app):
        super().__init__(app)
        self.requests: dict[str, deque[float]] = defaultdict(deque)

    async def dispatch(self, request: Request, call_next):
        now = time.monotonic()
        key = request.client.host if request.client else "unknown"
        window = get_settings().rate_limit_window_seconds
        limit = get_settings().rate_limit_requests
        timestamps = self.requests[key]
        while timestamps and now - timestamps[0] >= window:
            timestamps.popleft()
        if len(timestamps) >= limit:
            response = JSONResponse({"detail": "Rate limit exceeded. Please try again later."}, status_code=429)
        else:
            timestamps.append(now)
            response = await call_next(request)

        # Apply robust HTTP security headers (OWASP, GDPR & Privacy Guidelines)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "SAMEORIGIN"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=(), payment=()"
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains; preload"
        if not request.url.path.startswith(("/docs", "/redoc", "/openapi.json")):
            response.headers["Content-Security-Policy"] = (
                "default-src 'none'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'"
            )
        return response