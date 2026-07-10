"""Admin-console business logic: manage users, project membership, and deletion.

The admin is a standalone operator (not a user row). These helpers assume the
caller has already passed the admin auth guard.
"""

from fastapi import HTTPException, status
from database.database import Db

import crud.admin as admin_crud
import crud.users as users_crud
import realtime
from database.models import User
from logic import auth_logic, user_logic
from logic.schemas import (
    AdminManagerUpdate,
    AdminProjectOut,
    AdminProjectsUpdate,
    AdminRoleUpdate,
    UserOut,
)


def list_users(db: Db) -> list[UserOut]:
    return [user_logic.to_user_out(db, u) for u in users_crud.list_all(db)]


def list_projects(db: Db) -> list[AdminProjectOut]:
    return [
        AdminProjectOut(id=p.id, name=p.name, memberIds=member_ids)
        for p, member_ids in admin_crud.list_projects_with_members(db)
    ]


def change_role(db: Db, user_id: str, body: AdminRoleUpdate) -> UserOut:
    user = user_logic.get_user_or_404(db, user_id)
    user = users_crud.set_role(db, user, body.role)
    return user_logic.to_user_out(db, user)


def reset_password(db: Db, user_id: str, new_password: str) -> None:
    user = user_logic.get_user_or_404(db, user_id)
    if len(new_password or "") < 6:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Password must be at least 6 characters")
    users_crud.update_password(db, user, auth_logic.hash_password(new_password))


def set_active(db: Db, user_id: str, is_active: bool) -> UserOut:
    user = user_logic.get_user_or_404(db, user_id)
    user = users_crud.set_active(db, user, is_active)
    return user_logic.to_user_out(db, user)


def set_projects(db: Db, user_id: str, body: AdminProjectsUpdate) -> UserOut:
    user = user_logic.get_user_or_404(db, user_id)
    # Validate every requested project exists.
    if body.project_ids:
        found = admin_crud.existing_project_ids(db, body.project_ids)
        missing = set(body.project_ids) - found
        if missing:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown project id(s): {', '.join(sorted(missing))}")
    users_crud.set_project_membership(db, user_id, body.project_ids)
    user = user_logic.get_user_or_404(db, user_id)
    return user_logic.to_user_out(db, user)


def set_manager(db: Db, user_id: str, body: AdminManagerUpdate) -> UserOut:
    user = user_logic.get_user_or_404(db, user_id)
    manager_id = body.managerId
    if manager_id:
        if manager_id == user_id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "A user cannot be their own manager")
        manager = users_crud.get_by_id(db, manager_id)
        if not manager:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Manager not found")
        if manager.role not in ("manager", "admin"):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Manager must have manager or admin role")
        if not bool(getattr(manager, "is_active", True)):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Manager account is not active")
    user = users_crud.set_manager_id(db, user, manager_id)
    return user_logic.to_user_out(db, user)


def _user_has_work(db: Db, user_id: str) -> bool:
    return admin_crud.user_has_work(db, user_id)


def delete_user(db: Db, user_id: str, reassign_to: str | None) -> None:
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

    admin_crud.reassign_and_delete_user(db, victim, reassign_to if target is not None else None)
    # Deleting/reassigning touches users, project rosters, and task assignments.
    realtime.bump("users", "projects", "tasks")


def change_admin_password(db: Db, current_password: str, new_password: str) -> None:
    auth_logic.change_admin_password(db, current_password, new_password)
