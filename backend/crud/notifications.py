from sqlalchemy.orm import Session

from database.models import Notification


def add(db: Session, notification: Notification) -> None:
    """Stage a notification within the current transaction (caller controls commit)."""
    db.add(notification)


def list_for_user(db: Session, user_id: str, limit: int) -> list[Notification]:
    return (
        db.query(Notification)
        .filter(Notification.user_id == user_id)
        .order_by(Notification.id.desc())
        .limit(limit)
        .all()
    )


def unread_count(db: Session, user_id: str) -> int:
    return (
        db.query(Notification)
        .filter(Notification.user_id == user_id, Notification.is_read == False)  # noqa: E712
        .count()
    )


def get_for_user(db: Session, user_id: str, notification_id: int) -> Notification | None:
    return (
        db.query(Notification)
        .filter(Notification.id == notification_id, Notification.user_id == user_id)
        .first()
    )


def mark_all_read(db: Session, user_id: str) -> None:
    (
        db.query(Notification)
        .filter(Notification.user_id == user_id, Notification.is_read == False)  # noqa: E712
        .update({"is_read": True}, synchronize_session=False)
    )
    db.commit()


def commit(db: Session) -> None:
    db.commit()
