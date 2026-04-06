import os
import uuid
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import HTTPException, status
from passlib.context import CryptContext
from sqlalchemy.orm import Session

import crud.users as users_crud
from logic import project_logic, user_logic
from logic.schemas import LoginBody, LoginResponse, RegisterBody

JWT_SECRET = os.environ.get("TASKMANAGER_JWT_SECRET", "dev-secret-change-me")
JWT_ALGO = "HS256"
JWT_EXPIRE_HOURS_DEFAULT = 24         # 1 day when "remember me" is off
JWT_EXPIRE_HOURS_REMEMBER = 24 * 30   # 30 days when "remember me" is on

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(plain: str) -> str:
    return pwd_context.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


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
