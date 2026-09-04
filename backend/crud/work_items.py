"""Every query against the unified work-item tables.

One table holds both kinds of work, so the queries that used to exist twice —
once for tasks, once for stories — exist once here and take `type` as an
argument. The tree is a single self-referencing column, so walking it is one
recursive query rather than three joins the caller has to stitch together.

Nothing calls this until the cutover; `crud/tasks.py` and `crud/user_stories.py`
remain authoritative in the meantime.
"""
from __future__ import annotations

from crud._base import Db, fetch_all, fetch_one, row_to_model, rows_to_models
from database.models import WorkItem

STORY = "story"
TASK = "task"

# Board/list payload — skip the description and custom-field blobs, exactly as
# the task list does. Open one item to get its full body.
_LIST_COLS = (
    "id, type, parent_id, project_id, section_id, title, '' AS description, "
    "priority, status, due_date, sprint, estimated_hours, approved_by_manager, "
    "created_by, created_at, updated_at, assigned_to, assigned_by, is_started, started_at, "
    "completed_at, time_tracked, min_log_minutes, '{}' AS custom_fields_json, "
    "'' AS acceptance_criteria, story_points, start_date, '[]' AS tags_json"
)


def get_by_id(db: Db, item_id: str) -> WorkItem | None:
    return row_to_model(
        WorkItem, fetch_one(db, "SELECT * FROM work_items WHERE id = %s", (item_id,))
    )


def list_all_lean(db: Db) -> list[WorkItem]:
    return rows_to_models(WorkItem, fetch_all(db, f"SELECT {_LIST_COLS} FROM work_items"))


def list_for_member_projects_lean(db: Db, user_id: str) -> list[WorkItem]:
    """Everything in any project the user belongs to — filtered in SQL."""
    cols = ", ".join(f"w.{c.strip()}" if " AS " not in c else c for c in _LIST_COLS.split(", "))
    return rows_to_models(
        WorkItem,
        fetch_all(
            db,
            f"""
            SELECT {cols} FROM work_items w
            INNER JOIN project_members pm ON pm.project_id = w.project_id
            WHERE pm.user_id = %s
            """,
            (user_id,),
        ),
    )


def list_for_project(db: Db, project_id: str, item_type: str | None = None) -> list[WorkItem]:
    if item_type:
        return rows_to_models(
            WorkItem,
            fetch_all(
                db,
                "SELECT * FROM work_items WHERE project_id = %s AND type = %s",
                (project_id, item_type),
            ),
        )
    return rows_to_models(
        WorkItem, fetch_all(db, "SELECT * FROM work_items WHERE project_id = %s", (project_id,))
    )


def list_children(db: Db, parent_id: str, item_type: str | None = None) -> list[WorkItem]:
    if item_type:
        return rows_to_models(
            WorkItem,
            fetch_all(
                db,
                "SELECT * FROM work_items WHERE parent_id = %s AND type = %s",
                (parent_id, item_type),
            ),
        )
    return rows_to_models(
        WorkItem, fetch_all(db, "SELECT * FROM work_items WHERE parent_id = %s", (parent_id,))
    )


def list_descendants(db: Db, root_id: str) -> list[WorkItem]:
    """Everything under `root_id`, any depth, in one recursive query.

    The split schema could not do this at all: a story's tasks lived in another
    table under a different foreign key, so callers walked the tree in Python
    and issued a query per level.
    """
    return rows_to_models(
        WorkItem,
        fetch_all(
            db,
            """
            WITH RECURSIVE sub AS (
                SELECT * FROM work_items WHERE parent_id = %s
                UNION ALL
                SELECT w.* FROM work_items w INNER JOIN sub ON w.parent_id = sub.id
            )
            SELECT * FROM sub
            """,
            (root_id,),
        ),
    )


def is_descendant_of(db: Db, candidate_id: str, root_id: str) -> bool:
    """True when `candidate_id` sits somewhere under `root_id` — the cycle guard."""
    if candidate_id == root_id:
        return True
    return any(w.id == candidate_id for w in list_descendants(db, root_id))


def depth_of(db: Db, item_id: str) -> int:
    """How many parents sit above this item. Top level is 0."""
    depth = 0
    seen: set[str] = set()
    current = get_by_id(db, item_id)
    while current is not None and current.parent_id and current.parent_id not in seen:
        seen.add(current.parent_id)
        depth += 1
        current = get_by_id(db, current.parent_id)
    return depth


def task_depth_of(db: Db, item_id: str) -> int:
    """Task parents directly above, counting only an unbroken chain of tasks.

    A story parent does not count. Sitting inside a story is not a subtask
    relationship, so it must not use up the single level of subtask nesting the
    product allows — a task in a story can still have subtasks of its own.
    """
    depth = 0
    seen: set[str] = set()
    current = get_by_id(db, item_id)
    while current is not None and current.parent_id and current.parent_id not in seen:
        seen.add(current.parent_id)
        parent = get_by_id(db, current.parent_id)
        if parent is None or parent.type != TASK:
            break
        depth += 1
        current = parent
    return depth


