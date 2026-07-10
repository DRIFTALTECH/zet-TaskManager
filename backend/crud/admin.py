"""Admin-console data access: project rosters, work checks, and the
hard-delete-with-reassign routine (all SQL lives here, not in logic)."""

from database.models import Project, User

from crud._base import Db, fetch_all, fetch_one, rows_to_models

_PROJECT_SELECT = """SELECT id, name, description, created_by, created_at,
    background_image, accent_color, project_image FROM projects"""


def list_projects_with_members(db: Db) -> list[tuple[Project, list[str]]]:
    projects = rows_to_models(
        Project,
        fetch_all(db, f"{_PROJECT_SELECT} ORDER BY name"),
    )
    member_rows = fetch_all(db, "SELECT project_id, user_id FROM project_members")
    by_project: dict[str, list[str]] = {}
    for r in member_rows:
        by_project.setdefault(r["project_id"], []).append(r["user_id"])
    return [(p, by_project.get(p.id, [])) for p in projects]


def existing_project_ids(db: Db, project_ids: list[str]) -> set[str]:
    if not project_ids:
        return set()
    rows = fetch_all(db, "SELECT id FROM projects WHERE id = ANY(%s)", (project_ids,))
    return {r["id"] for r in rows}


def user_has_work(db: Db, user_id: str) -> bool:
    if fetch_one(db, "SELECT id FROM tasks WHERE assigned_to = %s LIMIT 1", (user_id,)):
        return True
    if fetch_one(db, "SELECT task_id FROM task_assignees WHERE user_id = %s LIMIT 1", (user_id,)):
        return True
    if fetch_one(db, "SELECT id FROM timesheet_entries WHERE user_id = %s LIMIT 1", (user_id,)):
        return True
    return False


def reassign_and_delete_user(db: Db, victim: User, reassign_to: str | None) -> None:
    """Reassign all of a user's owned rows to `reassign_to` (when given), drop
    their personal rows, delete the user, and commit."""
    v = victim.id
    if reassign_to is not None:
        t = reassign_to
        # Simple ownership columns
        for tbl, col in [
            ("tasks", "assigned_to"),
            ("tasks", "assigned_by"),
            ("tasks", "created_by"),
            ("timesheet_entries", "user_id"),
            ("timesheet_submissions", "user_id"),
            ("timesheet_submissions", "reviewer_id"),
            ("task_feedback", "user_id"),
            ("task_checklists", "created_by"),
            ("task_attachments", "uploaded_by"),
            ("audit_logs", "user_id"),
            ("projects", "created_by"),
            ("notifications", "triggered_by"),
        ]:
            db.write(f"UPDATE {tbl} SET {col} = %s WHERE {col} = %s", (t, v))

        # Composite-unique tables: merge to avoid PK/unique collisions
        db.write(
            """DELETE FROM task_assignees WHERE user_id = %s AND task_id IN (
                SELECT task_id FROM task_assignees WHERE user_id = %s
            )""",
            (v, t),
        )
        db.write("UPDATE task_assignees SET user_id = %s WHERE user_id = %s", (t, v))

        db.write(
            """UPDATE task_time_logs SET seconds = seconds + COALESCE((
                SELECT vtl.seconds FROM task_time_logs vtl
                WHERE vtl.user_id = %s
                  AND vtl.task_id = task_time_logs.task_id
                  AND vtl.log_date = task_time_logs.log_date
            ), 0) WHERE user_id = %s""",
            (v, t),
        )
        db.write(
            """DELETE FROM task_time_logs WHERE user_id = %s AND (task_id, log_date) IN (
                SELECT task_id, log_date FROM task_time_logs WHERE user_id = %s
            )""",
            (v, t),
        )
        db.write("UPDATE task_time_logs SET user_id = %s WHERE user_id = %s", (t, v))

        db.write(
            """DELETE FROM project_members WHERE user_id = %s AND project_id IN (
                SELECT project_id FROM project_members WHERE user_id = %s
            )""",
            (v, t),
        )
        db.write("UPDATE project_members SET user_id = %s WHERE user_id = %s", (t, v))

    # Personal rows that should not be inherited
    db.write("DELETE FROM notifications WHERE user_id = %s", (v,))
    db.write("DELETE FROM project_members WHERE user_id = %s", (v,))

    db.write("DELETE FROM users WHERE id = %s", (v,))
