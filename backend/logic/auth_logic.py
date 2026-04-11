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

import crud.users as users_crud
from logic import project_logic, user_logic
from logic.schemas import LoginBody, LoginResponse, MicrosoftAuthBody, RegisterBody

JWT_SECRET = os.environ.get("TASKMANAGER_JWT_SECRET", "dev-secret-change-me")
JWT_ALGO = "HS256"
JWT_EXPIRE_HOURS_DEFAULT = 24         # 1 day when "remember me" is off
JWT_EXPIRE_HOURS_REMEMBER = 24 * 30   # 30 days when "remember me" is on

MICROSOFT_CLIENT_ID = os.environ.get("MICROSOFT_CLIENT_ID", "").strip()
MICROSOFT_TENANT_ID = os.environ.get("MICROSOFT_TENANT_ID", "").strip()
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


def login(db: Session, body: LoginBody) -> LoginResponse:
    user = users_crud.get_by_email(db, body.email)
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid email or password")
    token = create_access_token(user.id, remember_me=body.remember_me)
    project_logic.ensure_personal_project(db, user.id)
    return LoginResponse(access_token=token, user=user_logic.to_user_out(db, user))


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
    )
    token = create_access_token(user.id)
    project_logic.ensure_personal_project(db, user.id)
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
        token = create_access_token(user.id, remember_me=body.remember_me)
        project_logic.ensure_personal_project(db, user.id)
        return LoginResponse(access_token=token, user=user_logic.to_user_out(db, user))

    role = body.role if body.role in ("employee", "manager") else "employee"
    user = users_crud.create_user(
        db,
        user_id=str(uuid.uuid4()),
        name=name,
        email=email,
        password_hash=hash_password(secrets.token_urlsafe(48)),
        role=role,
    )
    token = create_access_token(user.id, remember_me=body.remember_me)
    project_logic.ensure_personal_project(db, user.id)
    return LoginResponse(access_token=token, user=user_logic.to_user_out(db, user))
