"""Every query for tasks. The rows live in `work_items`.

`tasks` and `user_stories` were the same shape at two altitudes, so they are now
one table with a `type` column and a single `parent_id`. This module keeps the
old function signatures and keeps returning `Task` objects, so the seventeen
callers above it — timesheets, forecasts, analytics, the timer, the importers —
did not have to change and neither did the client.

THE ONE THING THAT IS NOT ONE-TO-ONE
    A task used to name its place in the tree with two columns: `user_story_id`
    and `parent_task_id`. One `parent_id` replaces both, and which of the two it
    means is decided by the parent's own type. Reading them back is therefore a
    join rather than a column read:

        subtask --parent_id--> task --parent_id--> story

    A subtask reports the story of the task above it, exactly as it did when it
    carried the story id itself, so rollups and story progress are unchanged.
    Writing goes the other way: the nearer parent wins, because a subtask sits
    in its parent task and reaches its story one level further up.
"""
import json

import realtime
from crud._base import Db, fetch_all, fetch_one, row_to_model, rows_to_models
from database.models import Task

# Task-shaped projection of a work item. Two levels of parent are enough: a
# subtask may not itself have subtasks, so story is at most two hops away.
_FROM = """
    FROM work_items w
    LEFT JOIN work_items p1 ON p1.id = w.parent_id
    LEFT JOIN work_items p2 ON p2.id = p1.parent_id
"""

_COLS = """
    w.id, w.title, w.description, w.project_id, w.section_id,
    CASE WHEN p1.type = 'story' THEN p1.id
         WHEN p2.type = 'story' THEN p2.id END AS user_story_id,
    CASE WHEN p1.type = 'task' THEN p1.id END AS parent_task_id,
    w.assigned_to, w.assigned_by, w.created_by, w.due_date, w.sprint,
    w.priority, w.status, w.is_started, w.started_at, w.completed_at,
    w.approved_by_manager, w.time_tracked, w.min_log_minutes,
    w.estimated_hours, w.created_at, w.tags_json, w.custom_fields_json
"""

# Board/list payload — skip the real description / tags / custom-field blobs.
_LEAN = """
    w.id, w.title, '' AS description, w.project_id, w.section_id,
    CASE WHEN p1.type = 'story' THEN p1.id
         WHEN p2.type = 'story' THEN p2.id END AS user_story_id,
    CASE WHEN p1.type = 'task' THEN p1.id END AS parent_task_id,
    w.assigned_to, w.assigned_by, w.created_by, w.due_date, w.sprint,
    w.priority, w.status, w.is_started, w.started_at, w.completed_at,
    w.approved_by_manager, w.time_tracked, w.min_log_minutes,
    w.estimated_hours, w.created_at, '[]' AS tags_json, '{}' AS custom_fields_json
"""

_IS_TASK = "w.type = 'task'"


# Task-shaped relations for modules that write SQL of their own (analytics,
# time logs). Substituted wherever `tasks` or `task_assignees` used to be named,
# so those queries keep their column names and their joins.
TASK_RELATION = f"(SELECT {_COLS} {_FROM} WHERE {_IS_TASK})"
TASK_ASSIGNEE_RELATION = (
    "(SELECT work_item_id AS task_id, user_id, position FROM work_item_assignees)"
)


def _select(cols: str, where: str = "", order: str = "") -> str:
    clause = f"AND ({where})" if where else ""
    return f"SELECT {cols} {_FROM} WHERE {_IS_TASK} {clause} {order}"


def _parent_of(user_story_id: str | None, parent_task_id: str | None) -> str | None:
    """One column for what used to be two. The nearer parent wins."""
    return parent_task_id or user_story_id or None


def get_by_id(db: Db, task_id: str) -> Task | None:
    return row_to_model(Task, fetch_one(db, _select(_COLS, "w.id = %s"), (task_id,)))


def list_all(db: Db) -> list[Task]:
    return rows_to_models(Task, fetch_all(db, _select(_COLS)))


def list_all_lean(db: Db) -> list[Task]:
    return rows_to_models(Task, fetch_all(db, _select(_LEAN)))


def _member_scoped(cols: str) -> str:
    return f"""
        SELECT {cols} {_FROM}
        INNER JOIN project_members pm ON pm.project_id = w.project_id
        WHERE {_IS_TASK} AND pm.user_id = %s
    """


def list_for_member_projects(db: Db, user_id: str) -> list[Task]:
    """Tasks in any project the user is a member of — filtered in SQL via a join."""
    return rows_to_models(Task, fetch_all(db, _member_scoped(_COLS), (user_id,)))


def list_for_member_projects_lean(db: Db, user_id: str) -> list[Task]:
    return rows_to_models(Task, fetch_all(db, _member_scoped(_LEAN), (user_id,)))


