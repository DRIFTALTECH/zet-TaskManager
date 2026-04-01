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


def create_user(
    db: Session,
    *,
    user_id: str,
    name: str,
    email: str,
    password_hash: str,
    role: str,
    avatar: str = "",
) -> User:
    u = User(
        id=user_id,
        name=name,
        email=email,
        password_hash=password_hash,
        role=role,
        avatar=avatar,
    )
    db.add(u)
    db.commit()
    db.refresh(u)
    return u
