from sqlalchemy.orm import Session

from database.models import TaskAssignee


def list_user_ids_ordered(db: Session, task_id: str) -> list[str]:
    rows = (
        db.query(TaskAssignee)
        .filter(TaskAssignee.task_id == task_id)
        .order_by(TaskAssignee.position.asc(), TaskAssignee.user_id.asc())
        .all()
    )
    return [r.user_id for r in rows]


def is_assignee(db: Session, task_id: str, user_id: str) -> bool:
    return (
        db.query(TaskAssignee)
        .filter(TaskAssignee.task_id == task_id, TaskAssignee.user_id == user_id)
        .first()
        is not None
    )


def set_assignees(db: Session, task_id: str, user_ids: list[str]) -> None:
    db.query(TaskAssignee).filter(TaskAssignee.task_id == task_id).delete()
    for pos, uid in enumerate(user_ids):
        db.add(TaskAssignee(task_id=task_id, user_id=uid, position=pos))
    db.commit()
