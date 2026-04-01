from sqlalchemy.orm import Session

from database.models import TaskFeedback


def list_for_task(db: Session, task_id: str) -> list[TaskFeedback]:
    return (
        db.query(TaskFeedback)
        .filter(TaskFeedback.task_id == task_id)
        .order_by(TaskFeedback.created_at.asc())
        .all()
    )


def get_by_id(db: Session, feedback_id: str) -> TaskFeedback | None:
    return db.query(TaskFeedback).filter(TaskFeedback.id == feedback_id).first()


def create_row(db: Session, row: TaskFeedback) -> TaskFeedback:
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def update_row(db: Session, row: TaskFeedback) -> TaskFeedback:
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def delete_row(db: Session, row: TaskFeedback) -> None:
    db.delete(row)
    db.commit()
