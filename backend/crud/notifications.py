from database.models import Notification

from crud._base import Db, fetch_all, fetch_one, row_to_model, rows_to_models

_SELECT = """SELECT id, user_id, type, title, message, entity_type, entity_id,
    is_read, triggered_by, created_at FROM notifications"""


def add(db: Db, notification: Notification) -> None:
    """Stage a notification within the current transaction (caller controls commit)."""
    rows = db.read(
        """INSERT INTO notifications
            (user_id, type, title, message, entity_type, entity_id, is_read, triggered_by, created_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id""",
        (
            notification.user_id,
            notification.type,
            notification.title,
            notification.message,
            notification.entity_type,
            notification.entity_id,
            notification.is_read,
            notification.triggered_by,
            notification.created_at,
        ),
    )
    if rows:
        notification.id = rows[0]["id"]


def list_for_user(db: Db, user_id: str, limit: int) -> list[Notification]:
    rows = fetch_all(
        db,
        f"""{_SELECT}
            WHERE user_id = %s
            ORDER BY id DESC
            LIMIT %s""",
        (user_id, limit),
    )
    return rows_to_models(Notification, rows)


def unread_count(db: Db, user_id: str) -> int:
    row = fetch_one(
        db,
        "SELECT COUNT(*) AS cnt FROM notifications WHERE user_id = %s AND is_read = FALSE",
        (user_id,),
    )
    return int(row["cnt"]) if row else 0


def get_for_user(db: Db, user_id: str, notification_id: int) -> Notification | None:
    return row_to_model(
        Notification,
        fetch_one(
            db,
            f"{_SELECT} WHERE id = %s AND user_id = %s",
            (notification_id, user_id),
        ),
    )


def mark_all_read(db: Db, user_id: str) -> None:
    db.write(
        "UPDATE notifications SET is_read = TRUE WHERE user_id = %s AND is_read = FALSE",
        (user_id,),
    )


def commit(db: Db) -> None:
    db.commit()
