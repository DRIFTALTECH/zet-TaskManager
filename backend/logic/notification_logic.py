from datetime import datetime, timezone

from sqlalchemy.orm import Session

import crud.notifications as notifications_crud
import crud.users as users_crud
from database.models import Notification
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
    """Stage a notification (no self-notifications). Caller's flow commits."""
    if user_id == triggered_by:
        return
    notifications_crud.add(db, Notification(
        user_id=user_id,
        type=type,
        title=title,
        message=message,
        entity_type=entity_type,
        entity_id=entity_id,
        is_read=False,
        triggered_by=triggered_by,
        created_at=_now(),
    ))


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
    seen: set[str] = set()
    for uid in user_ids:
        if uid and uid not in seen:
            seen.add(uid)
            create_notification(
                db, user_id=uid, type=type, title=title, message=message,
                entity_type=entity_type, entity_id=entity_id, triggered_by=triggered_by,
            )


def get_notifications(db: Session, user_id: str, limit: int = 50) -> list[NotificationOut]:
    rows = notifications_crud.list_for_user(db, user_id, limit)
    actors = {uid: users_crud.get_by_id(db, uid) for uid in {n.triggered_by for n in rows}}
    result = []
    for n in rows:
        actor = actors.get(n.triggered_by)
        result.append(NotificationOut(
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
        ))
    return result


def unread_count(db: Session, user_id: str) -> int:
    return notifications_crud.unread_count(db, user_id)


def mark_read(db: Session, user_id: str, notification_id: int) -> None:
    n = notifications_crud.get_for_user(db, user_id, notification_id)
    if n:
        n.is_read = True
        notifications_crud.commit(db)


def mark_all_read(db: Session, user_id: str) -> None:
    notifications_crud.mark_all_read(db, user_id)
