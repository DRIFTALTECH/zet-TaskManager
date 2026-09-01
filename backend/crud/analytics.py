"""Bulk read queries for analytics — all SQL lives here."""
from __future__ import annotations

from database.models import (
    Project,
    ProjectMember,
    Section,
    Task,
    TaskAssignee,
    TimesheetEntry,
    User,
)

from crud._base import Db, fetch_all, fetch_one, row_to_model, rows_to_models

_USER_COLS = """id, name, email, password_hash, role, avatar, job_title,
    experience_months, joined_at, is_active, manager_id"""
_TASK_COLS = """id, title, description, project_id, section_id, assigned_to, assigned_by,
    created_by, due_date, sprint, priority, status, is_started, started_at, completed_at,
    approved_by_manager, time_tracked, tags_json, custom_fields_json, created_at"""
_TS_COLS = """id, user_id, work_date, project_id, section_id, description,
    time_from, time_to, seconds, billable, created_at"""


def list_active_users(db: Db) -> list[User]:
    rows = fetch_all(db, f"SELECT {_USER_COLS} FROM users WHERE is_active = TRUE")
    return rows_to_models(User, rows)


def list_all_users(db: Db) -> list[User]:
    rows = fetch_all(db, f"SELECT {_USER_COLS} FROM users")
    return rows_to_models(User, rows)


def get_user(db: Db, user_id: str) -> User | None:
    return row_to_model(
        User,
        fetch_one(db, f"SELECT {_USER_COLS} FROM users WHERE id = %s", (user_id,)),
    )


def get_active_user(db: Db, user_id: str) -> User | None:
    return row_to_model(
        User,
        fetch_one(
            db,
            f"SELECT {_USER_COLS} FROM users WHERE id = %s AND is_active = TRUE",
            (user_id,),
        ),
    )


def list_all_projects(db: Db) -> list[Project]:
    rows = fetch_all(
        db,
        """SELECT id, name, description, created_by, created_at,
            background_image, accent_color, project_image FROM projects""",
    )
    return rows_to_models(Project, rows)


def list_all_sections(db: Db) -> list[Section]:
    rows = fetch_all(db, "SELECT id, name, project_id FROM sections")
    return rows_to_models(Section, rows)


def list_all_tasks(db: Db) -> list[Task]:
    rows = fetch_all(db, f"SELECT {_TASK_COLS} FROM tasks")
    return rows_to_models(Task, rows)


def list_all_project_members(db: Db) -> list[ProjectMember]:
    rows = fetch_all(db, "SELECT project_id, user_id FROM project_members")
    return rows_to_models(ProjectMember, rows)


def list_all_task_assignees(db: Db) -> list[TaskAssignee]:
    rows = fetch_all(db, "SELECT task_id, user_id, position FROM task_assignees")
    return rows_to_models(TaskAssignee, rows)


def timesheet_entries_in_range(db: Db, start_date: str, end_date: str) -> list[TimesheetEntry]:
    rows = fetch_all(
        db,
        f"""SELECT {_TS_COLS} FROM timesheet_entries
            WHERE work_date >= %s AND work_date <= %s""",
        (start_date, end_date),
    )
    return rows_to_models(TimesheetEntry, rows)


def timesheet_entries_for_user_in_range(
    db: Db, user_id: str, start_date: str, end_date: str
) -> list[TimesheetEntry]:
    rows = fetch_all(
        db,
        f"""SELECT {_TS_COLS} FROM timesheet_entries
            WHERE user_id = %s AND work_date >= %s AND work_date <= %s""",
        (user_id, start_date, end_date),
    )
    return rows_to_models(TimesheetEntry, rows)


def timesheet_entries_for_users_in_range(
    db: Db, user_ids: list[str], start_date: str, end_date: str
) -> list[TimesheetEntry]:
    if not user_ids:
        return []
    rows = fetch_all(
        db,
        f"""SELECT {_TS_COLS} FROM timesheet_entries
            WHERE user_id = ANY(%s) AND work_date >= %s AND work_date <= %s""",
        (user_ids, start_date, end_date),
    )
    return rows_to_models(TimesheetEntry, rows)


def latest_task_in_section_for_user(db: Db, section_id: str, user_id: str) -> Task | None:
    return row_to_model(
        Task,
        fetch_one(
            db,
            f"""SELECT {_TASK_COLS} FROM tasks
                WHERE section_id = %s AND assigned_to = %s
                ORDER BY created_at DESC LIMIT 1""",
            (section_id, user_id),
        ),
    )


def tasks_for_user_assignee(db: Db, user_id: str) -> list[Task]:
    rows = fetch_all(
        db,
        f"""SELECT {_TASK_COLS} FROM tasks t
            WHERE t.assigned_to = %s
               OR t.id IN (SELECT task_id FROM task_assignees WHERE user_id = %s)
            ORDER BY due_date DESC""",
        (user_id, user_id),
    )
    return rows_to_models(Task, rows)


