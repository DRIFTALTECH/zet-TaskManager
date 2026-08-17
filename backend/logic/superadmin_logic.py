"""Superadmin-console business logic: manage users, project membership, and deletion.

The superadmin is a normal user row with role="superadmin". Every helper takes the
acting superadmin's id so it can be audited and so a superadmin cannot lock
themselves — or the last remaining superadmin — out of the console.
"""

from fastapi import HTTPException, status
from database.database import Db

import crud.admin as superadmin_crud
import crud.users as users_crud
import realtime
from database.models import User
from logic import auth_logic, user_logic
from logic.audit import log_audit
from logic.schemas import (
    SuperadminManagerUpdate,
    SuperadminProjectOut,
    SuperadminProjectsUpdate,
    SuperadminRoleUpdate,
    UserOut,
)

SUPERADMIN_ROLE = "superadmin"


def _self_guard(actor_id: str, target_id: str, action: str) -> None:
    """A superadmin acting on their own row is how you lock yourself out."""
    if actor_id == target_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"You cannot {action} your own account")


def _ensure_another_superadmin_remains(db: Db, target_id: str) -> None:
    """Refuse a change that would leave the app with no active superadmin."""
    remaining = [
        u.id
        for u in users_crud.list_all(db)
        if u.role == SUPERADMIN_ROLE and bool(getattr(u, "is_active", True)) and u.id != target_id
    ]
    if not remaining:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "This is the only active superadmin. Promote someone else first.",
        )


def list_users(db: Db) -> list[UserOut]:
    return [user_logic.to_user_out(db, u) for u in users_crud.list_all(db)]


def list_projects(db: Db) -> list[SuperadminProjectOut]:
    return [
        SuperadminProjectOut(id=p.id, name=p.name, memberIds=member_ids)
        for p, member_ids in superadmin_crud.list_projects_with_members(db)
    ]


def change_role(db: Db, actor_id: str, user_id: str, body: SuperadminRoleUpdate) -> UserOut:
    _self_guard(actor_id, user_id, "change the role of")
    user = user_logic.get_user_or_404(db, user_id)
    if user.role == SUPERADMIN_ROLE and body.role != SUPERADMIN_ROLE:
        _ensure_another_superadmin_remains(db, user_id)
    previous = user.role
    user = users_crud.set_role(db, user, body.role)
    log_audit(db, actor_id, "user.role_changed", "user", user.id, user.name,
              {"from": previous, "to": body.role})
    return user_logic.to_user_out(db, user)


def reset_password(db: Db, actor_id: str, user_id: str, new_password: str) -> None:
    # Strength is enforced by SuperadminPasswordReset at the schema boundary.
    user = user_logic.get_user_or_404(db, user_id)
    users_crud.update_password(db, user, auth_logic.hash_password(new_password))
    log_audit(db, actor_id, "user.password_reset", "user", user.id, user.name, {})


def set_active(db: Db, actor_id: str, user_id: str, is_active: bool) -> UserOut:
    """Approve a pending registration, or switch an existing account off. The
    active flag is re-read on every request, so deactivating ends live sessions."""
    if not is_active:
        _self_guard(actor_id, user_id, "deactivate")
    user = user_logic.get_user_or_404(db, user_id)
    if not is_active and user.role == SUPERADMIN_ROLE:
        _ensure_another_superadmin_remains(db, user_id)
    user = users_crud.set_active(db, user, is_active)
    log_audit(db, actor_id, "user.activated" if is_active else "user.deactivated",
              "user", user.id, user.name, {})
    return user_logic.to_user_out(db, user)


def list_pending(db: Db) -> list[UserOut]:
    """Accounts that have registered but not yet been approved."""
    return [
        user_logic.to_user_out(db, u)
        for u in users_crud.list_all(db)
        if not bool(getattr(u, "is_active", True))
    ]


def set_projects(db: Db, actor_id: str, user_id: str, body: SuperadminProjectsUpdate) -> UserOut:
    user = user_logic.get_user_or_404(db, user_id)
    # Validate every requested project exists.
    if body.project_ids:
        found = superadmin_crud.existing_project_ids(db, body.project_ids)
        missing = set(body.project_ids) - found
        if missing:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown project id(s): {', '.join(sorted(missing))}")
    users_crud.set_project_membership(db, user_id, body.project_ids)
    user = user_logic.get_user_or_404(db, user_id)
    return user_logic.to_user_out(db, user)


def set_manager(db: Db, actor_id: str, user_id: str, body: SuperadminManagerUpdate) -> UserOut:
    user = user_logic.get_user_or_404(db, user_id)
    manager_id = body.managerId
    if manager_id:
        if manager_id == user_id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "A user cannot be their own manager")
        manager = users_crud.get_by_id(db, manager_id)
        if not manager:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Manager not found")
        if manager.role not in ("manager", SUPERADMIN_ROLE):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "A manager must hold the manager or superadmin role")
        if not bool(getattr(manager, "is_active", True)):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Manager account is not active")
    user = users_crud.set_manager_id(db, user, manager_id)
    return user_logic.to_user_out(db, user)


def _user_has_work(db: Db, user_id: str) -> bool:
    return superadmin_crud.user_has_work(db, user_id)


def delete_user(db: Db, actor_id: str, user_id: str, reassign_to: str | None) -> None:
    """Hard-delete a user. If they own any work, a valid reassign target is
    required and inherits their tasks, assignments, timesheets and history."""
    _self_guard(actor_id, user_id, "delete")
    victim = user_logic.get_user_or_404(db, user_id)
    if victim.role == SUPERADMIN_ROLE:
        _ensure_another_superadmin_remains(db, user_id)

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

    log_audit(db, actor_id, "user.deleted", "user", victim.id, victim.name,
              {"reassignedTo": reassign_to if target is not None else None})
    superadmin_crud.reassign_and_delete_user(db, victim, reassign_to if target is not None else None)
    # Deleting/reassigning touches users, project rosters, and task assignments.
    realtime.bump("users", "projects", "tasks")

