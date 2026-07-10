from datetime import datetime, timedelta, timezone

from database.models import AuditLog

from crud._base import Db, fetch_all, rows_to_models

_SELECT = """SELECT id, user_id, action, entity_type, entity_id, entity_name, details, created_at
    FROM audit_logs"""


def purge_old(db: Db, days: int = 7) -> None:
    """Delete audit rows older than `days`. Commits immediately."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    db.write("DELETE FROM audit_logs WHERE created_at < %s", (cutoff,))


def insert(db: Db, row: AuditLog) -> None:
    """Persist an audit row within the current transaction (caller controls commit)."""
    rows = db.read(
        """INSERT INTO audit_logs
            (user_id, action, entity_type, entity_id, entity_name, details, created_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            RETURNING id""",
        (
            row.user_id,
            row.action,
            row.entity_type,
            row.entity_id,
            row.entity_name,
            row.details,
            row.created_at,
        ),
    )
    if rows:
        row.id = rows[0]["id"]


def list_recent(db: Db, *, user_id: str | None, limit: int) -> list[AuditLog]:
    if user_id is not None:
        rows = fetch_all(
            db,
            f"""{_SELECT}
                WHERE user_id = %s
                ORDER BY id DESC
                LIMIT %s""",
            (user_id, limit),
        )
    else:
        rows = fetch_all(
            db,
            f"""{_SELECT}
                ORDER BY id DESC
                LIMIT %s""",
            (limit,),
        )
    return rows_to_models(AuditLog, rows)
