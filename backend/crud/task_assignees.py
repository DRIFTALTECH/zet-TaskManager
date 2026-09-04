import realtime
from crud._base import Db, fetch_all, fetch_one


def list_user_ids_ordered(db: Db, task_id: str) -> list[str]:
    rows = fetch_all(
        db,
        """
        SELECT user_id FROM work_item_assignees
        WHERE work_item_id = %s
        ORDER BY position ASC, user_id ASC
        """,
        (task_id,),
    )
    return [r["user_id"] for r in rows]


def map_user_ids_for_tasks(db: Db, task_ids: list[str]) -> dict[str, list[str]]:
    """Ordered assignee user-ids for many tasks in a single query.

    Returns { task_id: [user_id, ...] }. Tasks with no assignees are omitted.
    """
    if not task_ids:
        return {}
    rows = fetch_all(
        db,
        """
        SELECT work_item_id AS task_id, user_id FROM work_item_assignees
        WHERE work_item_id = ANY(%s)
        ORDER BY position ASC, user_id ASC
        """,
        (task_ids,),
    )
    out: dict[str, list[str]] = {}
    for r in rows:
        out.setdefault(r["task_id"], []).append(r["user_id"])
    return out


def is_assignee(db: Db, task_id: str, user_id: str) -> bool:
    return (
        fetch_one(
            db,
            """
            SELECT work_item_id FROM work_item_assignees
            WHERE work_item_id = %s AND user_id = %s
            """,
            (task_id, user_id),
        )
        is not None
    )


def set_assignees(db: Db, task_id: str, user_ids: list[str]) -> None:
    db.write("DELETE FROM work_item_assignees WHERE work_item_id = %s", (task_id,))
    for pos, uid in enumerate(user_ids):
        db.write(
            "INSERT INTO work_item_assignees (work_item_id, user_id, position) VALUES (%s, %s, %s)",
            (task_id, uid, pos),
        )
    realtime.bump("tasks")


def insert_assignees_quiet(db: Db, task_id: str, user_ids: list[str]) -> None:
    """Insert assignees for a brand-new task. No DELETE, no realtime bump."""
    for pos, uid in enumerate(user_ids):
        db.write(
            "INSERT INTO work_item_assignees (work_item_id, user_id, position) VALUES (%s, %s, %s)",
            (task_id, uid, pos),
        )