def latest_tasks_for_users(db: Db, user_ids: list[str]) -> list[Task]:
    if not user_ids:
        return []
    rows = fetch_all(
        db,
        f"""SELECT {_TASK_COLS} FROM tasks
            WHERE assigned_to = ANY(%s)""",
        (user_ids,),
    )
    return rows_to_models(Task, rows)


def get_projects_by_ids(db: Db, project_ids: list[str]) -> list[Project]:
    if not project_ids:
        return []
    rows = fetch_all(
        db,
        """SELECT id, name, description, created_by, created_at,
            background_image, accent_color, project_image FROM projects
            WHERE id = ANY(%s)""",
        (project_ids,),
    )
    return rows_to_models(Project, rows)


def get_sections_by_ids(db: Db, section_ids: list[str]) -> list[Section]:
    if not section_ids:
        return []
    rows = fetch_all(
        db,
        "SELECT id, name, project_id FROM sections WHERE id = ANY(%s)",
        (section_ids,),
    )
    return rows_to_models(Section, rows)


def list_project_members_for_users(db: Db, user_ids: list[str]) -> list[ProjectMember]:
    if not user_ids:
        return []
    rows = fetch_all(
        db,
        "SELECT project_id, user_id FROM project_members WHERE user_id = ANY(%s)",
        (user_ids,),
    )
    return rows_to_models(ProjectMember, rows)


def list_project_members_for_projects(db: Db, project_ids: list[str]) -> list[ProjectMember]:
    if not project_ids:
        return []
    rows = fetch_all(
        db,
        "SELECT project_id, user_id FROM project_members WHERE project_id = ANY(%s)",
        (project_ids,),
    )
    return rows_to_models(ProjectMember, rows)


def list_active_tasks_counts_by_user(db: Db) -> dict[str, int]:
    rows = fetch_all(
        db,
        """SELECT user_id, COUNT(DISTINCT task_id) AS active_count FROM (
            SELECT id AS task_id, assigned_to AS user_id FROM tasks
            WHERE LOWER(TRIM(status)) NOT IN ('completed', 'done', 'cancelled', 'archived', 'closed')
            UNION ALL
            SELECT task_id, user_id FROM task_assignees WHERE task_id IN (
                SELECT id FROM tasks
                WHERE LOWER(TRIM(status)) NOT IN ('completed', 'done', 'cancelled', 'archived', 'closed')
            )
        ) sub
        WHERE user_id IS NOT NULL
        GROUP BY user_id"""
    )
    return {r["user_id"]: r["active_count"] for r in rows}


def list_tasks_for_overview(db: Db, start_date: str, end_date: str) -> list[Task]:
    rows = fetch_all(
        db,
        f"""SELECT {_TASK_COLS} FROM tasks
            WHERE status NOT IN ('completed', 'cancelled')
               OR (status = 'completed' AND completed_at >= %s AND completed_at <= %s)""",
        (start_date, end_date),
    )
    return rows_to_models(Task, rows)


def list_task_assignees_for_tasks(db: Db, task_ids: list[str]) -> list[TaskAssignee]:
    if not task_ids:
        return []
    rows = fetch_all(
        db,
        "SELECT task_id, user_id, position FROM task_assignees WHERE task_id = ANY(%s)",
        (task_ids,),
    )
    return rows_to_models(TaskAssignee, rows)


def get_project_progress_stats(db: Db, today: str) -> list[dict]:
    rows = fetch_all(
        db,
        """SELECT
            project_id,
            COUNT(*) as total_tasks,
            SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_tasks,
            SUM(CASE WHEN status NOT IN ('completed', 'cancelled') THEN 1 ELSE 0 END) as active_tasks,
            SUM(CASE WHEN status NOT IN ('completed', 'cancelled') AND due_date IS NOT NULL AND due_date < %s THEN 1 ELSE 0 END) as overdue_tasks,
            SUM(CASE WHEN status = 'in_progress' AND due_date IS NOT NULL AND due_date < %s THEN 1 ELSE 0 END) as blocked_tasks,
            SUM(CASE WHEN status NOT IN ('completed', 'cancelled') AND LOWER(TRIM(priority)) IN ('urgent', 'critical', 'high') THEN 1 ELSE 0 END) as high_priority_pending
        FROM tasks
        WHERE project_id IS NOT NULL
        GROUP BY project_id""",
        (today, today),
    )
    return rows


def get_attention_tasks(db: Db, today: str) -> list[Task]:
    rows = fetch_all(
        db,
        f"""SELECT {_TASK_COLS} FROM tasks
            WHERE status NOT IN ('completed', 'cancelled')
              AND (
                 (due_date IS NOT NULL AND due_date <= %s)
                 OR LOWER(TRIM(priority)) IN ('urgent', 'critical', 'high')
              )""",
        (today,),
    )
    return rows_to_models(Task, rows)


def list_active_tasks(db: Db) -> list[Task]:
    rows = fetch_all(
        db,
        f"""SELECT {_TASK_COLS} FROM tasks
            WHERE LOWER(TRIM(status)) NOT IN ('completed', 'done', 'cancelled', 'archived', 'closed')""",
    )
    return rows_to_models(Task, rows)


