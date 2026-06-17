from sqlalchemy.orm import Session

import realtime
from database.models import TaskAssignee


def list_user_ids_ordered(db: Session, task_id: str) -> list[str]:
    rows = (
        db.query(TaskAssignee)
        .filter(TaskAssignee.task_id == task_id)
        .order_by(TaskAssignee.position.asc(), TaskAssignee.user_id.asc())
        .all()
    )
    return [r.user_id for r in rows]


def map_user_ids_for_tasks(db: Session, task_ids: list[str]) -> dict[str, list[str]]:
    """Ordered assignee user-ids for many tasks in a single query.

    Returns { task_id: [user_id, ...] }. Tasks with no assignees are omitted.
    """
    if not task_ids:
        return {}
    rows = (
        db.query(TaskAssignee)
        .filter(TaskAssignee.task_id.in_(task_ids))
        .order_by(TaskAssignee.position.asc(), TaskAssignee.user_id.asc())
        .all()
    )
    out: dict[str, list[str]] = {}
    for r in rows:
        out.setdefault(r.task_id, []).append(r.user_id)
    return out


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
    realtime.bump("tasks")
