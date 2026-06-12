"""Checklist sub-resource: /tasks/{task_id}/checklists"""

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from database.database import get_db
from database.models import Task, TaskChecklist
from logic.audit import log_audit
from logic.schemas import TaskChecklistCreate, TaskChecklistOut, TaskChecklistPatch
from routes.deps import get_current_user_id

router = APIRouter()


def _get_task_or_404(task_id: str, db: Session) -> Task:
    t = db.get(Task, task_id)
    if not t:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Task not found")
    return t


def _row_to_out(row: TaskChecklist) -> TaskChecklistOut:
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


@router.get("", response_model=list[TaskChecklistOut])
def list_checklists(
    task_id: str,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    _get_task_or_404(task_id, db)
    rows = (
        db.query(TaskChecklist)
        .filter(TaskChecklist.task_id == task_id)
        .order_by(TaskChecklist.position, TaskChecklist.created_at)
        .all()
    )
    return [_row_to_out(r) for r in rows]


@router.post("", response_model=TaskChecklistOut, status_code=201)
def create_checklist(
    task_id: str,
    body: TaskChecklistCreate,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    task = _get_task_or_404(task_id, db)
    # next position
    max_pos = (
        db.query(TaskChecklist)
        .filter(TaskChecklist.task_id == task_id)
        .count()
    )
    row = TaskChecklist(
        id=str(uuid.uuid4()),
        task_id=task_id,
        title=body.title,
        priority=body.priority,
        is_done=False,
        position=max_pos,
        created_by=user_id,
        created_at=datetime.now(timezone.utc).isoformat(),
    )
    db.add(row)
    log_audit(db, user_id, "checklist.created", "checklist", row.id, body.title,
              {"taskId": task_id, "taskTitle": task.title})
    db.commit()
    db.refresh(row)
    return _row_to_out(row)


@router.patch("/{item_id}", response_model=TaskChecklistOut)
def patch_checklist(
    task_id: str,
    item_id: str,
    body: TaskChecklistPatch,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    _get_task_or_404(task_id, db)
    row = db.get(TaskChecklist, item_id)
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

    log_audit(db, user_id, action, "checklist", row.id, row.title,
              {"taskId": task_id})
    db.commit()
    db.refresh(row)
    return _row_to_out(row)


@router.delete("/{item_id}", status_code=204)
def delete_checklist(
    task_id: str,
    item_id: str,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    _get_task_or_404(task_id, db)
    row = db.get(TaskChecklist, item_id)
    if not row or row.task_id != task_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Checklist item not found")
    log_audit(db, user_id, "checklist.deleted", "checklist", row.id, row.title,
              {"taskId": task_id})
    db.delete(row)
    db.commit()
    return Response(status_code=204)
