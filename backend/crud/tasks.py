import json

import realtime
from crud._base import Db, fetch_all, fetch_one, row_to_model, rows_to_models
from database.models import Task


def get_by_id(db: Db, task_id: str) -> Task | None:
    return row_to_model(Task, fetch_one(db, "SELECT * FROM tasks WHERE id = %s", (task_id,)))


# Board/list payload — skip the real description / tags / custom-field blobs.
_LIST_COLS = (
    "id, title, '' AS description, project_id, section_id, user_story_id, parent_task_id, "
    "assigned_to, assigned_by, created_by, due_date, sprint, priority, status, "
    "is_started, started_at, completed_at, approved_by_manager, time_tracked, "
    "min_log_minutes, estimated_hours, created_at, '[]' AS tags_json, '{}' AS custom_fields_json"
)
_LIST_COLS_T = (
    "t.id, t.title, '' AS description, t.project_id, t.section_id, t.user_story_id, t.parent_task_id, "
    "t.assigned_to, t.assigned_by, t.created_by, t.due_date, t.sprint, t.priority, t.status, "
    "t.is_started, t.started_at, t.completed_at, t.approved_by_manager, t.time_tracked, "
    "t.min_log_minutes, t.estimated_hours, t.created_at, '[]' AS tags_json, '{}' AS custom_fields_json"
)


def list_all(db: Db) -> list[Task]:
    return rows_to_models(Task, fetch_all(db, "SELECT * FROM tasks"))


def list_all_lean(db: Db) -> list[Task]:
    return rows_to_models(Task, fetch_all(db, f"SELECT {_LIST_COLS} FROM tasks"))


def list_for_member_projects(db: Db, user_id: str) -> list[Task]:
    """Tasks in any project the user is a member of — filtered in SQL via a join."""
    return rows_to_models(
        Task,
        fetch_all(
            db,
            """
            SELECT t.* FROM tasks t
            INNER JOIN project_members pm ON pm.project_id = t.project_id
            WHERE pm.user_id = %s
            """,
            (user_id,),
        ),
    )


def list_for_member_projects_lean(db: Db, user_id: str) -> list[Task]:
    return rows_to_models(
        Task,
        fetch_all(
            db,
            f"""
            SELECT {_LIST_COLS_T} FROM tasks t
            INNER JOIN project_members pm ON pm.project_id = t.project_id
            WHERE pm.user_id = %s
            """,
            (user_id,),
        ),
    )


def list_for_project(db: Db, project_id: str) -> list[Task]:
    return rows_to_models(
        Task,
        fetch_all(db, "SELECT * FROM tasks WHERE project_id = %s", (project_id,)),
    )


def list_touched_on_for_user(db: Db, user_id: str, day: str) -> list[Task]:
    """Tasks the user started or completed on `day`.

    A task counts if the user is its primary assignee OR a co-assignee (task_assignees),
    and it was started (started_at timestamp on `day`) or completed (completed_at == day).
    Filtering is done in SQL — no fetch-all-then-loop.
    """
    return rows_to_models(
        Task,
        fetch_all(
            db,
            """
            SELECT * FROM tasks
            WHERE (assigned_to = %s OR id IN (
                SELECT task_id FROM task_assignees WHERE user_id = %s
            ))
            AND (started_at LIKE %s OR completed_at = %s)
            """,
            (user_id, user_id, f"{day}%", day),
        ),
    )


def count_for_section(db: Db, section_id: str) -> int:
    row = fetch_one(
        db,
        "SELECT COUNT(*) AS cnt FROM tasks WHERE section_id = %s",
        (section_id,),
    )
    return int(row["cnt"]) if row else 0


def find_by_project_title_assignee(
    db: Db, project_id: str, title: str, assigned_to: str,
) -> Task | None:
    """Dedup helper for delivery-sheet imports (matched assignee)."""
    row = fetch_one(
        db,
        """
        SELECT * FROM tasks
        WHERE project_id = %s AND title = %s AND assigned_to = %s
        LIMIT 1
        """,
        (project_id, title, assigned_to),
    )
    return row_to_model(Task, row)


def find_by_project_title_unassigned(db: Db, project_id: str, title: str) -> Task | None:
    """Dedup for unassigned imports — no rows in task_assignees."""
    row = fetch_one(
        db,
        """
        SELECT t.* FROM tasks t
        WHERE t.project_id = %s AND t.title = %s
          AND NOT EXISTS (
            SELECT 1 FROM task_assignees a WHERE a.task_id = t.id
          )
        LIMIT 1
        """,
        (project_id, title),
    )
    return row_to_model(Task, row)


