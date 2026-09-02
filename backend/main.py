import logging
import logging.config
import os
import time
from pathlib import Path

from dotenv import load_dotenv

# Load backend/.env before routes import auth_logic (which reads MICROSOFT_CLIENT_ID at import time).
# override=True so a Lightsail/EC2 AWS_REGION (this box is ap-south-1) cannot
# beat the Aurora signing region in .env (cluster is ap-south-2).
load_dotenv(Path(__file__).resolve().parent / ".env", override=True)

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

from config import cors_origins, redis_url
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
    if redis_url():
        sub_task = asyncio.create_task(realtime.redis_subscriber())
    async with mcp_lifespan(app):
        yield
    if sub_task:
        sub_task.cancel()
        try:
            await sub_task
        except asyncio.CancelledError:
            pass


app = FastAPI(title="ZET Backend API", version="1.0.1", lifespan=lifespan)

_SLOW_REQUEST_MS = float(os.environ.get("DB_SLOW_QUERY_MS", "200"))

# ── Security headers ───────────────────────────────────────────────────────────
# The session token lives in localStorage, so an XSS anywhere in the frontend is
# account takeover. CSP is the containment. It is report-only by default because
# the app still ships inline styles; set CSP_ENFORCE=1 once the report log is clean.
_CSP = (
    "default-src 'self'; "
    "base-uri 'self'; "
    "object-src 'none'; "
    "frame-ancestors 'none'; "
    "img-src 'self' data: blob:; "
    "style-src 'self' 'unsafe-inline'; "
    "script-src 'self'; "
    "connect-src 'self' https://login.microsoftonline.com https://graph.microsoft.com; "
    "form-action 'self'"
)
_CSP_HEADER = (
    "Content-Security-Policy"
    if os.environ.get("CSP_ENFORCE", "").strip().lower() in ("1", "true", "yes")
    else "Content-Security-Policy-Report-Only"
)


@app.middleware("http")
async def security_headers(request, call_next):
    response = await call_next(request)
    response.headers.setdefault(_CSP_HEADER, _CSP)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("Permissions-Policy", "geolocation=(), microphone=(), camera=()")
    # HSTS only over TLS — sending it on plain http://localhost would pin dev to https.
    if request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https":
        response.headers.setdefault(
            "Strict-Transport-Security", "max-age=31536000; includeSubDomains"
        )
    return response


@app.middleware("http")
async def request_timing(request, call_next):
    t0 = time.perf_counter()
    response = await call_next(request)
    elapsed_ms = (time.perf_counter() - t0) * 1000
    if elapsed_ms > _SLOW_REQUEST_MS:
        log.warning("SLOW REQUEST %s %s %.1f ms", request.method, request.url.path, elapsed_ms)
    else:
        log.debug("REQUEST %s %s %.1f ms", request.method, request.url.path, elapsed_ms)
    return response

# CORS_ORIGINS is the allowlist and is required in production (see config.py).
# Do NOT add allow_origin_regex=".*" here — it silently overrides the allowlist.
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins(),
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
# Vendored third-party JS (MSAL for the OAuth consent page). Served from our own
# origin rather than a CDN: an auth page must not load code from a host we do not
# control, and a CDN outage would break Microsoft sign-in for MCP clients.
app.mount("/static", _SafeStatic(directory=str(Path(__file__).resolve().parent / "static")), name="static")
# Project background / photo files (served publicly; referenced by /projects payloads).
app.mount("/project-media", _SafeStatic(directory=str(PROJECT_MEDIA_DIR)), name="project-media")
# MCP endpoint lives at /mcp on the same server (clients connect to http://<host>:8000/mcp/).
app.mount("/mcp", mcp_asgi)
