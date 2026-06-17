from sqlalchemy.orm import Session

from database.models import TaskChecklist


def get_by_id(db: Session, item_id: str) -> TaskChecklist | None:
    return db.get(TaskChecklist, item_id)


def list_for_task(db: Session, task_id: str) -> list[TaskChecklist]:
    return (
        db.query(TaskChecklist)
        .filter(TaskChecklist.task_id == task_id)
        .order_by(TaskChecklist.position, TaskChecklist.created_at)
        .all()
    )


def count_for_task(db: Session, task_id: str) -> int:
    return db.query(TaskChecklist).filter(TaskChecklist.task_id == task_id).count()


def create(db: Session, item: TaskChecklist) -> TaskChecklist:
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


def update(db: Session, item: TaskChecklist) -> TaskChecklist:
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


def delete(db: Session, item: TaskChecklist) -> None:
    db.delete(item)
    db.commit()
