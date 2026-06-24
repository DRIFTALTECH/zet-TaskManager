import logging
import logging.config
import os
from pathlib import Path

from dotenv import load_dotenv

# Load backend/.env before routes import auth_logic (which reads MICROSOFT_CLIENT_ID at import time).
load_dotenv(Path(__file__).resolve().parent / ".env")

# ── Logging ─────────────────────────────────────────────────────────────────────
logging.config.dictConfig({
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "standard": {"format": "%(asctime)s %(levelname)s %(name)s | %(message)s"},
    },
    "handlers": {
        "console": {"class": "logging.StreamHandler", "formatter": "standard"},
    },
    "root": {"handlers": ["console"], "level": os.environ.get("LOG_LEVEL", "INFO")},
})
log = logging.getLogger("zet")

# ── Error monitoring (only when SENTRY_DSN is set) ──────────────────────────────
if _dsn := os.environ.get("SENTRY_DSN"):
    try:
        import sentry_sdk
        sentry_sdk.init(dsn=_dsn, traces_sample_rate=float(os.environ.get("SENTRY_TRACES_RATE", "0.1")),
                        environment=os.environ.get("APP_ENV", "development"))
        log.info("Sentry error monitoring enabled")
    except Exception:
        log.warning("SENTRY_DSN set but sentry-sdk unavailable; skipping", exc_info=True)

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from config import cors_origins
from database.init_db import init_db
from logic.project_logic import PROJECT_MEDIA_DIR
from mcp_app import build_mcp_asgi
from routes import register_routes

init_db()

# Embedded MCP server — same process and port, mounted at /mcp.
mcp_asgi, mcp_lifespan = build_mcp_asgi()

import asyncio
from contextlib import asynccontextmanager

import realtime


@asynccontextmanager
async def lifespan(app):
    """Run the MCP lifespan and, when REDIS_URL is set, a Redis fan-out subscriber
    so realtime works across multiple workers/containers."""
    sub_task = None
    if os.environ.get("REDIS_URL"):
        sub_task = asyncio.create_task(realtime.redis_subscriber())
    async with mcp_lifespan(app):
        yield
    if sub_task:
        sub_task.cancel()


app = FastAPI(title="ZET Backend API", version="1.0.1", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins(),
    allow_origin_regex=".*",  # ponytail: allow-all CORS for now — delete this line to restore cors_origins() allowlist
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class _SafeStatic(StaticFiles):
    """StaticFiles that sends X-Content-Type-Options: nosniff so a stored file is
    never MIME-sniffed into executable/inline content (defence against stored XSS)."""

    async def get_response(self, path, scope):
        resp = await super().get_response(path, scope)
        resp.headers["X-Content-Type-Options"] = "nosniff"
        return resp


app.include_router(register_routes())
# Project background / photo files (served publicly; referenced by /projects payloads).
app.mount("/project-media", _SafeStatic(directory=str(PROJECT_MEDIA_DIR)), name="project-media")
# MCP endpoint lives at /mcp on the same server (clients connect to http://<host>:8000/mcp/).
app.mount("/mcp", mcp_asgi)
