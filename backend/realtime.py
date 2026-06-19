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
import logging
import threading

log = logging.getLogger("zet.realtime")

_lock = threading.Lock()
_versions: dict[str, int] = {"tasks": 0, "projects": 0, "users": 0}

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
    _notify()


def current(channel: str) -> int:
    """Current version for a single channel."""
    return _versions.get(channel, 0)


def snapshot() -> dict[str, int]:
    """All channel versions at once (for the /sync/version poll endpoint)."""
    with _lock:
        return dict(_versions)
