from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

import realtime
from database.database import get_db
from logic import task_feedback_logic, task_logic, timer_logic
from logic.schemas import (
    LogTimeBody,
    TaskCreate,
    TaskFeedbackCreate,
    TaskFeedbackOut,
    TaskFeedbackPatch,
    TaskMoveBody,
    TaskOut,
    TaskPatch,
    TimerRunOut,
    TimerStopBody,
)
from routes.deps import get_current_user_id

router = APIRouter()


@router.get("", response_model=list[TaskOut])
def list_tasks(user_id: str = Depends(get_current_user_id), db: Session = Depends(get_db)):
    return task_logic.list_tasks(db, user_id)


@router.get("/timers/active", response_model=list[TimerRunOut])
def active_timers(user_id: str = Depends(get_current_user_id), db: Session = Depends(get_db)):
    """Running timers for the current user (so the UI shows live state after a reload)."""
    return timer_logic.list_active(db, user_id)


@router.post("/{task_id}/timer/start", response_model=TimerRunOut)
def start_timer(task_id: str, user_id: str = Depends(get_current_user_id), db: Session = Depends(get_db)):
    return timer_logic.start(db, user_id, task_id)


@router.post("/{task_id}/timer/stop", response_model=TaskOut)
def stop_timer(task_id: str, body: TimerStopBody, user_id: str = Depends(get_current_user_id), db: Session = Depends(get_db)):
    return timer_logic.stop(db, user_id, task_id, body.tzOffset)


@router.get("/version")
def tasks_version(user_id: str = Depends(get_current_user_id)):
    """Tiny endpoint for smart polling — prefer GET /sync/version for all channels."""
    return {"version": realtime.current("tasks")}


@router.post("", response_model=TaskOut)
def create_task(body: TaskCreate, user_id: str = Depends(get_current_user_id), db: Session = Depends(get_db)):
    return task_logic.create_task_action(db, user_id, body)


@router.patch("/{task_id}", response_model=TaskOut)
def patch_task(task_id: str, body: TaskPatch, user_id: str = Depends(get_current_user_id), db: Session = Depends(get_db)):
    return task_logic.patch_task_action(db, user_id, task_id, body)


@router.delete("/{task_id}", status_code=204)
def delete_task(task_id: str, user_id: str = Depends(get_current_user_id), db: Session = Depends(get_db)):
    task_logic.delete_task_action(db, user_id, task_id)
    return Response(status_code=204)


@router.post("/{task_id}/start", response_model=TaskOut)
def start_task(task_id: str, user_id: str = Depends(get_current_user_id), db: Session = Depends(get_db)):
    return task_logic.start_task_action(db, user_id, task_id)


@router.post("/{task_id}/move", response_model=TaskOut)
def move_task(task_id: str, body: TaskMoveBody, user_id: str = Depends(get_current_user_id), db: Session = Depends(get_db)):
    return task_logic.move_task_action(db, user_id, task_id, body)


@router.post("/{task_id}/reopen-to-backlog", response_model=TaskOut)
def reopen_task_to_backlog(task_id: str, user_id: str = Depends(get_current_user_id), db: Session = Depends(get_db)):
    return task_logic.reopen_to_backlog_action(db, user_id, task_id)


@router.post("/{task_id}/approve", response_model=TaskOut)
def approve_task(task_id: str, user_id: str = Depends(get_current_user_id), db: Session = Depends(get_db)):
    return task_logic.approve_task_action(db, user_id, task_id)


@router.post("/{task_id}/log-time", response_model=TaskOut)
def log_time(task_id: str, body: LogTimeBody, user_id: str = Depends(get_current_user_id), db: Session = Depends(get_db)):
    return task_logic.log_time(db, user_id, task_id, body)


@router.get("/{task_id}/feedback", response_model=list[TaskFeedbackOut])
def list_task_feedback(task_id: str, user_id: str = Depends(get_current_user_id), db: Session = Depends(get_db)):
    return task_feedback_logic.list_feedback(db, user_id, task_id)


@router.post("/{task_id}/feedback", response_model=TaskFeedbackOut)
def create_task_feedback(task_id: str, body: TaskFeedbackCreate, user_id: str = Depends(get_current_user_id), db: Session = Depends(get_db)):
    return task_feedback_logic.create_feedback_action(db, user_id, task_id, body)


@router.patch("/{task_id}/feedback/{feedback_id}", response_model=TaskFeedbackOut)
def patch_task_feedback(task_id: str, feedback_id: str, body: TaskFeedbackPatch, user_id: str = Depends(get_current_user_id), db: Session = Depends(get_db)):
    return task_feedback_logic.patch_feedback(db, user_id, task_id, feedback_id, body)


@router.delete("/{task_id}/feedback/{feedback_id}", status_code=204)
def delete_task_feedback(task_id: str, feedback_id: str, user_id: str = Depends(get_current_user_id), db: Session = Depends(get_db)):
    task_feedback_logic.delete_feedback(db, user_id, task_id, feedback_id)
    return Response(status_code=204)
