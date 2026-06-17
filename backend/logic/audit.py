"""Lightweight audit-log helper used by all mutation flows.

Holds the formatting/business logic only — every DB query lives in crud/audit.py."""

import json
from datetime import datetime, timezone

from sqlalchemy.orm import Session

import crud.audit as audit_crud
import crud.users as users_crud
from database.models import AuditLog


def purge_old_audit_logs(db: Session) -> None:
    audit_crud.purge_old(db)


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
        audit_crud.insert(db, row)
    except Exception:
        pass  # never let audit failure surface to the caller


def list_for_viewer(db: Session, user_id: str, limit: int = 200):
    """Audit rows scoped to the viewer: managers/admins see all, employees their own."""
    caller = users_crud.get_by_id(db, user_id)
    is_manager = caller is not None and caller.role in ("manager", "admin")
    return get_audit_logs(db, user_id, is_manager, limit=limit)


def get_audit_logs(db: Session, user_id: str, is_manager: bool, limit: int = 200):
    """Return audit rows. Managers see all; employees see only their own.
    Purges rows older than 7 days before querying."""
    audit_crud.purge_old(db)
    rows = audit_crud.list_recent(db, user_id=None if is_manager else user_id, limit=limit)
    names = users_crud.names_for_ids(db, list({r.user_id for r in rows}))

    result = []
    for r in rows:
        try:
            details_dict = json.loads(r.details or "{}")
        except Exception:
            details_dict = {}
        result.append({
            "id": r.id,
            "userId": r.user_id,
            "userName": names.get(r.user_id, r.user_id),
            "action": r.action,
            "entityType": r.entity_type,
            "entityId": r.entity_id,
            "entityName": r.entity_name,
            "details": details_dict,
            "createdAt": r.created_at,
        })
    return result
