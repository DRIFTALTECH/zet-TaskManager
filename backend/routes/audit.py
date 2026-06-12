"""Audit log route: GET /audit"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from database.database import get_db
from database.models import User
from logic.audit import get_audit_logs
from logic.schemas import AuditLogOut
from routes.deps import get_current_user_id

router = APIRouter()


@router.get("", response_model=list[AuditLogOut])
def list_audit_logs(
    limit: int = 200,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    caller = db.get(User, user_id)
    is_manager = caller is not None and caller.role == "manager"
    return get_audit_logs(db, user_id, is_manager, limit=limit)
