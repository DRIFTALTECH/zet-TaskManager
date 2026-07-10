"""SQLite connection pool for isolated pytest runs (never Aurora)."""
from __future__ import annotations

import logging
import sqlite3
import threading
from typing import Any

from db_wrapper.dialect import sqlite_path

log = logging.getLogger("zet.db.sqlite")


class SqliteConnectionPools:
    """Process-wide SQLite pool — reader and writer share the same file."""

    _instance: SqliteConnectionPools | None = None
    _instance_lock = threading.Lock()

    def __init__(self) -> None:
        self._pool_lock = threading.RLock()
        self._path = sqlite_path()

    @classmethod
    def instance(cls) -> SqliteConnectionPools:
        with cls._instance_lock:
            if cls._instance is None:
                cls._instance = SqliteConnectionPools()
            return cls._instance

    @classmethod
    def dispose_all(cls) -> None:
        with cls._instance_lock:
            cls._instance = None

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self._path, check_same_thread=False, isolation_level=None)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        return conn

    def checkout(self, *, write: bool) -> Any:
        del write  # same file for read/write in tests
        with self._pool_lock:
            return self._connect()

    def release(self, conn: Any, *, write: bool, close: bool = False) -> None:
        del write
        if conn is None:
            return
        try:
            conn.close()
        except Exception:
            log.exception("Error closing SQLite connection")
