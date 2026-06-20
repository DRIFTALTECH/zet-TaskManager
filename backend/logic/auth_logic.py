import os
import secrets
import ssl
import uuid
from datetime import datetime, timedelta, timezone

import bcrypt
import certifi
import jwt
from fastapi import HTTPException, status
from jwt import PyJWKClient
from sqlalchemy.orm import Session

import crud.settings as settings_crud
import crud.users as users_crud
from config import ADMIN_PASSWORD, JWT_SECRET
from logic import user_logic
from logic.schemas import LoginBody, LoginResponse, MicrosoftAuthBody, RegisterBody

# JWT_SECRET imported from config (fail-fast on weak/default in production).
JWT_ALGO = "HS256"
JWT_EXPIRE_HOURS_DEFAULT = 24         # 1 day when "remember me" is off
JWT_EXPIRE_HOURS_REMEMBER = 24 * 30   # 30 days when "remember me" is on

# ── Admin console credentials ──────────────────────────────────────────────────
# A standalone admin (NOT a normal user row) manages accounts at /admin.
# ADMIN_PASSWORD imported from config (rejects the default in production). The
# password can also be changed at runtime, which persists a bcrypt hash in
# app_settings that wins over the env value.
ADMIN_USERNAME = (os.environ.get("ADMIN_USERNAME", "").strip() or "admin")
ADMIN_SUBJECT = "__admin__"
_ADMIN_PW_KEY = "admin_password_hash"

_DEFAULT_MICROSOFT_CLIENT_ID = "eb4d79fc-169b-4d89-b381-e239ec7dfe5e"
_DEFAULT_MICROSOFT_TENANT_ID = "567ad03c-3f9a-42e7-bc13-9f75f6bc87b6"

MICROSOFT_CLIENT_ID = os.environ.get("MICROSOFT_CLIENT_ID", "").strip() or _DEFAULT_MICROSOFT_CLIENT_ID
MICROSOFT_TENANT_ID = os.environ.get("MICROSOFT_TENANT_ID", "").strip() or _DEFAULT_MICROSOFT_TENANT_ID
# Tenant-specific JWKS avoids edge-case validation issues for single-tenant apps; falls back to common.
MICROSOFT_JWKS_URL = (
    f"https://login.microsoftonline.com/{MICROSOFT_TENANT_ID}/discovery/v2.0/keys"
    if MICROSOFT_TENANT_ID
    else "https://login.microsoftonline.com/common/discovery/v2.0/keys"
)
_py_jwks_client: PyJWKClient | None = None


def _microsoft_jwks() -> PyJWKClient:
    global _py_jwks_client
    if _py_jwks_client is None:
        # macOS / some Python builds lack a usable default CA store for urllib; certifi fixes JWKS fetch.
        ssl_ctx = ssl.create_default_context(cafile=certifi.where())
        _py_jwks_client = PyJWKClient(MICROSOFT_JWKS_URL, ssl_context=ssl_ctx)
    return _py_jwks_client


def _decode_microsoft_id_token(id_token: str) -> dict:
    if not MICROSOFT_CLIENT_ID:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Microsoft sign-in is not configured on the server (set MICROSOFT_CLIENT_ID).",
        )
    try:
        signing_key = _microsoft_jwks().get_signing_key_from_jwt(id_token)
        payload = jwt.decode(
            id_token,
            signing_key.key,
            algorithms=["RS256"],
            audience=MICROSOFT_CLIENT_ID,
            options={"verify_exp": True, "verify_aud": True, "verify_iss": False},
        )
    except jwt.ExpiredSignatureError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Microsoft sign-in session expired. Try again.")
    except jwt.PyJWTError as e:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, f"Invalid Microsoft token: {e!s}")
    iss = str(payload.get("iss") or "")
    if not (iss.startswith("https://login.microsoftonline.com/") and iss.endswith("/v2.0")):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid Microsoft token issuer")
    return payload


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("ascii")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except (ValueError, TypeError):
        return False


def create_access_token(user_id: str, remember_me: bool = False) -> str:
    hours = JWT_EXPIRE_HOURS_REMEMBER if remember_me else JWT_EXPIRE_HOURS_DEFAULT
    expire = datetime.now(timezone.utc) + timedelta(hours=hours)
    return jwt.encode(
        {"sub": user_id, "exp": expire},
        JWT_SECRET,
        algorithm=JWT_ALGO,
    )


def decode_token(token: str) -> str:
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGO])
        sub = payload.get("sub")
        if not sub or not isinstance(sub, str):
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token")
        return sub
    except jwt.ExpiredSignatureError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token")


def resolve_user_id(db: Session, token: str) -> str:
    """Resolve a bearer token to a user id — accepts a personal access token
    (programmatic / MCP access) or a normal session JWT."""
    from logic import token_logic

    if token and token.startswith(token_logic.TOKEN_PREFIX):
        user_id = token_logic.resolve_user_id(db, token)
        if not user_id:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or revoked access token")
        return user_id
    return decode_token(token)


def login(db: Session, body: LoginBody) -> LoginResponse:
    user = users_crud.get_by_email(db, body.email)
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid email or password")
    if not getattr(user, "is_active", True):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "This account has been deactivated. Contact your administrator.",
        )
    token = create_access_token(user.id, remember_me=body.remember_me)
    return LoginResponse(access_token=token, user=user_logic.to_user_out(db, user))


