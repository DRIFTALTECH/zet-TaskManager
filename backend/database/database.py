import os
import sqlite3
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from sqlalchemy.pool import NullPool

_BACKEND_ROOT = Path(__file__).resolve().parent.parent
_DATA_DIR = _BACKEND_ROOT / "data"


def _db_path() -> Path:
    """SQLite file path. Override with TASKMANAGER_SQLITE_PATH for a writable location."""
    env = os.environ.get("TASKMANAGER_SQLITE_PATH", "").strip()
    if env:
        p = Path(env).expanduser()
        if not p.is_absolute():
            p = (_BACKEND_ROOT / p).resolve()
        else:
            p = p.resolve()
    else:
        p = (_DATA_DIR / "taskmanager.db").resolve()
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


_DB_FILE = _db_path()


def _sqlite_connect():
    """
    Open SQLite in read-write-create mode via URI so we never hit a read-only open.
    Requires the DB file's directory to be writable (for WAL / journal sidecars).
    """
    # file:///... from Path avoids ambiguity with relative vs absolute URLs
    uri = f"{_DB_FILE.as_uri()}?mode=rwc"
    return sqlite3.connect(
        uri,
        uri=True,
        timeout=30.0,
        check_same_thread=False,
    )


engine = create_engine(
    "sqlite://",
    creator=_sqlite_connect,
    poolclass=NullPool,
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# Helpful surface misconfiguration early (permissions, read-only FS)
if not os.access(_DB_FILE.parent, os.W_OK):
    raise RuntimeError(
        f"ZET database directory is not writable: {_DB_FILE.parent}. "
        "Fix permissions or set TASKMANAGER_SQLITE_PATH to a writable path."
    )
if _DB_FILE.exists() and not os.access(_DB_FILE, os.W_OK):
    raise RuntimeError(
        f"ZET database file is not writable: {_DB_FILE}. "
        "Run: chmod u+w on the file and data directory, or set TASKMANAGER_SQLITE_PATH."
    )
