"""Business logic for task checklists — DB access delegated to crud/checklists."""

import uuid
from datetime import datetime, timezone

from fastapi import HTTPException, status

import crud.checklists as checklists_crud
import crud.tasks as tasks_crud
from database.models import TaskChecklist
from logic.audit import log_audit
from logic.schemas import TaskChecklistCreate, TaskChecklistOut, TaskChecklistPatch


def _ensure_task(db, task_id: str):
    t = tasks_crud.get_by_id(db, task_id)
    if not t:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Task not found")
    return t


def _to_out(row: TaskChecklist) -> TaskChecklistOut:
    return TaskChecklistOut(
        id=row.id,
        taskId=row.task_id,
        title=row.title,
        priority=row.priority,
        isDone=row.is_done,
        position=row.position,
        createdBy=row.created_by,
        createdAt=row.created_at,
    )


def list_for_task(db, task_id: str) -> list[TaskChecklistOut]:
    _ensure_task(db, task_id)
    return [_to_out(r) for r in checklists_crud.list_for_task(db, task_id)]


def create(db, task_id: str, body: TaskChecklistCreate, user_id: str) -> TaskChecklistOut:
    task = _ensure_task(db, task_id)
    row = TaskChecklist(
        id=str(uuid.uuid4()),
        task_id=task_id,
        title=body.title,
        priority=body.priority,
        is_done=False,
        position=checklists_crud.count_for_task(db, task_id),
        created_by=user_id,
        created_at=datetime.now(timezone.utc).isoformat(),
    )
    checklists_crud.create(db, row)
    log_audit(db, user_id, "checklist.created", "checklist", row.id, body.title,
              {"taskId": task_id, "taskTitle": task.title})
    return _to_out(row)


def patch(db, task_id: str, item_id: str, body: TaskChecklistPatch, user_id: str) -> TaskChecklistOut:
    _ensure_task(db, task_id)
    row = checklists_crud.get_by_id(db, item_id)
    if not row or row.task_id != task_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Checklist item not found")
    action = "checklist.updated"
    if body.title is not None:
        row.title = body.title
    if body.priority is not None:
        row.priority = body.priority
    if body.isDone is not None:
        row.is_done = body.isDone
        action = "checklist.done" if body.isDone else "checklist.undone"
    checklists_crud.update(db, row)
    log_audit(db, user_id, action, "checklist", row.id, row.title, {"taskId": task_id})
    return _to_out(row)


def delete(db, task_id: str, item_id: str, user_id: str) -> None:
    _ensure_task(db, task_id)
    row = checklists_crud.get_by_id(db, item_id)
    if not row or row.task_id != task_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Checklist item not found")
    log_audit(db, user_id, "checklist.deleted", "checklist", row.id, row.title, {"taskId": task_id})
    checklists_crud.delete(db, row)
