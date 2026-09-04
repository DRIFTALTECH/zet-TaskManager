"""CRUD for user_story_assignees — mirrors task_assignees."""
from __future__ import annotations

from crud._base import Db, fetch_all, fetch_one


def list_user_ids_ordered(db: Db, user_story_id: str) -> list[str]:
    rows = fetch_all(
        db,
        """
        SELECT user_id FROM work_item_assignees
        WHERE work_item_id = %s
        ORDER BY position ASC, user_id ASC
        """,
        (user_story_id,),
    )
    return [r["user_id"] for r in rows]


def map_user_ids_for_stories(db: Db, story_ids: list[str]) -> dict[str, list[str]]:
    if not story_ids:
        return {}
    rows = fetch_all(
        db,
        """
        SELECT work_item_id AS user_story_id, user_id FROM work_item_assignees
        WHERE work_item_id = ANY(%s)
        ORDER BY position ASC, user_id ASC
        """,
        (story_ids,),
    )
    out: dict[str, list[str]] = {}
    for r in rows:
        out.setdefault(r["user_story_id"], []).append(r["user_id"])
    return out


def is_assignee(db: Db, user_story_id: str, user_id: str) -> bool:
    return (
        fetch_one(
            db,
            """
            SELECT work_item_id FROM work_item_assignees
            WHERE work_item_id = %s AND user_id = %s
            """,
            (user_story_id, user_id),
        )
        is not None
    )


def set_assignees(db: Db, user_story_id: str, user_ids: list[str]) -> None:
    db.write("DELETE FROM work_item_assignees WHERE work_item_id = %s", (user_story_id,))
    for pos, uid in enumerate(user_ids):
        db.write(
            """
            INSERT INTO work_item_assignees (work_item_id, user_id, position)
            VALUES (%s, %s, %s)
            """,
            (user_story_id, uid, pos),
        )