# ── Admin console auth ─────────────────────────────────────────────────────────

def create_admin_token(subject: str = ADMIN_SUBJECT) -> str:
    """Admin-scoped token. `subject` is the master admin by default, or a user id
    for an app user who holds the 'admin' role."""
    expire = datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRE_HOURS_DEFAULT)
    return jwt.encode(
        {"sub": subject, "scope": "admin", "exp": expire},
        JWT_SECRET,
        algorithm=JWT_ALGO,
    )


def require_admin(token: str, db: Session | None = None) -> None:
    """Raise unless the token is a valid admin-scoped token.

    Accepts both the standalone master admin (sub=__admin__) and any app user
    whose token was issued with admin scope — re-checking that the user still
    holds the 'admin' role and is active (so revoking the role takes effect).
    """
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGO])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Admin session expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid admin token")
    if payload.get("scope") != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin privileges required")
    sub = payload.get("sub")
    if sub == ADMIN_SUBJECT:
        return
    # App-user admin token — confirm the user still qualifies.
    if db is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin privileges required")
    user = users_crud.get_by_id(db, sub) if sub else None
    if not user or user.role != "admin" or not getattr(user, "is_active", True):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin privileges required")


def _get_setting(db: Session, key: str) -> str | None:
    return settings_crud.get(db, key)


def _set_setting(db: Session, key: str, value: str) -> None:
    settings_crud.set(db, key, value)


def _verify_admin_password(db: Session, password: str) -> bool:
    override = _get_setting(db, _ADMIN_PW_KEY)
    if override:
        return verify_password(password, override)
    return secrets.compare_digest(password, ADMIN_PASSWORD)


def admin_login(db: Session, username: str, password: str) -> str:
    uname = (username or "").strip()
    # 1) Standalone master admin.
    if uname == ADMIN_USERNAME and _verify_admin_password(db, password):
        return create_admin_token()
    # 2) App user with the 'admin' role, logging in with their own email + password.
    user = users_crud.get_by_email(db, uname)
    if user and verify_password(password, user.password_hash) and user.role == "admin":
        if not getattr(user, "is_active", True):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "This account has been deactivated.")
        return create_admin_token(subject=user.id)
    raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid admin credentials")


def admin_microsoft_login(db: Session, id_token: str) -> str:
    """Admin-console login via Microsoft — only for existing app users with the
    'admin' role."""
    claims = _decode_microsoft_id_token((id_token or "").strip())
    email = (claims.get("email") or claims.get("preferred_username") or "").strip().lower()
    user = users_crud.get_by_email(db, email) if email else None
    if not user or user.role != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This Microsoft account is not an admin.")
    if not getattr(user, "is_active", True):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This account has been deactivated.")
    return create_admin_token(subject=user.id)


def change_admin_password(db: Session, current_password: str, new_password: str) -> None:
    if not _verify_admin_password(db, current_password):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Current password is incorrect")
    if len(new_password or "") < 8:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "New password must be at least 8 characters")
    _set_setting(db, _ADMIN_PW_KEY, hash_password(new_password))


def register(db: Session, body: RegisterBody) -> LoginResponse:
    email = body.email.strip().lower()
    name = body.name.strip()
    if not name:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Name cannot be empty")
    if users_crud.get_by_email(db, email):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "An account with this email already exists")
    user = users_crud.create_user(
        db,
        user_id=str(uuid.uuid4()),
        name=name,
        email=email,
        password_hash=hash_password(body.password),
        role=body.role,
        job_title=body.job_title,
        experience_months=body.experience_months,
    )
    token = create_access_token(user.id)
    return LoginResponse(access_token=token, user=user_logic.to_user_out(db, user))


def microsoft_auth(db: Session, body: MicrosoftAuthBody) -> LoginResponse:
    claims = _decode_microsoft_id_token(body.id_token.strip())
    email = (claims.get("email") or claims.get("preferred_username") or "").strip().lower()
    if not email or "@" not in email:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Your Microsoft account did not provide an email. Use an account with a mailbox.",
        )
    raw_name = (claims.get("name") or "").strip()
    name = raw_name if raw_name else email.split("@", 1)[0]
    if len(name) > 200:
        name = name[:200]

    user = users_crud.get_by_email(db, email)
    if user:
        if not getattr(user, "is_active", True):
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "This account has been deactivated. Contact your administrator.",
            )
        token = create_access_token(user.id, remember_me=body.remember_me)
        return LoginResponse(access_token=token, user=user_logic.to_user_out(db, user))

    # New account — role must be explicitly chosen by the user.
    # If no role was provided (e.g. came from the login page, not signup), refuse and
    # tell the frontend to redirect to /signup so the user can pick their role.
    if body.role not in ("employee", "manager"):
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            "no_account",   # sentinel the frontend checks for
        )

    role = body.role
    user = users_crud.create_user(
        db,
        user_id=str(uuid.uuid4()),
        name=name,
        email=email,
        password_hash=hash_password(secrets.token_urlsafe(48)),
        role=role,
        job_title=body.job_title,
        experience_months=body.experience_months,
    )
    token = create_access_token(user.id, remember_me=body.remember_me)
    return LoginResponse(access_token=token, user=user_logic.to_user_out(db, user))
