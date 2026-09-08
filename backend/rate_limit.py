"""Small in-process rate limiter for the public conversation surface.

The kiosk endpoints are intentionally unauthenticated, so an IP budget is the
last cheap guard before a request reaches speech recognition, a hosted model, or
text-to-speech. This is deliberately process-local: deployments with multiple
workers should put the same policy at the edge or back it with shared storage.
"""

from collections import deque
from math import ceil
from threading import Lock
import time

#: Per-IP requests per minute, by route.
#:
#: These are per *client address*, and a cabinet's browser shares a machine with
#: its backend — so every visitor at one panel draws on one budget. That is the
#: right granularity for abuse (one cabinet is one actor from outside) and the
#: numbers are set with it in mind: 30 chat turns a minute is more than a queue
#: of people can speak.
PUBLIC_LIMITS = {
    "/api/chat": 30,
    "/api/listen": 120,
    "/api/speak": 120,
    "/api/auth/login": 10,
}

#: Try-on is the one open route that spends money per call and holds a
#: connection for up to ninety seconds, so it gets the tightest budget. Its path
#: carries a product id, so it is matched by prefix — a dictionary keyed on
#: exact paths never matched it at all.
TRYON_PREFIX = "/api/tryon/"
TRYON_LIMIT = 10


def limit_for(path: str) -> int | None:
    """Requests per minute allowed on this path, or None for no budget."""
    if path in PUBLIC_LIMITS:
        return PUBLIC_LIMITS[path]
    return TRYON_LIMIT if path.startswith(TRYON_PREFIX) else None


class RateLimiter:
    def __init__(self, window_seconds: int = 60) -> None:
        self.window_seconds = window_seconds
        self._events: dict[tuple[str, str], deque[float]] = {}
        self._last_cleanup = 0.0
        self._lock = Lock()

    def allow(self, ip: str, route: str, limit: int) -> tuple[bool, int]:
        """Return ``(allowed, retry_after_seconds)`` for one IP and route."""
        now = time.monotonic()
        key = (ip, route)
        cutoff = now - self.window_seconds

        with self._lock:
            events = self._events.setdefault(key, deque())
            while events and events[0] <= cutoff:
                events.popleft()

            if len(events) >= limit:
                return False, max(1, ceil(events[0] + self.window_seconds - now))

            events.append(now)
            if now - self._last_cleanup >= self.window_seconds:
                self._last_cleanup = now
                for stale_key, stale_events in list(self._events.items()):
                    while stale_events and stale_events[0] <= cutoff:
                        stale_events.popleft()
                    if not stale_events:
                        del self._events[stale_key]

        return True, 0
