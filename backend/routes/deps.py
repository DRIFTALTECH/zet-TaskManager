from fastapi import Depends, Header, HTTPException, status

from database.database import Db, get_db
from logic import auth_logic


def get_token(authorization: str | None = Header(None)) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    return authorization.split(" ", 1)[1].strip()


def get_current_user_id(
    token: str = Depends(get_token),
    db: Db = Depends(get_db),
) -> str:
    return auth_logic.resolve_user_id(db, token)


def require_superadmin(
    user_id: str = Depends(get_current_user_id),
    db: Db = Depends(get_db),
) -> str:
    """Dependency guarding the superadmin console. The caller uses their ordinary
    session token; we check the role on every request so revoking it takes effect
    immediately. Returns the superadmin's own id for audit logging."""
    auth_logic.require_superadmin(db, user_id)
    return user_id
