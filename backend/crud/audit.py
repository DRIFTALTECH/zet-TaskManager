from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from database.models import AuditLog


def purge_old(db: Session, days: int = 7) -> None:
    """Delete audit rows older than `days`. Commits immediately."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    db.query(AuditLog).filter(AuditLog.created_at < cutoff).delete(synchronize_session=False)
    db.commit()


def insert(db: Session, row: AuditLog) -> None:
    """Persist an audit row within the current transaction (caller controls commit)."""
    db.add(row)
    db.flush()


def list_recent(db: Session, *, user_id: str | None, limit: int) -> list[AuditLog]:
    q = db.query(AuditLog)
    if user_id is not None:
        q = q.filter(AuditLog.user_id == user_id)
    return q.order_by(AuditLog.id.desc()).limit(limit).all()