def list_for_project(db: Db, project_id: str) -> list[Task]:
    return rows_to_models(Task, fetch_all(db, _select(_COLS, "w.project_id = %s"), (project_id,)))


def list_touched_on_for_user(db: Db, user_id: str, day: str) -> list[Task]:
    """Tasks the user started or completed on `day`.

    A task counts if the user is its primary assignee OR a co-assignee, and it
    was started (started_at timestamp on `day`) or completed (completed_at == day).
    Filtering is done in SQL — no fetch-all-then-loop.
    """
    return rows_to_models(
        Task,
        fetch_all(
            db,
            _select(
                _COLS,
                """
                (w.assigned_to = %s OR w.id IN (
                    SELECT work_item_id FROM work_item_assignees WHERE user_id = %s
                ))
                AND (w.started_at LIKE %s OR w.completed_at = %s)
                """,
            ),
            (user_id, user_id, f"{day}%", day),
        ),
    )


def count_for_section(db: Db, section_id: str) -> int:
    row = fetch_one(
        db,
        "SELECT COUNT(*) AS cnt FROM work_items w WHERE w.type = 'task' AND w.section_id = %s",
        (section_id,),
    )
    return int(row["cnt"]) if row else 0


def find_by_project_title_assignee(
    db: Db, project_id: str, title: str, assigned_to: str,
) -> Task | None:
    """Dedup helper for delivery-sheet imports (matched assignee)."""
    return row_to_model(
        Task,
        fetch_one(
            db,
            _select(_COLS, "w.project_id = %s AND w.title = %s AND w.assigned_to = %s", "LIMIT 1"),
            (project_id, title, assigned_to),
        ),
    )


def find_by_project_title_unassigned(db: Db, project_id: str, title: str) -> Task | None:
    """Dedup for unassigned imports — no rows in work_item_assignees."""
    return row_to_model(
        Task,
        fetch_one(
            db,
            _select(
                _COLS,
                """
                w.project_id = %s AND w.title = %s
                AND NOT EXISTS (
                    SELECT 1 FROM work_item_assignees a WHERE a.work_item_id = w.id
                )
                """,
                "LIMIT 1",
            ),
            (project_id, title),
        ),
    )


def load_dedup_index(db: Db, project_ids: list[str]) -> tuple[set[tuple[str, str, str]], set[tuple[str, str]]]:
    """One-shot load of (project, title, assignee) and unassigned (project, title) keys."""
    assigned: set[tuple[str, str, str]] = set()
    unassigned: set[tuple[str, str]] = set()
    if not project_ids:
        return assigned, unassigned
    rows = fetch_all(
        db,
        """
        SELECT w.project_id, w.title, w.assigned_to,
               EXISTS (
                 SELECT 1 FROM work_item_assignees a WHERE a.work_item_id = w.id
               ) AS has_assignee
        FROM work_items w
        WHERE w.type = 'task' AND w.project_id = ANY(%s)
        """,
        (list(project_ids),),
    )
    for r in rows:
        pid, title = r["project_id"], r["title"]
        if r["has_assignee"]:
            assigned.add((pid, title, r["assigned_to"]))
        else:
            unassigned.add((pid, title))
    return assigned, unassigned


_INSERT = """
    INSERT INTO work_items (
        id, type, parent_id, project_id, section_id, title, description,
        priority, status, due_date, sprint, tags_json, estimated_hours,
        approved_by_manager, created_by, created_at, updated_at,
        assigned_to, assigned_by, is_started, started_at, completed_at,
        time_tracked, min_log_minutes, custom_fields_json,
        acceptance_criteria, story_points, start_date
    ) VALUES (
        %s, 'task', %s, %s, %s, %s, %s,
        %s, %s, %s, %s, %s, %s,
        %s, %s, %s, NULL,
        %s, %s, %s, %s, %s,
        %s, %s, %s,
        '', NULL, NULL
    )
"""


def insert_imported_task(
    db: Db,
    *,
    task_id: str,
    title: str,
    description: str,
    project_id: str,
    section_id: str,
    assigned_to: str,
    assigned_by: str,
    created_by: str,
    due_date: str,
    priority: str,
    status: str,
    is_started: bool,
    started_at: str | None,
    completed_at: str | None,
    approved_by_manager: bool,
    time_tracked: int,
    tags: list[str],
    created_at: str,
    custom_fields: dict[str, str] | None = None,
    sprint: str = "",
) -> None:
    """Bulk-import insert: one write, no re-fetch, no realtime bump."""
    db.write(
        _INSERT,
        (
            task_id, None, project_id, section_id, title, description,
            priority, status, due_date, sprint, json.dumps(tags), None,
            approved_by_manager, created_by, created_at,
            assigned_to, assigned_by, is_started, started_at, completed_at,
            time_tracked, 1, json.dumps(custom_fields or {}),
        ),
    )


