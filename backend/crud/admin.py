"""Admin-console data access: project rosters, work checks, and the
hard-delete-with-reassign routine (all SQL lives here, not in logic)."""

from sqlalchemy import text
from sqlalchemy.orm import Session

from database.models import Project, ProjectMember, Task, TaskAssignee, TimesheetEntry, User


def list_projects_with_members(db: Session) -> list[tuple[Project, list[str]]]:
    out: list[tuple[Project, list[str]]] = []
    for p in db.query(Project).order_by(Project.name).all():
        member_ids = [
            r[0] for r in db.query(ProjectMember.user_id)
            .filter(ProjectMember.project_id == p.id).all()
        ]
        out.append((p, member_ids))
    return out


def existing_project_ids(db: Session, project_ids: list[str]) -> set[str]:
    if not project_ids:
        return set()
    return {r[0] for r in db.query(Project.id).filter(Project.id.in_(project_ids)).all()}


def user_has_work(db: Session, user_id: str) -> bool:
    if db.query(Task.id).filter(Task.assigned_to == user_id).first():
        return True
    if db.query(TaskAssignee.task_id).filter(TaskAssignee.user_id == user_id).first():
        return True
    if db.query(TimesheetEntry.id).filter(TimesheetEntry.user_id == user_id).first():
        return True
    return False


def reassign_and_delete_user(db: Session, victim: User, reassign_to: str | None) -> None:
    """Reassign all of a user's owned rows to `reassign_to` (when given), drop
    their personal rows, delete the user, and commit."""
    p = {"v": victim.id, "t": reassign_to}
    if reassign_to is not None:
        # Simple ownership columns
        for tbl, col in [
            ("tasks", "assigned_to"),
            ("tasks", "assigned_by"),
            ("tasks", "created_by"),
            ("timesheet_entries", "user_id"),
            ("task_feedback", "user_id"),
            ("task_checklists", "created_by"),
            ("task_attachments", "uploaded_by"),
            ("audit_logs", "user_id"),
            ("projects", "created_by"),
            ("notifications", "triggered_by"),
        ]:
            db.execute(text(f"UPDATE {tbl} SET {col} = :t WHERE {col} = :v"), p)

        # Composite-unique tables: merge to avoid PK/unique collisions
        db.execute(text(
            "DELETE FROM task_assignees WHERE user_id = :v AND task_id IN "
            "(SELECT task_id FROM task_assignees WHERE user_id = :t)"
        ), p)
        db.execute(text("UPDATE task_assignees SET user_id = :t WHERE user_id = :v"), p)

        db.execute(text(
            "UPDATE task_time_logs SET seconds = seconds + COALESCE("
            "(SELECT v.seconds FROM task_time_logs v WHERE v.user_id = :v "
            "AND v.task_id = task_time_logs.task_id AND v.log_date = task_time_logs.log_date), 0) "
            "WHERE user_id = :t"
        ), p)
        db.execute(text(
            "DELETE FROM task_time_logs WHERE user_id = :v AND (task_id, log_date) IN "
            "(SELECT task_id, log_date FROM task_time_logs WHERE user_id = :t)"
        ), p)
        db.execute(text("UPDATE task_time_logs SET user_id = :t WHERE user_id = :v"), p)

        db.execute(text(
            "DELETE FROM project_members WHERE user_id = :v AND project_id IN "
            "(SELECT project_id FROM project_members WHERE user_id = :t)"
        ), p)
        db.execute(text("UPDATE project_members SET user_id = :t WHERE user_id = :v"), p)

    # Personal rows that should not be inherited
    db.execute(text("DELETE FROM notifications WHERE user_id = :v"), p)
    db.execute(text("DELETE FROM project_members WHERE user_id = :v"), p)

    db.delete(victim)
    db.commit()
