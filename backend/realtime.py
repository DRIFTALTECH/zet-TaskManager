"""Change-version bus + WebSocket fan-out for live updates.

A monotonic integer per data channel ("tasks", "projects", "users") is bumped on
every relevant write. Connected WebSocket clients are pushed the new version
snapshot instantly, and only refetch the channel whose number actually changed.
A tiny `GET /sync/version` endpoint remains as a polling fallback for clients
that can't hold a socket open.

Counters are process-local and reset on restart, which is fine: a restart forces
clients to re-sync on their next message/poll anyway. For a multi-worker
deployment this would move to a shared store (Redis pub/sub), but the public API
stays the same.
"""

import asyncio
import json
import logging
import os
import threading

log = logging.getLogger("zet.realtime")

_lock = threading.Lock()
_versions: dict[str, int] = {"tasks": 0, "projects": 0, "users": 0}
CHANNELS = ("tasks", "projects", "users")

# ── Optional Redis fan-out (multi-worker / multi-container) ─────────────────────
# When REDIS_URL is set, version counters live in Redis (shared across workers)
# and writes are published so every worker pushes to its own WS clients. Unset →
# pure in-process behaviour (single worker), unchanged.
_REDIS_URL = os.environ.get("REDIS_URL", "").strip()
_REDIS_CHANNEL = "zet:sync"
try:
    import redis as _redis_sync_mod
except Exception:
    _redis_sync_mod = None
_redis_pub = _redis_sync_mod.from_url(_REDIS_URL) if (_REDIS_URL and _redis_sync_mod) else None

# WebSocket fan-out state. `_subscribers` holds live sockets; `_loop` is the
# server's running event loop, captured on the first connection so that the
# synchronous `bump()` (called from request threads) can schedule async sends.
_subscribers: set = set()
_loop: "asyncio.AbstractEventLoop | None" = None


def set_loop(loop: "asyncio.AbstractEventLoop") -> None:
    global _loop
    _loop = loop


def add_subscriber(ws) -> None:
    _subscribers.add(ws)


def remove_subscriber(ws) -> None:
    _subscribers.discard(ws)


def subscriber_count() -> int:
    return len(_subscribers)


async def _broadcast(payload: dict) -> None:
    dead = []
    for ws in list(_subscribers):
        try:
            await ws.send_json(payload)
        except Exception:
            dead.append(ws)
    for ws in dead:
        _subscribers.discard(ws)


def _notify() -> None:
    """Schedule a broadcast of the current snapshot onto the event loop.

    Safe to call from any thread: FastAPI runs sync endpoints in a threadpool,
    so writes that call `bump()` are usually off the loop thread. We hop back on
    with `run_coroutine_threadsafe`."""
    if _loop is None or not _subscribers:
        return
    payload = {"type": "sync", "versions": snapshot()}
    try:
        asyncio.run_coroutine_threadsafe(_broadcast(payload), _loop)
    except Exception:  # loop closed / shutting down
        log.debug("realtime broadcast skipped", exc_info=True)


def bump(*channels: str) -> None:
    """Increment one or more channels (e.g. bump('projects', 'users'))."""
    with _lock:
        for ch in channels:
            _versions[ch] = _versions.get(ch, 0) + 1
    if _redis_pub is not None:
        try:
            pipe = _redis_pub.pipeline()
            for ch in channels:
                pipe.incr(f"zet:ver:{ch}")
            pipe.publish(_REDIS_CHANNEL, json.dumps(list(channels)))
            pipe.execute()
        except Exception:
            log.debug("redis publish failed", exc_info=True)
    _notify()  # push to this worker's own WS clients


def current(channel: str) -> int:
    """Current version for a single channel."""
    return snapshot().get(channel, 0)


def snapshot() -> dict[str, int]:
    """All channel versions at once (for the /sync/version poll endpoint).
    Reads shared counters from Redis when configured, else the in-process map."""
    if _redis_pub is not None:
        try:
            vals = _redis_pub.mget(*[f"zet:ver:{c}" for c in CHANNELS])
            return {c: int(v or 0) for c, v in zip(CHANNELS, vals)}
        except Exception:
            log.debug("redis snapshot failed; using local", exc_info=True)
    with _lock:
        return dict(_versions)


async def redis_subscriber() -> None:
    """Per-worker task: on any worker's write, broadcast to THIS worker's WS clients.
    No-op unless REDIS_URL is set and redis is installed."""
    if not _REDIS_URL:
        return
    try:
        import redis.asyncio as redis_async
    except Exception:
        log.warning("REDIS_URL set but redis package unavailable; multi-worker fan-out disabled")
        return
    r = redis_async.from_url(_REDIS_URL)
    ps = r.pubsub()
    await ps.subscribe(_REDIS_CHANNEL)
    log.info("realtime: subscribed to Redis %s", _REDIS_CHANNEL)
    try:
        async for msg in ps.listen():
            if msg.get("type") != "message":
                continue
            await _broadcast({"type": "sync", "versions": snapshot()})
    except asyncio.CancelledError:
        pass
    finally:
        try:
            await ps.unsubscribe(_REDIS_CHANNEL)
            await r.aclose()
        except Exception:
            pass