def create_task(
    db: Db,
    *,
    task_id: str,
    title: str,
    description: str,
    project_id: str,
    section_id: str,
    assigned_to: str,
    assigned_by: str,
    created_by: str,
    due_date: str,
    priority: str,
    status: str,
    is_started: bool,
    approved_by_manager: bool,
    time_tracked: int,
    tags: list[str],
    created_at: str,
    min_log_minutes: int = 1,
    time_log: dict[str, int] | None = None,
    custom_fields: dict[str, str] | None = None,
    user_story_id: str | None = None,
    parent_task_id: str | None = None,
    sprint: str = "",
    estimated_hours: str | None = None,
) -> Task:
    db.write(
        _INSERT,
        (
            task_id,
            _parent_of(user_story_id, parent_task_id),
            project_id, section_id, title, description,
            priority, status, due_date, sprint or "", json.dumps(tags), estimated_hours,
            approved_by_manager, created_by, created_at,
            assigned_to, assigned_by, is_started, None, None,
            time_tracked, min_log_minutes, json.dumps(custom_fields or {}),
        ),
    )
    realtime.bump("tasks")
    return get_by_id(db, task_id)  # type: ignore[return-value]


def update_task(db: Db, task: Task) -> Task:
    db.write(
        """
        UPDATE work_items SET
            title = %s, description = %s, project_id = %s, section_id = %s,
            parent_id = %s,
            assigned_to = %s, assigned_by = %s, created_by = %s, due_date = %s,
            sprint = %s, priority = %s, status = %s, is_started = %s,
            started_at = %s, completed_at = %s, approved_by_manager = %s,
            time_tracked = %s, min_log_minutes = %s, estimated_hours = %s,
            tags_json = %s, custom_fields_json = %s, created_at = %s
        WHERE id = %s AND type = 'task'
        """,
        (
            task.title,
            task.description,
            task.project_id,
            task.section_id,
            _parent_of(
                getattr(task, "user_story_id", None),
                getattr(task, "parent_task_id", None),
            ),
            task.assigned_to,
            task.assigned_by,
            task.created_by,
            task.due_date,
            getattr(task, "sprint", "") or "",
            task.priority,
            task.status,
            task.is_started,
            task.started_at,
            task.completed_at,
            task.approved_by_manager,
            task.time_tracked,
            getattr(task, "min_log_minutes", 1) or 1,
            getattr(task, "estimated_hours", None),
            task.tags_json,
            task.custom_fields_json,
            task.created_at,
            task.id,
        ),
    )
    realtime.bump("tasks")
    return get_by_id(db, task.id)  # type: ignore[return-value]


def list_for_user_story(db: Db, user_story_id: str) -> list[Task]:
    """Tasks belonging to the story, subtasks of those tasks included.

    Membership is inherited down the chain, which is what the old column did:
    a subtask carried its parent's story id, so it appeared here too.
    """
    return rows_to_models(
        Task,
        fetch_all(
            db,
            _select(
                _COLS,
                """
                (p1.type = 'story' AND p1.id = %s)
                OR (p2.type = 'story' AND p2.id = %s)
                """,
            ),
            (user_story_id, user_story_id),
        ),
    )


def complete_for_user_story(db: Db, user_story_id: str, completed_at: str) -> None:
    """Mark every task under the story completed. Other story status changes do not touch tasks."""
    db.write(
        """
        UPDATE work_items SET
            status = 'completed',
            approved_by_manager = %s,
            completed_at = %s
        WHERE type = 'task'
          AND LOWER(TRIM(status)) <> 'completed'
          AND (
            parent_id = %s
            OR parent_id IN (
                SELECT id FROM work_items WHERE type = 'task' AND parent_id = %s
            )
          )
        """,
        (True, completed_at, user_story_id, user_story_id),
    )
    realtime.bump("tasks")


def list_children(db: Db, parent_task_id: str) -> list[Task]:
    return rows_to_models(
        Task,
        fetch_all(db, _select(_COLS, "p1.type = 'task' AND p1.id = %s"), (parent_task_id,)),
    )


def delete_task(db: Db, task_id: str) -> None:
    db.write("DELETE FROM work_items WHERE id = %s AND type = 'task'", (task_id,))
    realtime.bump("tasks")


def reassign_status(db: Db, from_status: str, to_status: str) -> None:
    """Bulk-move every task in one status/column to another (e.g. on column delete)."""
    db.write(
        "UPDATE work_items SET status = %s WHERE type = 'task' AND status = %s",
        (to_status, from_status),
    )
    realtime.bump("tasks")
