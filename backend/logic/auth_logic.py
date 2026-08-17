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
from database.database import Db

import crud.settings as settings_crud
import crud.users as users_crud
from config import JWT_SECRET, MICROSOFT_CLIENT_ID, MICROSOFT_TENANT_ID
from logic import user_logic
from logic.schemas import (
    LoginBody,
    LoginResponse,
    MicrosoftAuthBody,
    RegisterBody,
    RegistrationPending,
)

# JWT_SECRET imported from config (fail-fast on weak/default in production).
JWT_ALGO = "HS256"
JWT_EXPIRE_HOURS_DEFAULT = 24         # 1 day when "remember me" is off
JWT_EXPIRE_HOURS_REMEMBER = 24 * 30   # 30 days when "remember me" is on

# ── Roles ─────────────────────────────────────────────────────────────────────
# superadmin — the operator. A normal user row with role="superadmin", signing in
#              through /auth/login like everyone else. Sole authority over user
#              activation and role assignment. There is no separate console
#              password and no standalone admin identity.
# manager    — in-app manager powers; granted only by a superadmin.
# employee   — the role every self-registered account starts in.
ROLES = ("employee", "manager", "superadmin")
SUPERADMIN_ROLE = "superadmin"

# Shown to an account that exists but is not active — either never approved after
# sign-up, or switched off later. One wording covers both without leaking which.
INACTIVE_ACCOUNT_DETAIL = (
    "This account is not active yet. A superadmin has to approve it before you can sign in."
)

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


def _normalize_microsoft_id_token(raw: str) -> str:
    """Strip whitespace / optional Bearer prefix; require a compact JWT (3 segments)."""
    token = (raw or "").strip()
    if token.lower().startswith("bearer "):
        token = token[7:].strip()
    # Real Entra ID tokens are long JWTs (header.payload.sig). Short values are almost
    # always a mistaken client id, secret, auth code, or Swagger placeholder.
    if token.count(".") != 2 or len(token) < 100:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "Invalid Microsoft token: expected an Entra ID token (JWT from MSAL). "
            "Use Sign in with Microsoft in the app — do not paste access tokens, "
            "auth codes, client secrets, or Swagger placeholders.",
        )
    return token


def _decode_microsoft_id_token(id_token: str) -> dict:
    if not MICROSOFT_CLIENT_ID:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Microsoft sign-in is not configured on the server (set MICROSOFT_CLIENT_ID).",
        )
    id_token = _normalize_microsoft_id_token(id_token)
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


def resolve_user_id(db: Db, token: str) -> str:
    """Resolve a bearer token to a user id — accepts a personal access token
    (programmatic / MCP access) or a normal session JWT.

    The account's active flag is re-checked on every request, so a superadmin
    deactivating someone cuts them off immediately instead of when their token
    happens to expire."""
    from logic import token_logic

    if token and token.startswith(token_logic.TOKEN_PREFIX):
        user_id = token_logic.resolve_user_id(db, token)
        if not user_id:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or revoked access token")
    else:
        user_id = decode_token(token)
    _require_active(db, user_id)
    return user_id


def _require_active(db: Db, user_id: str) -> None:
    user = users_crud.get_by_id(db, user_id)
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Account no longer exists")
    if not getattr(user, "is_active", True):
        raise HTTPException(status.HTTP_403_FORBIDDEN, INACTIVE_ACCOUNT_DETAIL)


def require_superadmin(db: Db, user_id: str) -> None:
    """Raise unless `user_id` is an active superadmin."""
    user = users_crud.get_by_id(db, user_id)
    if not user or user.role != SUPERADMIN_ROLE or not getattr(user, "is_active", True):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Superadmin privileges required")


def login(db: Db, body: LoginBody) -> LoginResponse:
    user = users_crud.get_by_email(db, body.email)
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid email or password")
    if not getattr(user, "is_active", True):
        raise HTTPException(status.HTTP_403_FORBIDDEN, INACTIVE_ACCOUNT_DETAIL)
    token = create_access_token(user.id, remember_me=body.remember_me)
    return LoginResponse(access_token=token, user=user_logic.to_user_out(db, user))


def register(db: Db, body: RegisterBody) -> RegistrationPending:
    """Create an account and stop there. The new user is an inactive employee and
    cannot sign in until a superadmin activates them, so no token is issued."""
    email = body.email.strip().lower()
    name = body.name.strip()
    if not name:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Name cannot be empty")
    if users_crud.get_by_email(db, email):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "An account with this email already exists")
    users_crud.create_user(
        db,
        user_id=str(uuid.uuid4()),
        name=name,
        email=email,
        password_hash=hash_password(body.password),
        role="employee",
        job_title=body.job_title,
        experience_months=body.experience_months,
        is_active=False,
    )
    return RegistrationPending(message=INACTIVE_ACCOUNT_DETAIL)


def microsoft_auth(db: Db, body: MicrosoftAuthBody) -> LoginResponse | RegistrationPending:
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
            raise HTTPException(status.HTTP_403_FORBIDDEN, INACTIVE_ACCOUNT_DETAIL)
        token = create_access_token(user.id, remember_me=body.remember_me)
        return LoginResponse(access_token=token, user=user_logic.to_user_out(db, user))

    # First time this Microsoft account has been seen — register it as an inactive
    # employee and make them wait for approval, exactly like password sign-up.
    users_crud.create_user(
        db,
        user_id=str(uuid.uuid4()),
        name=name,
        email=email,
        password_hash=hash_password(secrets.token_urlsafe(48)),
        role="employee",
        job_title=body.job_title,
        experience_months=body.experience_months,
        is_active=False,
    )
    return RegistrationPending(message=INACTIVE_ACCOUNT_DETAIL)