def load_dedup_index(db: Db, project_ids: list[str]) -> tuple[set[tuple[str, str, str]], set[tuple[str, str]]]:
    """One-shot load of (project, title, assignee) and unassigned (project, title) keys."""
    assigned: set[tuple[str, str, str]] = set()
    unassigned: set[tuple[str, str]] = set()
    if not project_ids:
        return assigned, unassigned
    rows = fetch_all(
        db,
        """
        SELECT t.project_id, t.title, t.assigned_to,
               EXISTS (
                 SELECT 1 FROM task_assignees a WHERE a.task_id = t.id
               ) AS has_assignee
        FROM tasks t
        WHERE t.project_id = ANY(%s)
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
        """
        INSERT INTO tasks (
            id, title, description, project_id, section_id,
            user_story_id, parent_task_id,
            assigned_to, assigned_by, created_by, due_date, sprint,
            priority, status, is_started, started_at, completed_at,
            approved_by_manager, time_tracked, min_log_minutes, estimated_hours,
            tags_json, custom_fields_json, created_at
        ) VALUES (
            %s, %s, %s, %s, %s,
            %s, %s,
            %s, %s, %s, %s, %s,
            %s, %s, %s, %s, %s,
            %s, %s, %s, %s,
            %s, %s, %s
        )
        """,
        (
            task_id,
            title,
            description,
            project_id,
            section_id,
            None,
            None,
            assigned_to,
            assigned_by,
            created_by,
            due_date,
            sprint,
            priority,
            status,
            is_started,
            started_at,
            completed_at,
            approved_by_manager,
            time_tracked,
            1,
            None,
            json.dumps(tags),
            json.dumps(custom_fields or {}),
            created_at,
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
        """
        INSERT INTO tasks (
            id, title, description, project_id, section_id,
            user_story_id, parent_task_id,
            assigned_to, assigned_by, created_by, due_date, sprint,
            priority, status, is_started, started_at, completed_at,
            approved_by_manager, time_tracked, min_log_minutes, estimated_hours,
            tags_json, custom_fields_json, created_at
        ) VALUES (
            %s, %s, %s, %s, %s,
            %s, %s,
            %s, %s, %s, %s, %s,
            %s, %s, %s, %s, %s,
            %s, %s, %s, %s,
            %s, %s, %s
        )
        """,
        (
            task_id,
            title,
            description,
            project_id,
            section_id,
            user_story_id,
            parent_task_id,
            assigned_to,
            assigned_by,
            created_by,
            due_date,
            sprint or "",
            priority,
            status,
            is_started,
            None,
            None,
            approved_by_manager,
            time_tracked,
            min_log_minutes,
            estimated_hours,
            json.dumps(tags),
            json.dumps(custom_fields or {}),
            created_at,
        ),
    )
    realtime.bump("tasks")
    return row_to_model(
        Task,
        fetch_one(db, "SELECT * FROM tasks WHERE id = %s", (task_id,)),
    )  # type: ignore[return-value]


def update_task(db: Db, task: Task) -> Task:
    db.write(
        """
        UPDATE tasks SET
            title = %s, description = %s, project_id = %s, section_id = %s,
            user_story_id = %s, parent_task_id = %s,
            assigned_to = %s, assigned_by = %s, created_by = %s, due_date = %s, sprint = %s,
            priority = %s, status = %s, is_started = %s, started_at = %s,
            completed_at = %s, approved_by_manager = %s, time_tracked = %s,
            min_log_minutes = %s, estimated_hours = %s,
            tags_json = %s, custom_fields_json = %s, created_at = %s
        WHERE id = %s
        """,
        (
            task.title,
            task.description,
            task.project_id,
            task.section_id,
            getattr(task, "user_story_id", None),
            getattr(task, "parent_task_id", None),
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
    return row_to_model(Task, fetch_one(db, "SELECT * FROM tasks WHERE id = %s", (task.id,)))  # type: ignore[return-value]


def list_for_user_story(db: Db, user_story_id: str) -> list[Task]:
    return rows_to_models(
        Task,
        fetch_all(db, "SELECT * FROM tasks WHERE user_story_id = %s", (user_story_id,)),
    )


def complete_for_user_story(db: Db, user_story_id: str, completed_at: str) -> None:
    """Mark every task under the story completed. Other story status changes do not touch tasks."""
    db.write(
        """
        UPDATE tasks
        SET status = 'completed',
            approved_by_manager = %s,
            completed_at = %s
        WHERE user_story_id = %s
          AND LOWER(TRIM(status)) <> 'completed'
        """,
        (True, completed_at, user_story_id),
    )
    realtime.bump("tasks")


def list_children(db: Db, parent_task_id: str) -> list[Task]:
    return rows_to_models(
        Task,
        fetch_all(db, "SELECT * FROM tasks WHERE parent_task_id = %s", (parent_task_id,)),
    )


def delete_task(db: Db, task_id: str) -> None:
    db.write("DELETE FROM tasks WHERE id = %s", (task_id,))
    realtime.bump("tasks")


def reassign_status(db: Db, from_status: str, to_status: str) -> None:
    """Bulk-move every task in one status/column to another (e.g. on column delete)."""
    db.write("UPDATE tasks SET status = %s WHERE status = %s", (to_status, from_status))
    realtime.bump("tasks")