from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

import crud.users as users_crud
from database.models import User
from logic import auth_logic
from logic.schemas import PasswordUpdate, ProfileUpdate, UserOut


def _calc_current_experience(experience_months: int, joined_at: str) -> int:
    """
    Returns total months of experience today.
    = experience at signup + months elapsed since signup.
    """
    if not joined_at:
        return experience_months
    try:
        signup_dt = datetime.fromisoformat(joined_at)
        now = datetime.now(timezone.utc)
        if signup_dt.tzinfo is None:
            signup_dt = signup_dt.replace(tzinfo=timezone.utc)
        elapsed = (now.year - signup_dt.year) * 12 + (now.month - signup_dt.month)
        return experience_months + max(0, elapsed)
    except Exception:
        return experience_months


def to_user_out(db: Session, user: User, *, viewer_id: str | None = None) -> UserOut:
    pids = users_crud.project_ids_for_user(db, user.id)
    exp_months = getattr(user, "experience_months", 0) or 0
    joined = getattr(user, "joined_at", "") or ""
    return UserOut(
        id=user.id,
        name=user.name,
        email=user.email,
        role=user.role,
        avatar=user.avatar,
        projectIds=pids,
        jobTitle=getattr(user, "job_title", "") or "",
        experienceMonths=exp_months,
        joinedAt=joined,
        currentExperienceMonths=_calc_current_experience(exp_months, joined),
        isActive=bool(getattr(user, "is_active", True)),
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
