"""Lightweight audit-log helper used by all mutation routes."""

import json
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from database.models import AuditLog, User


def purge_old_audit_logs(db: Session) -> None:
    """Delete audit rows older than 7 days. Commits immediately."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    db.query(AuditLog).filter(AuditLog.created_at < cutoff).delete(synchronize_session=False)
    db.commit()


def log_audit(
    db: Session,
    user_id: str,
    action: str,
    entity_type: str,
    entity_id: str,
    entity_name: str = "",
    details: dict | None = None,
) -> None:
    """Write a single audit row. Never raises — audit failures must not break the main action."""
    try:
        row = AuditLog(
            user_id=user_id,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            entity_name=entity_name,
            details=json.dumps(details or {}),
            created_at=datetime.now(timezone.utc).isoformat(),
        )
        db.add(row)
        db.flush()   # persist within the current transaction
    except Exception:
        pass  # never let audit failure surface to the caller


def get_audit_logs(db: Session, user_id: str, is_manager: bool, limit: int = 200):
    """Return audit rows. Managers see all; employees see only their own.
    Purges rows older than 7 days before querying."""
    purge_old_audit_logs(db)

    from database.models import User as UserModel

    q = db.query(AuditLog)
    if not is_manager:
        q = q.filter(AuditLog.user_id == user_id)
    rows = q.order_by(AuditLog.id.desc()).limit(limit).all()

    # Build userId → name map for the returned rows
    user_ids = list({r.user_id for r in rows})
    users = {u.id: u.name for u in db.query(UserModel).filter(UserModel.id.in_(user_ids)).all()}

    result = []
    for r in rows:
        try:
            details_dict = json.loads(r.details or "{}")
        except Exception:
            details_dict = {}
        result.append({
            "id": r.id,
            "userId": r.user_id,
            "userName": users.get(r.user_id, r.user_id),
            "action": r.action,
            "entityType": r.entity_type,
            "entityId": r.entity_id,
            "entityName": r.entity_name,
            "details": details_dict,
            "createdAt": r.created_at,
        })
    return result
