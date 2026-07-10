"""Reusable database wrapper — drop in with any connector package + .env."""
from __future__ import annotations

from db_wrapper.wrapper import DatabaseWrapper

_instance: DatabaseWrapper | None = None


def get_database() -> DatabaseWrapper:
    """Return a process-wide DatabaseWrapper (lazy singleton)."""
    global _instance
    if _instance is None:
        _instance = DatabaseWrapper()
    return _instance


def reset_database_singleton() -> None:
    """Drop cached wrapper (pytest session setup)."""
    global _instance
    _instance = None


__all__ = ["DatabaseWrapper", "get_database", "reset_database_singleton"]
