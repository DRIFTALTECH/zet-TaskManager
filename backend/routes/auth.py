from fastapi import APIRouter, Depends, Request, status
from database.database import Db

import ratelimit
from database.database import get_db
from logic import auth_logic
from logic.schemas import (
    LoginBody,
    LoginResponse,
    MicrosoftAuthBody,
    RegisterBody,
    RegistrationPending,
)

router = APIRouter()


# Two buckets per login: one per IP (blocks a single host spraying many accounts)
# and one per email (blocks a botnet spraying one account).
LOGIN_PER_IP = (20, 300)        # 20 attempts / 5 min
LOGIN_PER_EMAIL = (8, 300)      # 8 attempts / 5 min
REGISTER_PER_IP = (5, 3600)     # 5 sign-ups / hour


@router.post("/login", response_model=LoginResponse)
def login(request: Request, body: LoginBody, db: Db = Depends(get_db)):
    ip = ratelimit.client_ip(request)
    ratelimit.check("login-ip", ip, limit=LOGIN_PER_IP[0], window_seconds=LOGIN_PER_IP[1])
    ratelimit.check("login-email", body.email.strip().lower(),
                    limit=LOGIN_PER_EMAIL[0], window_seconds=LOGIN_PER_EMAIL[1])
    return auth_logic.login(db, body)


@router.post("/register", response_model=RegistrationPending, status_code=status.HTTP_202_ACCEPTED)
def register(request: Request, body: RegisterBody, db: Db = Depends(get_db)):
    """Create an inactive account. No token is issued — a superadmin has to approve
    it first, so the client shows a "waiting for approval" screen."""
    ratelimit.check("register-ip", ratelimit.client_ip(request),
                    limit=REGISTER_PER_IP[0], window_seconds=REGISTER_PER_IP[1])
    return auth_logic.register(db, body)


@router.post("/microsoft", response_model=LoginResponse | RegistrationPending)
def microsoft_auth(request: Request, body: MicrosoftAuthBody, db: Db = Depends(get_db)):
    """Signs in a known Microsoft account, or registers an unknown one as an
    inactive employee (returning RegistrationPending rather than a session)."""
    ratelimit.check("ms-auth-ip", ratelimit.client_ip(request), limit=30, window_seconds=300)
    return auth_logic.microsoft_auth(db, body)
