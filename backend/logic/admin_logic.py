"""Admin-console business logic: manage users, project membership, and deletion.

The admin is a standalone operator (not a user row). These helpers assume the
caller has already passed the admin auth guard.
"""

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.orm import Session

import crud.users as users_crud
import realtime
from database.models import (
    Project,
    ProjectMember,
    Task,
    TaskAssignee,
    TimesheetEntry,
    User,
)
from logic import auth_logic, user_logic
from logic.schemas import (
    AdminProjectOut,
    AdminProjectsUpdate,
    AdminRoleUpdate,
    UserOut,
)


def list_users(db: Session) -> list[UserOut]:
    return [user_logic.to_user_out(db, u) for u in users_crud.list_all(db)]


def list_projects(db: Session) -> list[AdminProjectOut]:
    out: list[AdminProjectOut] = []
    for p in db.query(Project).order_by(Project.name).all():
        member_ids = [
            r[0] for r in db.query(ProjectMember.user_id)
            .filter(ProjectMember.project_id == p.id).all()
        ]
        out.append(AdminProjectOut(id=p.id, name=p.name, memberIds=member_ids))
    return out


def change_role(db: Session, user_id: str, body: AdminRoleUpdate) -> UserOut:
    user = user_logic.get_user_or_404(db, user_id)
    users_crud.set_role(db, user, body.role)
    db.refresh(user)
    return user_logic.to_user_out(db, user)


def reset_password(db: Session, user_id: str, new_password: str) -> None:
    user = user_logic.get_user_or_404(db, user_id)
    if len(new_password or "") < 6:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Password must be at least 6 characters")
    users_crud.update_password(db, user, auth_logic.hash_password(new_password))


def set_active(db: Session, user_id: str, is_active: bool) -> UserOut:
    user = user_logic.get_user_or_404(db, user_id)
    users_crud.set_active(db, user, is_active)
    db.refresh(user)
    return user_logic.to_user_out(db, user)


def set_projects(db: Session, user_id: str, body: AdminProjectsUpdate) -> UserOut:
    user = user_logic.get_user_or_404(db, user_id)
    # Validate every requested project exists.
    if body.project_ids:
        found = {
            r[0] for r in db.query(Project.id).filter(Project.id.in_(body.project_ids)).all()
        }
        missing = set(body.project_ids) - found
        if missing:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown project id(s): {', '.join(sorted(missing))}")
    users_crud.set_project_membership(db, user_id, body.project_ids)
    db.refresh(user)
    return user_logic.to_user_out(db, user)


def _user_has_work(db: Session, user_id: str) -> bool:
    if db.query(Task.id).filter(Task.assigned_to == user_id).first():
        return True
    if db.query(TaskAssignee.task_id).filter(TaskAssignee.user_id == user_id).first():
        return True
    if db.query(TimesheetEntry.id).filter(TimesheetEntry.user_id == user_id).first():
        return True
    return False


def delete_user(db: Session, user_id: str, reassign_to: str | None) -> None:
    """Hard-delete a user. If they own any work, a valid reassign target is
    required and inherits their tasks, assignments, timesheets and history."""
    victim = user_logic.get_user_or_404(db, user_id)

    target: User | None = None
    if reassign_to:
        if reassign_to == user_id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Cannot reassign a user's work to themselves")
        target = users_crud.get_by_id(db, reassign_to)
        if not target:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Reassignment target user not found")
    elif _user_has_work(db, user_id):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "This user has tasks or timesheet entries. Choose someone to reassign their work to before deleting.",
        )

    p = {"v": user_id, "t": reassign_to}
    if target is not None:
        # ── Simple ownership columns ──────────────────────────────────────────
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

        # ── Composite-unique tables: merge to avoid PK/unique collisions ──────
        # task_assignees (PK: task_id, user_id)
        db.execute(text(
            "DELETE FROM task_assignees WHERE user_id = :v AND task_id IN "
            "(SELECT task_id FROM task_assignees WHERE user_id = :t)"
        ), p)
        db.execute(text("UPDATE task_assignees SET user_id = :t WHERE user_id = :v"), p)

        # task_time_logs (unique: task_id, log_date, user_id) → sum on collision
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

        # project_members (PK: project_id, user_id)
        db.execute(text(
            "DELETE FROM project_members WHERE user_id = :v AND project_id IN "
            "(SELECT project_id FROM project_members WHERE user_id = :t)"
        ), p)
        db.execute(text("UPDATE project_members SET user_id = :t WHERE user_id = :v"), p)

    # ── Personal rows that should not be inherited ────────────────────────────
    db.execute(text("DELETE FROM notifications WHERE user_id = :v"), p)
    db.execute(text("DELETE FROM project_members WHERE user_id = :v"), p)

    db.delete(victim)
    db.commit()
    # Deleting/reassigning touches users, project rosters, and task assignments.
    realtime.bump("users", "projects", "tasks")


def change_admin_password(db: Session, current_password: str, new_password: str) -> None:
    auth_logic.change_admin_password(db, current_password, new_password)