def create(db: Db, item: WorkItem) -> WorkItem:
    db.write(
        """
        INSERT INTO work_items (
            id, type, parent_id, project_id, section_id, title, description,
            priority, status, due_date, sprint, tags_json, estimated_hours,
            approved_by_manager, created_by, created_at, updated_at,
            assigned_to, assigned_by, is_started, started_at, completed_at,
            time_tracked, min_log_minutes, custom_fields_json,
            acceptance_criteria, story_points, start_date
        ) VALUES (
            %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
            %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
        )
        """,
        (
            item.id, item.type, item.parent_id, item.project_id, item.section_id,
            item.title, item.description or "", item.priority, item.status,
            item.due_date, item.sprint or "", item.tags_json or "[]",
            item.estimated_hours, bool(item.approved_by_manager), item.created_by,
            item.created_at, item.updated_at, item.assigned_to, item.assigned_by,
            bool(item.is_started), item.started_at, item.completed_at,
            int(item.time_tracked or 0), int(item.min_log_minutes or 1),
            item.custom_fields_json or "{}", item.acceptance_criteria or "",
            item.story_points, item.start_date,
        ),
    )
    return item


def update(db: Db, item: WorkItem) -> WorkItem:
    db.write(
        """
        UPDATE work_items SET
            type = %s, parent_id = %s, project_id = %s, section_id = %s,
            title = %s, description = %s, priority = %s, status = %s,
            due_date = %s, sprint = %s, tags_json = %s, estimated_hours = %s,
            approved_by_manager = %s, updated_at = %s, assigned_to = %s,
            assigned_by = %s,
            is_started = %s, started_at = %s, completed_at = %s,
            time_tracked = %s, min_log_minutes = %s, custom_fields_json = %s,
            acceptance_criteria = %s, story_points = %s, start_date = %s
        WHERE id = %s
        """,
        (
            item.type, item.parent_id, item.project_id, item.section_id,
            item.title, item.description or "", item.priority, item.status,
            item.due_date, item.sprint or "", item.tags_json or "[]",
            item.estimated_hours, bool(item.approved_by_manager), item.updated_at,
            item.assigned_to, item.assigned_by, bool(item.is_started), item.started_at,
            item.completed_at, int(item.time_tracked or 0),
            int(item.min_log_minutes or 1), item.custom_fields_json or "{}",
            item.acceptance_criteria or "", item.story_points, item.start_date,
            item.id,
        ),
    )
    return item


def set_parent(db: Db, item_id: str, parent_id: str | None) -> None:
    db.write("UPDATE work_items SET parent_id = %s WHERE id = %s", (parent_id, item_id))


def delete(db: Db, item_id: str) -> None:
    db.write("DELETE FROM work_items WHERE id = %s", (item_id,))


def detach_children(db: Db, parent_id: str) -> None:
    db.write("UPDATE work_items SET parent_id = NULL WHERE parent_id = %s", (parent_id,))


# --- assignees -------------------------------------------------------------

def list_user_ids_ordered(db: Db, item_id: str) -> list[str]:
    rows = fetch_all(
        db,
        """
        SELECT user_id FROM work_item_assignees
        WHERE work_item_id = %s
        ORDER BY position ASC, user_id ASC
        """,
        (item_id,),
    )
    return [r["user_id"] for r in rows]


def map_user_ids(db: Db, item_ids: list[str]) -> dict[str, list[str]]:
    """Ordered assignees for many items in one query — never one query per card."""
    if not item_ids:
        return {}
    placeholders = ", ".join(["%s"] * len(item_ids))
    rows = fetch_all(
        db,
        f"""
        SELECT work_item_id, user_id FROM work_item_assignees
        WHERE work_item_id IN ({placeholders})
        ORDER BY position ASC, user_id ASC
        """,
        tuple(item_ids),
    )
    out: dict[str, list[str]] = {}
    for r in rows:
        out.setdefault(r["work_item_id"], []).append(r["user_id"])
    return out


def set_assignees(db: Db, item_id: str, user_ids: list[str]) -> None:
    db.write("DELETE FROM work_item_assignees WHERE work_item_id = %s", (item_id,))
    for position, uid in enumerate(user_ids):
        db.write(
            """
            INSERT INTO work_item_assignees (work_item_id, user_id, position)
            VALUES (%s, %s, %s)
            """,
            (item_id, uid, position),
        )


def is_assignee(db: Db, item_id: str, user_id: str) -> bool:
    return bool(
        fetch_one(
            db,
            "SELECT 1 AS ok FROM work_item_assignees WHERE work_item_id = %s AND user_id = %s",
            (item_id, user_id),
        )
    )
