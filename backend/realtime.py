"""In-process change-version bus for lightweight smart polling.

A monotonic integer per data channel ("tasks", "projects", "users") is bumped on
every relevant write. Clients poll GET /sync/version (one tiny request) and only
refetch the channel whose number actually changed — turning heavy periodic
refetches into a near-zero-cost check.

Counters are process-local and reset on restart, which is fine: a restart forces
clients to re-sync on their next poll anyway. For a multi-worker deployment this
would move to a shared store (Redis / DB), but the public API stays the same.
"""

import threading

_lock = threading.Lock()
_versions: dict[str, int] = {"tasks": 0, "projects": 0, "users": 0}


def bump(*channels: str) -> None:
    """Increment one or more channels (e.g. bump('projects', 'users'))."""
    with _lock:
        for ch in channels:
            _versions[ch] = _versions.get(ch, 0) + 1


def current(channel: str) -> int:
    """Current version for a single channel."""
    return _versions.get(channel, 0)


def snapshot() -> dict[str, int]:
    """All channel versions at once (for the /sync/version poll endpoint)."""
    with _lock:
        return dict(_versions)
