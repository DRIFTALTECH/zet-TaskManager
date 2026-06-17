from sqlalchemy.orm import Session

from database.models import TaskAttachment


def get_by_id(db: Session, attachment_id: str) -> TaskAttachment | None:
    return db.get(TaskAttachment, attachment_id)


def list_for_task(db: Session, task_id: str) -> list[TaskAttachment]:
    return (
        db.query(TaskAttachment)
        .filter(TaskAttachment.task_id == task_id)
        .order_by(TaskAttachment.created_at)
        .all()
    )


def create(db: Session, attachment: TaskAttachment) -> TaskAttachment:
    db.add(attachment)
    db.commit()
    db.refresh(attachment)
    return attachment


def delete(db: Session, attachment: TaskAttachment) -> None:
    db.delete(attachment)
    db.commit()
