"""Server-side per-task work timers.

The running state (when a user started timing a task) lives in the DB
(`task_timer_runs`), not the browser — so a timer survives reloads and is
consistent across devices. Elapsed time is computed server-side on stop and
rolled into the task time log (and a timesheet row), the single source of truth.
"""

from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

import crud.tasks as tasks_crud
import crud.timelog as timelog_crud
import crud.timers as timers_crud
from logic import task_logic, timesheet_logic
from logic.schemas import TimesheetEntryCreate, TimerRunOut

MIN_PERSIST_SECONDS = 60  # sessions shorter than this aren't logged


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _to_out(row) -> TimerRunOut:
    return TimerRunOut(taskId=row.task_id, startedAt=row.started_at)


def list_active(db: Session, user_id: str) -> list[TimerRunOut]:
    return [_to_out(r) for r in timers_crud.list_for_user(db, user_id)]


def start(db: Session, user_id: str, task_id: str) -> TimerRunOut:
    """Mark the task started (perms enforced there) and record a running timer."""
    task_logic.start_task_action(db, user_id, task_id)  # 404/403 + audit + commit
    row = timers_crud.start(db, user_id, task_id, _now_utc().isoformat())
    return _to_out(row)


def stop(db: Session, user_id: str, task_id: str, tz_offset_minutes: int = 0):
    """Stop the running timer, compute elapsed server-side, and log the time.

    `tz_offset_minutes` is the client's Date.getTimezoneOffset() (UTC − local),
    used only to render the timesheet row's wall-clock times in the user's zone.
    Returns the updated TaskOut.
    """
    task = tasks_crud.get_by_id(db, task_id)
    if not task:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Task not found")

    run = timers_crud.get(db, user_id, task_id)
    if not run:
        # Nothing running — return the task unchanged (idempotent stop).
        return task_logic.to_task_out(db, task, user_id)

    try:
        started = datetime.fromisoformat(run.started_at)
    except ValueError:
        started = _now_utc()
    if started.tzinfo is None:
        started = started.replace(tzinfo=timezone.utc)
    ended = _now_utc()
    elapsed = int((ended - started).total_seconds())

    timers_crud.delete(db, user_id, task_id)

    if elapsed >= MIN_PERSIST_SECONDS and task.status != "completed":
        # Wall-clock times in the user's local zone for the timesheet row.
        local_start = started - timedelta(minutes=tz_offset_minutes)
        local_end = ended - timedelta(minutes=tz_offset_minutes)
        work_date = local_start.date().isoformat()
        timelog_crud.add_seconds(db, task_id, work_date, elapsed, user_id)

        time_from = local_start.strftime("%H:%M")
        time_to = local_end.strftime("%H:%M")
        if time_to == time_from:
            time_to = (local_end + timedelta(minutes=1)).strftime("%H:%M")
        try:
            timesheet_logic.create_entry(
                db, user_id,
                TimesheetEntryCreate(
                    workDate=work_date,
                    projectId=task.project_id,
                    sectionId=task.section_id,
                    description=task.title,
                    timeFrom=time_from,
                    timeTo=time_to,
                    billable=True,
                ),
            )
        except Exception:
            pass  # best-effort timesheet row; the task time log is the source of truth

    fresh = tasks_crud.get_by_id(db, task_id)
    return task_logic.to_task_out(db, fresh, user_id)
