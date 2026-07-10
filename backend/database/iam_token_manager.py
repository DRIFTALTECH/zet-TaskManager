"""Aurora PostgreSQL IAM authentication token manager (boto3)."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable

import boto3

log = logging.getLogger("zet.db.iam")

_BACKEND_ROOT = Path(__file__).resolve().parent.parent
CACHE_DIR = _BACKEND_ROOT / ".cache"
TOKEN_FILE = CACHE_DIR / "dbtoken.json"

TOKEN_TTL_SECONDS = 15 * 60
REFRESH_INTERVAL_SECONDS = 12 * 60

_EMPTY_CACHE = {"token": "", "generatedAt": "", "expiresAt": ""}

_lock = threading.Lock()
_token_data: dict[str, str] = dict(_EMPTY_CACHE)


def iam_auth_enabled() -> bool:
    value = os.environ.get("DB_IAM_AUTH", "").strip().lower()
    return value in ("1", "true", "yes", "on")


def _connection_settings() -> tuple[str, int, str, str]:
    """Return hostname, port, username, region from env (RDS_* overrides URL parts)."""
    hostname = os.environ.get("RDS_HOSTNAME", "").strip()
    port = int(os.environ.get("RDS_PORT", "5432"))
    username = os.environ.get("RDS_USERNAME", "").strip()
    region = (
        os.environ.get("AWS_REGION", "").strip()
        or os.environ.get("AWS_DEFAULT_REGION", "").strip()
    )

    database_url = os.environ.get("DATABASE_URL", "").strip()
    if database_url and not database_url.startswith("sqlite"):
        from sqlalchemy.engine.url import make_url

        parsed = make_url(database_url)
        hostname = hostname or (parsed.host or "")
        port = parsed.port or port
        username = username or (parsed.username or "")

    if not hostname or not username or not region:
        raise RuntimeError(
            "DB_IAM_AUTH is enabled but RDS_HOSTNAME (or DATABASE_URL host), "
            "RDS_USERNAME (or DATABASE_URL user), and AWS_REGION must be set."
        )
    return hostname, port, username, region


def _ensure_cache_file() -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    if not TOKEN_FILE.exists():
        _write_cache_file(dict(_EMPTY_CACHE))


def _write_cache_file(data: dict[str, str]) -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    with TOKEN_FILE.open("w", encoding="utf-8") as handle:
        json.dump(data, handle, indent=2)
        handle.write("\n")
    log.info("IAM database token written to cache (%s)", TOKEN_FILE)


def _generate_rds_token() -> dict[str, str]:
    hostname, port, username, region = _connection_settings()
    client = boto3.client("rds", region_name=region)
    token = client.generate_db_auth_token(
        DBHostname=hostname,
        Port=port,
        DBUsername=username,
        Region=region,
    )
    now = datetime.now(timezone.utc)
    expires = now + timedelta(seconds=TOKEN_TTL_SECONDS)
    return {
        "token": token,
        "generatedAt": now.isoformat(),
        "expiresAt": expires.isoformat(),
    }


def get_token() -> str:
    with _lock:
        token = _token_data.get("token", "")
        if not token:
            raise RuntimeError("IAM database token is not available yet")
        return token


def refresh_token(*, is_startup: bool = False) -> None:
    with _lock:
        data = _generate_rds_token()
        _token_data.clear()
        _token_data.update(data)
        _write_cache_file(data)
        if is_startup:
            log.info("IAM database token generated on startup (expires %s)", data["expiresAt"])
        else:
            log.info("IAM database token refreshed (expires %s)", data["expiresAt"])


def ensure_token_ready() -> None:
    """Generate the first token before any DB connection (e.g. init_db at import)."""
    if not iam_auth_enabled():
        return
    _ensure_cache_file()
    with _lock:
        if _token_data.get("token"):
            return
        data = _generate_rds_token()
        _token_data.update(data)
        _write_cache_file(data)
        log.info("IAM database token generated (expires %s)", data["expiresAt"])


async def run_refresh_loop(dispose_connections: Callable[[], None]) -> None:
    """Refresh the IAM token every 12 minutes and invalidate pooled DB connections."""
    if not iam_auth_enabled():
        return

    while True:
        await asyncio.sleep(REFRESH_INTERVAL_SECONDS)
        try:
            refresh_token(is_startup=False)
            dispose_connections()
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("Failed to refresh IAM database token")
