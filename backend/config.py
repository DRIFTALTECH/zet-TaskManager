"""Centralised environment config with production fail-fast.

In production (APP_ENV=production), missing/weak secrets raise on startup so the
app never runs with a forgeable JWT secret, the default admin password, or a
wide-open CORS policy. In development, safe dev defaults apply.
"""

import os

ENV = os.environ.get("APP_ENV", "development").strip().lower()
IS_PROD = ENV in ("prod", "production")


def _secret(name: str, dev_default: str, min_len: int = 32) -> str:
    val = os.environ.get(name, "").strip()
    if IS_PROD:
        if not val or val == dev_default:
            raise RuntimeError(
                f"{name} must be set to a non-default value in production (APP_ENV={ENV})."
            )
        if len(val) < min_len:
            raise RuntimeError(f"{name} must be at least {min_len} characters in production.")
        return val
    return val or dev_default


def cors_origins() -> list[str]:
    """Explicit allowlist from CORS_ORIGINS (comma-separated). Required in prod."""
    raw = os.environ.get("CORS_ORIGINS", "").strip()
    if raw:
        return [o.strip() for o in raw.split(",") if o.strip()]
    if IS_PROD:
        raise RuntimeError("CORS_ORIGINS must be set in production (comma-separated origins).")
    return [
        "http://localhost:8080",
        "http://127.0.0.1:8080",
        "http://localhost:5173",
    ]


# Secrets (validated above). Dev defaults match the historical values so local dev
# is unchanged; production rejects them.
JWT_SECRET = _secret("TASKMANAGER_JWT_SECRET", "dev-secret-change-me")
ADMIN_PASSWORD = _secret("ADMIN_PASSWORD", "Default@123", min_len=8)
