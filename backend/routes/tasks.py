from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from database.database import get_db
from database.models import Task
from logic import task_feedback_logic, task_logic
from logic.audit import log_audit
from logic.schemas import (
    LogTimeBody,
    TaskCreate,
    TaskFeedbackCreate,
    TaskFeedbackOut,
    TaskFeedbackPatch,
    TaskMoveBody,
    TaskOut,
    TaskPatch,
)
from routes.deps import get_current_user_id

router = APIRouter()


@router.get("", response_model=list[TaskOut])
def list_tasks(user_id: str = Depends(get_current_user_id), db: Session = Depends(get_db)):
    return task_logic.list_tasks(db, user_id)


@router.post("", response_model=TaskOut)
def create_task(
    body: TaskCreate,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    result = task_logic.create_task(db, user_id, body)
    log_audit(db, user_id, "task.created", "task", result.id, result.title,
              {"projectId": result.projectId, "priority": result.priority})
    db.commit()
    return result


@router.patch("/{task_id}", response_model=TaskOut)
def patch_task(
    task_id: str,
    body: TaskPatch,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    result = task_logic.patch_task(db, user_id, task_id, body)
    details: dict = {}
    if body.status is not None:
        details["status"] = body.status
    if body.priority is not None:
        details["priority"] = body.priority
    log_audit(db, user_id, "task.updated", "task", task_id, result.title, details)
    db.commit()
    return result


@router.delete("/{task_id}", status_code=204)
def delete_task(
    task_id: str,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    task = db.get(Task, task_id)
    title = task.title if task else task_id
    task_logic.delete_task(db, user_id, task_id)
    log_audit(db, user_id, "task.deleted", "task", task_id, title, {})
    db.commit()
    return Response(status_code=204)


@router.post("/{task_id}/start", response_model=TaskOut)
def start_task(
    task_id: str,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    result = task_logic.start_task(db, user_id, task_id)
    log_audit(db, user_id, "task.started", "task", task_id, result.title, {})
    db.commit()
    return result


@router.post("/{task_id}/move", response_model=TaskOut)
def move_task(
    task_id: str,
    body: TaskMoveBody,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    result = task_logic.move_task(db, user_id, task_id, body)
    log_audit(db, user_id, "task.status_changed", "task", task_id, result.title,
              {"status": body.status})
    db.commit()
    return result


@router.post("/{task_id}/reopen-to-backlog", response_model=TaskOut)
def reopen_task_to_backlog(
    task_id: str,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    result = task_logic.reopen_completed_to_backlog(db, user_id, task_id)
    log_audit(db, user_id, "task.reopened", "task", task_id, result.title, {})
    db.commit()
    return result


@router.post("/{task_id}/approve", response_model=TaskOut)
def approve_task(
    task_id: str,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    result = task_logic.approve_task(db, user_id, task_id)
    log_audit(db, user_id, "task.approved", "task", task_id, result.title, {})
    db.commit()
    return result


@router.post("/{task_id}/log-time", response_model=TaskOut)
def log_time(
    task_id: str,
    body: LogTimeBody,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    return task_logic.log_time(db, user_id, task_id, body)


@router.get("/{task_id}/feedback", response_model=list[TaskFeedbackOut])
def list_task_feedback(
    task_id: str,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    return task_feedback_logic.list_feedback(db, user_id, task_id)


@router.post("/{task_id}/feedback", response_model=TaskFeedbackOut)
def create_task_feedback(
    task_id: str,
    body: TaskFeedbackCreate,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    result = task_feedback_logic.create_feedback(db, user_id, task_id, body)
    log_audit(db, user_id, "task.comment_added", "task", task_id, "", {})
    db.commit()
    return result


@router.patch("/{task_id}/feedback/{feedback_id}", response_model=TaskFeedbackOut)
def patch_task_feedback(
    task_id: str,
    feedback_id: str,
    body: TaskFeedbackPatch,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    return task_feedback_logic.patch_feedback(db, user_id, task_id, feedback_id, body)


@router.delete("/{task_id}/feedback/{feedback_id}", status_code=204)
def delete_task_feedback(
    task_id: str,
    feedback_id: str,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    task_feedback_logic.delete_feedback(db, user_id, task_id, feedback_id)
    return Response(status_code=204)
