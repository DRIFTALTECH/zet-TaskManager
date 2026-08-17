"""In-process sliding-window rate limiter.

Protects the endpoints where unlimited retries are the attack: password login
(credential stuffing, and bcrypt makes each attempt expensive enough to be a DoS
on its own), sign-up (account spam), and the AI routes (every call bills a real
API key).

Counters are per-process. Behind several workers the effective limit is
`limit x workers`, which is still a hard ceiling — set REDIS_URL and move this to
a shared store if you need the exact number enforced globally.
"""

import os
import threading
import time

from fastapi import HTTPException, Request, status

# Trust proxy headers only when explicitly enabled — otherwise a client can spoof
# X-Forwarded-For and get a fresh bucket per request.
_TRUST_PROXY = os.environ.get("TRUST_PROXY_HEADERS", "").strip().lower() in ("1", "true", "yes")

_lock = threading.Lock()
_hits: dict[str, list[float]] = {}
_LAST_SWEEP = [0.0]


def client_ip(request: Request) -> str:
    if _TRUST_PROXY:
        fwd = request.headers.get("x-forwarded-for", "")
        if fwd:
            return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _sweep(now: float, window: float) -> None:
    """Drop buckets nobody has touched for a while so memory cannot grow forever."""
    if now - _LAST_SWEEP[0] < 60:
        return
    _LAST_SWEEP[0] = now
    cutoff = now - max(window, 3600)
    for key in [k for k, v in _hits.items() if not v or v[-1] < cutoff]:
        _hits.pop(key, None)


def check(bucket: str, identity: str, *, limit: int, window_seconds: int) -> None:
    """Allow `limit` events per `window_seconds` for (bucket, identity). Raises 429."""
    key = f"{bucket}:{identity}"
    now = time.monotonic()
    with _lock:
        _sweep(now, window_seconds)
        stamps = [t for t in _hits.get(key, ()) if now - t < window_seconds]
        if len(stamps) >= limit:
            retry_after = int(window_seconds - (now - stamps[0])) + 1
            _hits[key] = stamps
            raise HTTPException(
                status.HTTP_429_TOO_MANY_REQUESTS,
                "Too many attempts. Try again in a moment.",
                headers={"Retry-After": str(retry_after)},
            )
        stamps.append(now)
        _hits[key] = stamps


def reset() -> None:
    """Clear all buckets (tests)."""
    with _lock:
        _hits.clear()
