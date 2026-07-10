"""Database entry point — Aurora via db_wrapper only."""
from __future__ import annotations

import logging

from db_wrapper import DatabaseWrapper, get_database

log = logging.getLogger("zet.db")

# Type alias for route Depends() annotations (was SQLAlchemy Session).
Db = DatabaseWrapper

# Stubs for legacy imports — ORM engine removed; models.py still uses Base.
engine = None


def SessionLocal() -> DatabaseWrapper:
    """Return the shared wrapper with request-scoped pooled connections."""
    db = get_database()
    db.enter_request_scope()
    return db


def wrapper_mode_enabled() -> bool:
    return True


def dispose_engine_pool() -> None:
    """Drop pooled DB connections (IAM token refresh / shutdown)."""
    from db_wrapper.pool import ConnectionPools

    ConnectionPools.dispose_all()


def get_db():
    db = get_database()
    db.enter_request_scope()
    try:
        yield db
    finally:
        db.close()


# SQLAlchemy declarative base — kept for model column metadata only.
from sqlalchemy.orm import declarative_base  # noqa: E402

Base = declarative_base()

USING_SQLITE = __import__("os").environ.get("ZET_TEST_SQLITE", "").strip().lower() in ("1", "true", "yes")
DATABASE_URL = ""
