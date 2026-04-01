from fastapi import Depends, Header, HTTPException, status
from sqlalchemy.orm import Session

from database.database import get_db
from logic import auth_logic


def get_token(authorization: str | None = Header(None)) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    return authorization.split(" ", 1)[1].strip()


def get_current_user_id(
    token: str = Depends(get_token),
) -> str:
    return auth_logic.decode_token(token)
