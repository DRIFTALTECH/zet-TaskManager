from fastapi import HTTPException, status
from sqlalchemy.orm import Session

import crud.projects as projects_crud
import crud.users as users_crud
from database.models import User
from logic import auth_logic
from logic.schemas import PasswordUpdate, ProfileUpdate, UserOut


def _is_hidden_personal_of_user(db: Session, project_id: str, profile_user_id: str) -> bool:
    p = projects_crud.get_by_id(db, project_id)
    return bool(p and p.is_personal and p.created_by == profile_user_id)


def _project_ids_ordered_personal_first(db: Session, user_id: str, pids: list[str]) -> list[str]:
    personal: list[str] = []
    rest: list[str] = []
    for pid in pids:
        p = projects_crud.get_by_id(db, pid)
        if p and p.is_personal and p.created_by == user_id:
            personal.append(pid)
        else:
            rest.append(pid)
    return personal + rest


def to_user_out(db: Session, user: User, *, viewer_id: str | None = None) -> UserOut:
    pids = users_crud.project_ids_for_user(db, user.id)
    if viewer_id is not None and viewer_id != user.id:
        pids = [pid for pid in pids if not _is_hidden_personal_of_user(db, pid, user.id)]
    else:
        pids = _project_ids_ordered_personal_first(db, user.id, pids)
    return UserOut(
        id=user.id,
        name=user.name,
        email=user.email,
        role=user.role,
        avatar=user.avatar,
        projectIds=pids,
    )


def get_user_or_404(db: Session, user_id: str) -> User:
    u = users_crud.get_by_id(db, user_id)
    if not u:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    return u


def list_users(db: Session, viewer_id: str) -> list[UserOut]:
    return [to_user_out(db, u, viewer_id=viewer_id) for u in users_crud.list_all(db)]


def update_profile(db: Session, user_id: str, body: ProfileUpdate) -> UserOut:
    user = get_user_or_404(db, user_id)
    name = body.name.strip() if body.name is not None else user.name
    avatar = body.avatar if body.avatar is not None else user.avatar
    if body.name is not None and not name:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Name cannot be empty")
    users_crud.update_user(db, user, name=name, avatar=avatar)
    db.refresh(user)
    return to_user_out(db, user)


def change_password(db: Session, user_id: str, body: PasswordUpdate) -> None:
    user = get_user_or_404(db, user_id)
    if not auth_logic.verify_password(body.current_password, user.password_hash):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Current password is incorrect")
    if len(body.new_password) < 6:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "New password must be at least 6 characters")
    users_crud.update_password(db, user, auth_logic.hash_password(body.new_password))
