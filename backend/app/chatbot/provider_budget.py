"""Process-wide provider token and request budgets shared across chatbot users."""

from collections import deque
from dataclasses import dataclass
import math
import time


@dataclass
class _UsageWindow:
    reservation_id: int
    timestamp: float
    reserved_tokens: int
    reserved_requests: int
    user_key: str = ""
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    retries: int = 0
    usage_reported: bool = False


class ProviderBudget:
    """Reserve conservative capacity before provider calls and reconcile reported usage."""

    def __init__(
        self,
        *,
        tokens_per_minute: int,
        tokens_per_day: int,
        requests_per_minute: int,
        requests_per_day: int,
        now=time.monotonic,
        user_share: float = 0.5,
    ):
        self.tokens_per_minute = tokens_per_minute
        self.tokens_per_day = tokens_per_day
        self.requests_per_minute = requests_per_minute
        self.requests_per_day = requests_per_day
        self._now = now
        self._user_share = user_share
        self._entries: deque[_UsageWindow] = deque()
        self._reservations: dict[int, _UsageWindow] = {}
        self._next_reservation_id = 1
        self._provider_cooldown_until = 0.0

    def reserve(
        self,
        user_key: str,
        tokens: int,
        requests: int,
    ) -> tuple[int | None, int | None]:
        """Return a reservation ID or a retry delay when shared or per-user capacity is full."""
        now = self._now()
        self._prune(now)
        if self._provider_cooldown_until > now:
            return None, max(1, math.ceil(self._provider_cooldown_until - now))

        checks = (
            (60.0, self.tokens_per_minute, self.requests_per_minute),
            (86400.0, self.tokens_per_day, self.requests_per_day),
        )
        retry_delays = []
        for duration, token_limit, request_limit in checks:
            if self._over_limit(
                self._entries,
                now,
                duration,
                tokens,
                requests,
                token_limit,
                request_limit,
            ):
                retry_delays.append(self._retry_delay(
                    self._entries,
                    now,
                    duration,
                    tokens,
                    requests,
                    token_limit,
                    request_limit,
                ))

            user_entries = [entry for entry in self._entries if entry.user_key == user_key]
            user_token_limit = max(1, math.floor(token_limit * self._user_share))
            user_request_limit = max(1, math.floor(request_limit * self._user_share))
            if self._over_limit(
                user_entries,
                now,
                duration,
                tokens,
                requests,
                user_token_limit,
                user_request_limit,
            ):
                retry_delays.append(self._retry_delay(
                    user_entries,
                    now,
                    duration,
                    tokens,
                    requests,
                    user_token_limit,
                    user_request_limit,
                ))

        if retry_delays:
            return None, max(retry_delays)

        entry = _UsageWindow(
            self._next_reservation_id,
            now,
            max(1, tokens),
            max(1, requests),
            user_key,
        )
        self._next_reservation_id += 1
        self._entries.append(entry)
        self._reservations[entry.reservation_id] = entry
        return entry.reservation_id, None

    def settle(
        self,
        reservation_id: int,
        *,
        prompt_tokens: int,
        completion_tokens: int,
        total_tokens: int,
        retries: int,
        usage_reported: bool,
    ) -> None:
        """Record provider usage and release conservative reservations not needed by actual usage."""
        entry = self._reservations.pop(reservation_id, None)
        if entry is None:
            return
        entry.prompt_tokens = max(0, prompt_tokens)
        entry.completion_tokens = max(0, completion_tokens)
        entry.total_tokens = max(0, total_tokens)
        entry.retries = max(0, retries)
        entry.usage_reported = usage_reported
        if usage_reported:
            entry.reserved_tokens = max(1, total_tokens)
        entry.reserved_requests = min(entry.reserved_requests, max(1, retries + 1))

    def note_rate_limit(self, retry_after: int) -> None:
        """Pause provider reservations for the interval supplied by its 429 response."""
        self._provider_cooldown_until = max(
            self._provider_cooldown_until,
            self._now() + max(1, retry_after),
        )

    def snapshot(self) -> dict[str, int | float]:
        """Return token, request, retry, and average-usage counters for minute and day windows."""
        now = self._now()
        self._prune(now)
        minute = [entry for entry in self._entries if entry.timestamp > now - 60]
        day = [entry for entry in self._entries if entry.timestamp > now - 86400]

        def actual_total(entries: list[_UsageWindow]) -> int:
            return sum(entry.total_tokens for entry in entries if entry.usage_reported)

        actual_requests = sum(
            entry.reserved_requests for entry in day if entry.usage_reported
        )
        actual_tokens = actual_total(day)
        cooldown = max(0, math.ceil(self._provider_cooldown_until - now))
        return {
            "requests_per_minute": sum(entry.reserved_requests for entry in minute),
            "requests_per_day": sum(entry.reserved_requests for entry in day),
            "tokens_per_minute": actual_total(minute),
            "tokens_per_day": actual_tokens,
            "average_tokens_per_request": round(actual_tokens / actual_requests, 2)
            if actual_requests else 0,
            "retries_per_day": sum(entry.retries for entry in day),
            "provider_cooldown_seconds": cooldown,
        }

    def _prune(self, now: float) -> None:
        while self._entries and self._entries[0].timestamp <= now - 86400:
            entry = self._entries.popleft()
            self._reservations.pop(entry.reservation_id, None)

    @staticmethod
    def _over_limit(
        entries: list[_UsageWindow] | deque[_UsageWindow],
        now: float,
        duration: float,
        tokens: int,
        requests: int,
        token_limit: int,
        request_limit: int,
    ) -> bool:
        current = [entry for entry in entries if entry.timestamp > now - duration]
        return (
            sum(entry.reserved_tokens for entry in current) + tokens > token_limit
            or sum(entry.reserved_requests for entry in current) + requests > request_limit
        )

    @staticmethod
    def _retry_delay(
        entries: list[_UsageWindow] | deque[_UsageWindow],
        now: float,
        duration: float,
        tokens: int,
        requests: int,
        token_limit: int,
        request_limit: int,
    ) -> int:
        current = sorted(
            (entry for entry in entries if entry.timestamp > now - duration),
            key=lambda entry: entry.timestamp,
        )
        for candidate in current:
            remaining = [
                entry for entry in current
                if entry.timestamp > candidate.timestamp
            ]
            if (
                sum(entry.reserved_tokens for entry in remaining) + tokens <= token_limit
                and sum(entry.reserved_requests for entry in remaining) + requests <= request_limit
            ):
                return max(1, math.ceil(candidate.timestamp + duration - now))
        return max(1, math.ceil(current[0].timestamp + duration - now)) if current else 1
