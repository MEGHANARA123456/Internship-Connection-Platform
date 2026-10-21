# -----------------------------------------------------------------------------
# Security middleware that applies request protections, rate limiting, and headers.
# -----------------------------------------------------------------------------

import hashlib
import ipaddress
import logging
import secrets
import threading
import time
from collections import deque
from collections.abc import Iterable

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from app.core.config import get_settings
from app.core.security import decode_token

logger = logging.getLogger(__name__)

_REDIS_LIMIT_SCRIPT = """
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - window)
redis.call('ZADD', KEYS[1], now, ARGV[4])
local count = redis.call('ZCARD', KEYS[1])
if count > limit then
  redis.call('ZREM', KEYS[1], ARGV[4])
  local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
  redis.call('EXPIRE', KEYS[1], window)
  return {0, math.max(1, math.ceil(tonumber(oldest[2]) + window - now))}
end
redis.call('EXPIRE', KEYS[1], window)
return {1, 0}
"""
def _trusted_proxy_networks(value: str) -> list[ipaddress.IPv4Network | ipaddress.IPv6Network]:
    networks = []
    for item in value.split(","):
        item = item.strip()
        if not item:
            continue
        try:
            networks.append(ipaddress.ip_network(item, strict=False))
        except ValueError:
            logger.warning("Ignoring invalid TRUSTED_PROXIES entry: %s", item)
    return networks

def _is_trusted(address: str, networks: Iterable[ipaddress.IPv4Network | ipaddress.IPv6Network]) -> bool:
    try:
        ip = ipaddress.ip_address(address)
    except ValueError:
        return False
    return any(ip in network for network in networks if ip.version == network.version)

def _client_ip(request: Request, trusted_proxies: str) -> str:
    remote = request.client.host if request.client else "unknown"
    networks = _trusted_proxy_networks(trusted_proxies)
    if not networks or not _is_trusted(remote, networks):
        return remote

    forwarded = request.headers.get("x-forwarded-for", "")
    chain = [item.strip() for item in forwarded.split(",") if item.strip()]
    chain.append(remote)
    while len(chain) > 1 and _is_trusted(chain[-1], networks):
        chain.pop()
    return chain[-1]

def _strict_auth_route(path: str) -> bool:
    if not path.startswith("/api/v1/auth/"):
        return False
    endpoint = path.removeprefix("/api/v1/auth/")
    return (
        endpoint in {"login", "google"}
        or endpoint.startswith("register/")
        or endpoint in {"forgot-password", "verify-otp", "reset-password", "check-email", "resend-verification"}
        or endpoint == "verify"
        or endpoint.startswith("verify/")
        or endpoint.startswith("mfa/")
    )

async def _request_email(request: Request) -> str | None:
    try:
        payload = await request.json()
    except (ValueError, UnicodeDecodeError):
        return None
    email = payload.get("email") if isinstance(payload, dict) else None
    if not isinstance(email, str) or not email.strip():
        return None
    return hashlib.sha256(email.strip().lower().encode()).hexdigest()

def _authenticated_user_id(request: Request) -> str | None:
    authorization = request.headers.get("authorization", "")
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        return None
    try:
        payload = decode_token(token)
        if payload.get("type") != "access":
            return None
        return str(int(payload["sub"]))
    except (ValueError, TypeError, KeyError):
        return None

class SecurityMiddleware(BaseHTTPMiddleware):
    def __init__(self, app):
        super().__init__(app)
        self.requests: dict[str, deque[float]] = {}
        self._lock = threading.Lock()
        self._last_cleanup = time.monotonic()
        self._redis = None

        settings = get_settings()
        if settings.rate_limit_backend == "redis":
            if not settings.rate_limit_redis_url:
                raise ValueError("RATE_LIMIT_REDIS_URL is required when RATE_LIMIT_BACKEND=redis")
            try:
                # pyrefly: ignore [missing-import]
                from redis.asyncio import Redis
            except ImportError as exc:
                raise RuntimeError(
                    "Install the redis package to use RATE_LIMIT_BACKEND=redis"
                ) from exc
            self._redis = Redis.from_url(settings.rate_limit_redis_url, decode_responses=True)

    async def _allow(self, key: str, limit: int, window: int) -> tuple[bool, int]:
        now = time.time() if self._redis is not None else time.monotonic()
        if self._redis is not None:
            result = await self._redis.eval(
                _REDIS_LIMIT_SCRIPT,
                1,
                f"rate-limit:{key}",
                now,
                window,
                limit,
                f"{now}:{secrets.token_hex(8)}",
            )
            return bool(int(result[0])), int(result[1])

        with self._lock:
            if now - self._last_cleanup >= window:
                cutoff = now - window
                for idle_key, timestamps in list(self.requests.items()):
                    while timestamps and timestamps[0] <= cutoff:
                        timestamps.popleft()
                    if not timestamps:
                        del self.requests[idle_key]
                self._last_cleanup = now

            current = self.requests.setdefault(key, deque())
            while current and now - current[0] >= window:
                current.popleft()
            if len(current) >= limit:
                return False, max(1, int(current[0] + window - now + 0.999))
            current.append(now)
        return True, 0

    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        settings = get_settings()
        is_websocket = request.scope.get("type") == "websocket"
        is_health = path.rstrip("/") in {"/health", "/api/v1/health"}
        if is_websocket or is_health:
            response = await call_next(request)
        else:
            ip = _client_ip(request, settings.trusted_proxies)
            if _strict_auth_route(path):
                limit = settings.auth_rate_limit_requests
                window = settings.auth_rate_limit_window_seconds
                keys = [f"auth:ip:{ip}"]
                email_hash = await _request_email(request)
                if email_hash:
                    keys.append(f"auth:email:{email_hash}")
            else:
                limit = settings.rate_limit_requests
                window = settings.rate_limit_window_seconds
                user_id = _authenticated_user_id(request)
                keys = [f"user:{user_id}" if user_id else f"ip:{ip}"]

            retry_after = 0
            allowed = True
            for key in keys:
                key_allowed, wait_seconds = await self._allow(key, limit, window)
                if not key_allowed:
                    allowed = False
                    retry_after = max(retry_after, wait_seconds)
            if not allowed:
                response = JSONResponse(
                    {
                        "detail": (
                            f"Rate limit exceeded. Please retry in {retry_after} seconds."
                        )
                    },
                    status_code=429,
                    headers={"Retry-After": str(retry_after)},
                )
            else:
                response = await call_next(request)

        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "SAMEORIGIN"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=(), payment=()"
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains; preload"
        if not path.startswith(("/docs", "/redoc", "/openapi.json")):
            response.headers["Content-Security-Policy"] = (
                "default-src 'none'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'"
            )
        return response
