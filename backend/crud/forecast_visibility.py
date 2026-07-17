from crud._base import Db, fetch_all, fetch_one
from database.init_db import new_id


def get_visibility(db: Db, user_id: str, entity_type: str, entity_id: str) -> dict | None:
    row = fetch_one(
        db,
        """SELECT * FROM forecast_visibility
           WHERE user_id = %s AND entity_type = %s AND entity_id = %s""",
        (user_id, entity_type, entity_id),
    )
    return row


def set_visibility(
    db: Db,
    *,
    user_id: str,
    entity_type: str,
    entity_id: str,
    hidden: bool,
    timestamp: str,
) -> None:
    existing = get_visibility(db, user_id, entity_type, entity_id)
    if existing:
        db.write(
            """UPDATE forecast_visibility
               SET hidden = %s,
                   hidden_at = CASE WHEN %s THEN %s ELSE hidden_at END,
                   restored_at = CASE WHEN NOT %s THEN %s ELSE restored_at END
               WHERE user_id = %s AND entity_type = %s AND entity_id = %s""",
            (hidden, bool(hidden), timestamp, bool(hidden), timestamp, user_id, entity_type, entity_id),
        )
    else:
        vis_id = new_id("fv")
        hidden_at = timestamp if hidden else None
        restored_at = None if hidden else timestamp
        db.write(
            """INSERT INTO forecast_visibility
               (id, entity_type, entity_id, user_id, hidden, hidden_at, restored_at)
               VALUES (%s, %s, %s, %s, %s, %s, %s)""",
            (vis_id, entity_type, entity_id, user_id, bool(hidden), hidden_at, restored_at),
        )


def list_hidden_entities(db: Db, user_id: str, entity_type: str) -> set[str]:
    rows = fetch_all(
        db,
        """SELECT entity_id FROM forecast_visibility
           WHERE user_id = %s AND entity_type = %s AND hidden = TRUE""",
        (user_id, entity_type),
    )
    return {row["entity_id"] for row in rows}