def count_active_tasks(db: Db) -> int:
    row = fetch_one(
        db,
        """SELECT COUNT(*) AS count FROM tasks
           WHERE LOWER(TRIM(status)) NOT IN ('completed', 'done', 'cancelled', 'archived', 'closed')""",
    )
    return row["count"] if row else 0


# Lean task cols for Task / User Overview tables (includes story + duration fields).
_OVERVIEW_TASK_COLS = """id, title, '' AS description, project_id, section_id, user_story_id, parent_task_id,
    assigned_to, assigned_by, created_by, due_date, sprint, priority, status,
    is_started, started_at, completed_at, approved_by_manager, time_tracked,
    min_log_minutes, estimated_hours, created_at, '[]' AS tags_json, '{}' AS custom_fields_json"""


def list_tasks_for_projects(db: Db, project_ids: list[str]) -> list[Task]:
    if not project_ids:
        return []
    rows = fetch_all(
        db,
        f"""SELECT {_OVERVIEW_TASK_COLS} FROM tasks
            WHERE project_id = ANY(%s)
            ORDER BY
              CASE WHEN LOWER(TRIM(status)) IN ('completed', 'done') THEN 1 ELSE 0 END,
              created_at DESC""",
        (project_ids,),
    )
    return rows_to_models(Task, rows)


def list_tasks_for_assignee(db: Db, user_id: str, project_ids: list[str] | None = None) -> list[Task]:
    """Tasks where user is primary assignee or in task_assignees, optionally scoped to projects."""
    if project_ids is not None and len(project_ids) == 0:
        return []
    # EXISTS (not JOIN+DISTINCT) — Postgres forbids ORDER BY CASE with SELECT DISTINCT
    # unless the CASE is also in the select list.
    cols = """t.id, t.title, '' AS description, t.project_id, t.section_id,
              t.user_story_id, t.parent_task_id, t.assigned_to, t.assigned_by, t.created_by,
              t.due_date, t.sprint, t.priority, t.status, t.is_started, t.started_at,
              t.completed_at, t.approved_by_manager, t.time_tracked, t.min_log_minutes,
              t.estimated_hours, t.created_at, '[]' AS tags_json, '{}' AS custom_fields_json"""
    assigned = """(
        t.assigned_to = %s
        OR EXISTS (
            SELECT 1 FROM task_assignees ta
            WHERE ta.task_id = t.id AND ta.user_id = %s
        )
    )"""
    order = """ORDER BY
              CASE WHEN LOWER(TRIM(t.status)) IN ('completed', 'done') THEN 1 ELSE 0 END,
              t.created_at DESC"""
    if project_ids:
        rows = fetch_all(
            db,
            f"""SELECT {cols}
                FROM tasks t
                WHERE {assigned}
                  AND t.project_id = ANY(%s)
                {order}""",
            (user_id, user_id, project_ids),
        )
    else:
        rows = fetch_all(
            db,
            f"""SELECT {cols}
                FROM tasks t
                WHERE {assigned}
                {order}""",
            (user_id, user_id),
        )
    return rows_to_models(Task, rows)


def list_user_story_titles(db: Db, story_ids: list[str]) -> dict[str, str]:
    if not story_ids:
        return {}
    rows = fetch_all(
        db,
        "SELECT id, title FROM user_stories WHERE id = ANY(%s)",
        (story_ids,),
    )
    return {r["id"]: r["title"] for r in rows}


def list_distinct_sprints(db: Db, project_ids: list[str]) -> list[dict]:
    """Named sprints in the given projects, with task counts (blank sprint excluded)."""
    if not project_ids:
        return []
    rows = fetch_all(
        db,
        """SELECT TRIM(sprint) AS sprint, COUNT(*) AS task_count
           FROM tasks
           WHERE project_id = ANY(%s)
             AND TRIM(COALESCE(sprint, '')) <> ''
           GROUP BY TRIM(sprint)
           ORDER BY LOWER(TRIM(sprint))""",
        (project_ids,),
    )
    return [{"name": r["sprint"], "taskCount": int(r["task_count"])} for r in rows]


def list_tasks_for_sprint(db: Db, sprint: str, project_ids: list[str]) -> list[Task]:
    """Tasks whose sprint label matches (case-sensitive trim), scoped to projects."""
    if not project_ids:
        return []
    name = (sprint or "").strip()
    if not name:
        return []
    rows = fetch_all(
        db,
        f"""SELECT {_OVERVIEW_TASK_COLS} FROM tasks
            WHERE project_id = ANY(%s)
              AND TRIM(COALESCE(sprint, '')) = %s
            ORDER BY
              CASE WHEN LOWER(TRIM(status)) IN ('completed', 'done') THEN 1 ELSE 0 END,
              created_at DESC""",
        (project_ids, name),
    )
    return rows_to_models(Task, rows)


