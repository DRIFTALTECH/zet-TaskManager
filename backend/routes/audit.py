"""Audit log route: GET /audit"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from database.database import get_db
from logic import audit as audit_logic
from logic.schemas import AuditLogOut
from routes.deps import get_current_user_id

router = APIRouter()


@router.get("", response_model=list[AuditLogOut])
def list_audit_logs(
    limit: int = 200,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    return audit_logic.list_for_viewer(db, user_id, limit=limit)
