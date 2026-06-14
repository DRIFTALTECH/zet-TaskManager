from sqlalchemy import func
from sqlalchemy.orm import Session

from database.models import ProjectMember, User


def get_by_email(db: Session, email: str) -> User | None:
    normalized = email.strip().lower()
    return db.query(User).filter(func.lower(User.email) == normalized).first()


def get_by_id(db: Session, user_id: str) -> User | None:
    return db.query(User).get(user_id)


def list_all(db: Session) -> list[User]:
    return db.query(User).order_by(User.name).all()


def update_user(db: Session, user: User, *, name: str | None = None, avatar: str | None = None) -> User:
    if name is not None:
        user.name = name
    if avatar is not None:
        user.avatar = avatar
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def update_password(db: Session, user: User, password_hash: str) -> User:
    user.password_hash = password_hash
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def project_ids_for_user(db: Session, user_id: str) -> list[str]:
    rows = db.query(ProjectMember.project_id).filter(ProjectMember.user_id == user_id).all()
    return [r[0] for r in rows]


def set_role(db: Session, user: User, role: str) -> User:
    user.role = role
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def set_active(db: Session, user: User, is_active: bool) -> User:
    user.is_active = is_active
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def set_project_membership(db: Session, user_id: str, project_ids: list[str]) -> None:
    """Replace the set of projects this user belongs to with exactly `project_ids`."""
    wanted = {p for p in project_ids if p}
    existing = {
        r[0] for r in db.query(ProjectMember.project_id)
        .filter(ProjectMember.user_id == user_id).all()
    }
    for pid in existing - wanted:
        db.query(ProjectMember).filter(
            ProjectMember.user_id == user_id, ProjectMember.project_id == pid
        ).delete(synchronize_session=False)
    for pid in wanted - existing:
        db.add(ProjectMember(user_id=user_id, project_id=pid))
    db.commit()


def create_user(
    db: Session,
    *,
    user_id: str,
    name: str,
    email: str,
    password_hash: str,
    role: str,
    avatar: str = "",
    job_title: str = "",
    experience_months: int = 0,
    joined_at: str = "",
) -> User:
    from datetime import datetime, timezone
    u = User(
        id=user_id,
        name=name,
        email=email,
        password_hash=password_hash,
        role=role,
        avatar=avatar,
        job_title=job_title,
        experience_months=experience_months,
        joined_at=joined_at or datetime.now(timezone.utc).isoformat(),
    )
    db.add(u)
    db.commit()
    db.refresh(u)
    return u
