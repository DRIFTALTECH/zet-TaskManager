from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from database.database import get_db
from logic import notification_logic
from logic.schemas import NotificationOut
from routes.deps import get_current_user_id

router = APIRouter()


@router.get("", response_model=list[NotificationOut])
def list_notifications(
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    return notification_logic.get_notifications(db, user_id)


@router.get("/unread-count")
def get_unread_count(
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    return {"count": notification_logic.unread_count(db, user_id)}


@router.post("/read-all", status_code=204)
def mark_all_read(
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    notification_logic.mark_all_read(db, user_id)
    db.commit()
    return Response(status_code=204)


@router.post("/{notification_id}/read", status_code=204)
def mark_read(
    notification_id: int,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    notification_logic.mark_read(db, user_id, notification_id)
    db.commit()
    return Response(status_code=204)
