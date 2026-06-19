from sqlalchemy.orm import Session

from database.models import TaskTimerRun


def get(db: Session, user_id: str, task_id: str) -> TaskTimerRun | None:
    return (
        db.query(TaskTimerRun)
        .filter(TaskTimerRun.user_id == user_id, TaskTimerRun.task_id == task_id)
        .first()
    )


def list_for_user(db: Session, user_id: str) -> list[TaskTimerRun]:
    return db.query(TaskTimerRun).filter(TaskTimerRun.user_id == user_id).all()


def start(db: Session, user_id: str, task_id: str, started_at: str) -> TaskTimerRun:
    """Begin a run, or return the existing one (idempotent — keeps the original start)."""
    row = get(db, user_id, task_id)
    if row:
        return row
    row = TaskTimerRun(user_id=user_id, task_id=task_id, started_at=started_at)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def delete(db: Session, user_id: str, task_id: str) -> None:
    db.query(TaskTimerRun).filter(
        TaskTimerRun.user_id == user_id, TaskTimerRun.task_id == task_id
    ).delete()
    db.commit()
