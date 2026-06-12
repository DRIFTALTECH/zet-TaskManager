from datetime import datetime, timezone

from sqlalchemy.orm import Session

from database.models import Notification, User
from logic.schemas import NotificationOut


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def create_notification(
    db: Session,
    *,
    user_id: str,
    type: str,
    title: str,
    message: str,
    entity_type: str,
    entity_id: str,
    triggered_by: str,
) -> None:
    """Create a notification. Silently skips if user_id == triggered_by (no self-notifications)."""
    if user_id == triggered_by:
        return
    n = Notification(
        user_id=user_id,
        type=type,
        title=title,
        message=message,
        entity_type=entity_type,
        entity_id=entity_id,
        is_read=False,
        triggered_by=triggered_by,
        created_at=_now(),
    )
    db.add(n)


def notify_users(
    db: Session,
    *,
    user_ids: list[str],
    type: str,
    title: str,
    message: str,
    entity_type: str,
    entity_id: str,
    triggered_by: str,
) -> None:
    """Convenience wrapper — create one notification per unique user_id."""
    seen: set[str] = set()
    for uid in user_ids:
        if uid and uid not in seen:
            seen.add(uid)
            create_notification(
                db,
                user_id=uid,
                type=type,
                title=title,
                message=message,
                entity_type=entity_type,
                entity_id=entity_id,
                triggered_by=triggered_by,
            )


def get_notifications(db: Session, user_id: str, limit: int = 50) -> list[NotificationOut]:
    rows = (
        db.query(Notification)
        .filter(Notification.user_id == user_id)
        .order_by(Notification.id.desc())
        .limit(limit)
        .all()
    )
    result = []
    for n in rows:
        actor = db.get(User, n.triggered_by)
        result.append(
            NotificationOut(
                id=n.id,
                type=n.type,
                title=n.title,
                message=n.message,
                entityType=n.entity_type,
                entityId=n.entity_id,
                isRead=n.is_read,
                triggeredBy=n.triggered_by,
                triggeredByName=actor.name if actor else "Unknown",
                triggeredByAvatar=actor.avatar if actor else "",
                createdAt=n.created_at,
            )
        )
    return result


def unread_count(db: Session, user_id: str) -> int:
    return (
        db.query(Notification)
        .filter(Notification.user_id == user_id, Notification.is_read == False)  # noqa: E712
        .count()
    )


def mark_read(db: Session, user_id: str, notification_id: int) -> None:
    n = (
        db.query(Notification)
        .filter(Notification.id == notification_id, Notification.user_id == user_id)
        .first()
    )
    if n:
        n.is_read = True


def mark_all_read(db: Session, user_id: str) -> None:
    (
        db.query(Notification)
        .filter(Notification.user_id == user_id, Notification.is_read == False)  # noqa: E712
        .update({"is_read": True}, synchronize_session=False)
    )
