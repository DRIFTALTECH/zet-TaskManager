import realtime
from crud._base import Db, fetch_all, fetch_one, row_to_model, rows_to_models
from database.models import Project


def get_by_id(db: Db, project_id: str) -> Project | None:
    return row_to_model(Project, fetch_one(db, "SELECT * FROM projects WHERE id = %s", (project_id,)))


def get_by_name(db: Db, name: str) -> Project | None:
    """Case-insensitive exact-name lookup, for imports that carry project names
    rather than ids. Returns the oldest match if names are duplicated."""
    row = fetch_one(
        db,
        "SELECT * FROM projects WHERE LOWER(TRIM(name)) = %s ORDER BY created_at LIMIT 1",
        (name.strip().lower(),),
    )
    return row_to_model(Project, row)


def list_all(db: Db) -> list[Project]:
    return rows_to_models(Project, fetch_all(db, "SELECT * FROM projects ORDER BY name"))


def list_for_member(db: Db, user_id: str) -> list[Project]:
    """Projects the user is a member of — filtered in SQL via a join."""
    return rows_to_models(
        Project,
        fetch_all(
            db,
            """
            SELECT p.* FROM projects p
            INNER JOIN project_members pm ON pm.project_id = p.id
            WHERE pm.user_id = %s
            ORDER BY p.name
            """,
            (user_id,),
        ),
    )


def create_project(
    db: Db,
    *,
    project_id: str,
    name: str,
    description: str,
    client_id: str | None,
    created_by: str,
    created_at: str,
) -> Project:
    db.write(
        """
        INSERT INTO projects (id, name, description, client_id, created_by, created_at)
        VALUES (%s, %s, %s, %s, %s, %s)
        """,
        (project_id, name, description, client_id, created_by, created_at),
    )
    realtime.bump("projects")
    return row_to_model(
        Project,
        fetch_one(db, "SELECT * FROM projects WHERE id = %s", (project_id,)),
    )  # type: ignore[return-value]


def update_client(db: Db, project_id: str, client_id: str | None) -> None:
    p = get_by_id(db, project_id)
    if not p:
        return
    db.write(
        "UPDATE projects SET client_id = %s WHERE id = %s",
        (client_id, project_id),
    )
    realtime.bump("projects")


def update_appearance(
    db: Db, project_id: str, background_image: str, accent_color: str, project_image: str
) -> None:
    p = get_by_id(db, project_id)
    if not p:
        return
    db.write(
        """
        UPDATE projects
        SET background_image = %s, accent_color = %s, project_image = %s
        WHERE id = %s
        """,
        (background_image, accent_color, project_image, project_id),
    )
    realtime.bump("projects")


def add_member(db: Db, project_id: str, user_id: str) -> None:
    exists = fetch_one(
        db,
        """
        SELECT project_id FROM project_members
        WHERE project_id = %s AND user_id = %s
        """,
        (project_id, user_id),
    )
    if exists:
        return
    db.write(
        "INSERT INTO project_members (project_id, user_id) VALUES (%s, %s)",
        (project_id, user_id),
    )
    # Membership affects both the project's roster and the user's project list.
    realtime.bump("projects", "users")


def remove_member(db: Db, project_id: str, user_id: str) -> None:
    db.write(
        "DELETE FROM project_members WHERE project_id = %s AND user_id = %s",
        (project_id, user_id),
    )
    realtime.bump("projects", "users")


def delete_project(db: Db, project_id: str) -> None:
    """Delete a project and everything under it. Project-referencing FKs have no
    DB cascade, so we delete dependents in order; task children (assignees, logs,
    feedback, checklists, attachments, timer runs) DO cascade on task delete via
    their ondelete=CASCADE FKs (SQLite foreign_keys pragma is enabled)."""
    db.write("DELETE FROM timesheet_entries WHERE project_id = %s", (project_id,))
    db.write("DELETE FROM tasks WHERE project_id = %s", (project_id,))
    db.write("DELETE FROM sections WHERE project_id = %s", (project_id,))
    db.write("DELETE FROM project_members WHERE project_id = %s", (project_id,))
    db.write("DELETE FROM projects WHERE id = %s", (project_id,))
    realtime.bump("projects", "tasks", "users")


def member_ids(db: Db, project_id: str) -> list[str]:
    rows = fetch_all(
        db,
        "SELECT user_id FROM project_members WHERE project_id = %s",
        (project_id,),
    )
    return [r["user_id"] for r in rows]


def project_ids_for_user(db: Db, user_id: str) -> set[str]:
    """All project ids the user is a member of — one query (for visibility checks)."""
    rows = fetch_all(
        db,
        "SELECT project_id FROM project_members WHERE user_id = %s",
        (user_id,),
    )
    return {r["project_id"] for r in rows}
