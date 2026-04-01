from sqlalchemy import func
from sqlalchemy.orm import Session

from database.models import Task, TaskTimeLog


def get_row(db: Session, task_id: str, log_date: str, user_id: str) -> TaskTimeLog | None:
    return (
        db.query(TaskTimeLog)
        .filter(
            TaskTimeLog.task_id == task_id,
            TaskTimeLog.log_date == log_date,
            TaskTimeLog.user_id == user_id,
        )
        .first()
    )


def sum_seconds_for_task(db: Session, task_id: str) -> int:
    q = db.query(func.coalesce(func.sum(TaskTimeLog.seconds), 0)).filter(TaskTimeLog.task_id == task_id)
    return int(q.scalar() or 0)


def add_seconds(db: Session, task_id: str, log_date: str, seconds: int, user_id: str) -> TaskTimeLog:
    row = get_row(db, task_id, log_date, user_id)
    if row:
        row.seconds += seconds
        db.add(row)
    else:
        row = TaskTimeLog(task_id=task_id, user_id=user_id, log_date=log_date, seconds=seconds)
        db.add(row)
    db.flush()
    task = db.get(Task, task_id)
    if task:
        task.time_tracked = sum_seconds_for_task(db, task_id)
        db.add(task)
    db.commit()
    db.refresh(row)
    return row


def list_for_task(db: Session, task_id: str) -> list[TaskTimeLog]:
    return db.query(TaskTimeLog).filter(TaskTimeLog.task_id == task_id).all()


def time_log_map_for_user(db: Session, task_id: str, user_id: str) -> dict[str, int]:
    rows = (
        db.query(TaskTimeLog)
        .filter(TaskTimeLog.task_id == task_id, TaskTimeLog.user_id == user_id)
        .all()
    )
    return {r.log_date: r.seconds for r in rows}


def recompute_task_total(db: Session, task_id: str) -> int:
    total = sum_seconds_for_task(db, task_id)
    task = db.get(Task, task_id)
    if task:
        task.time_tracked = total
        db.add(task)
        db.commit()
    return total
