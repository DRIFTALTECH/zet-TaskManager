from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from database.database import get_db
from database.models import Task, User
from logic import task_feedback_logic, task_logic, notification_logic
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
import crud.task_assignees as assignees_crud
import realtime

router = APIRouter()


@router.get("", response_model=list[TaskOut])
def list_tasks(user_id: str = Depends(get_current_user_id), db: Session = Depends(get_db)):
    return task_logic.list_tasks(db, user_id)


@router.get("/version")
def tasks_version(user_id: str = Depends(get_current_user_id)):
    """Tiny endpoint for smart polling: returns the current change version.

    Clients poll this and only refetch the task list when the number changes.
    Kept for backward-compatibility; prefer GET /sync/version for all channels.
    """
    return {"version": realtime.current("tasks")}


@router.post("", response_model=TaskOut)
def create_task(
    body: TaskCreate,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    result = task_logic.create_task(db, user_id, body)
    log_audit(db, user_id, "task.created", "task", result.id, result.title,
              {"projectId": result.projectId, "priority": result.priority})
    # Notify all assignees (except the creator)
    actor = db.get(User, user_id)
    actor_name = actor.name if actor else "Someone"
    notification_logic.notify_users(
        db,
        user_ids=result.assigneeIds,
        type="task_assigned",
        title="New task assigned",
        message=f'{actor_name} assigned you to "{result.title}"',
        entity_type="task",
        entity_id=result.id,
        triggered_by=user_id,
    )
    db.commit()
    return result


@router.patch("/{task_id}", response_model=TaskOut)
def patch_task(
    task_id: str,
    body: TaskPatch,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    # Capture old assignees before patch for diff
    old_assignee_ids = set(assignees_crud.list_user_ids_ordered(db, task_id))
    result = task_logic.patch_task(db, user_id, task_id, body)
    details: dict = {}
    if body.status is not None:
        details["status"] = body.status
    if body.priority is not None:
        details["priority"] = body.priority
    log_audit(db, user_id, "task.updated", "task", task_id, result.title, details)

    actor = db.get(User, user_id)
    actor_name = actor.name if actor else "Someone"

    # Notify newly added assignees
    if body.assigneeIds is not None:
        new_assignees = set(result.assigneeIds) - old_assignee_ids
        notification_logic.notify_users(
            db,
            user_ids=list(new_assignees),
            type="task_assigned",
            title="New task assigned",
            message=f'{actor_name} assigned you to "{result.title}"',
            entity_type="task",
            entity_id=task_id,
            triggered_by=user_id,
        )

    # Notify creator + all assignees when status changes
    if body.status is not None:
        recipients = list(set(result.assigneeIds) | {result.createdBy})
        notification_logic.notify_users(
            db,
            user_ids=recipients,
            type="task_status_changed",
            title="Task status updated",
            message=f'{actor_name} moved "{result.title}" to {body.status}',
            entity_type="task",
            entity_id=task_id,
            triggered_by=user_id,
        )

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
    actor = db.get(User, user_id)
    actor_name = actor.name if actor else "Someone"
    recipients = list(set(result.assigneeIds) | {result.createdBy})
    notification_logic.notify_users(
        db,
        user_ids=recipients,
        type="task_status_changed",
        title="Task status updated",
        message=f'{actor_name} moved "{result.title}" to {body.status}',
        entity_type="task",
        entity_id=task_id,
        triggered_by=user_id,
    )
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
    actor = db.get(User, user_id)
    actor_name = actor.name if actor else "Manager"
    recipients = list(set(result.assigneeIds) | {result.createdBy})
    notification_logic.notify_users(
        db,
        user_ids=recipients,
        type="task_approved",
        title="Task approved",
        message=f'{actor_name} approved "{result.title}"',
        entity_type="task",
        entity_id=task_id,
        triggered_by=user_id,
    )
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
    task_obj = db.get(Task, task_id)
    log_audit(db, user_id, "task.comment_added", "task", task_id,
              task_obj.title if task_obj else "", {})
    actor = db.get(User, user_id)
    actor_name = actor.name if actor else "Someone"
    task_title = task_obj.title if task_obj else "a task"

    # Notify creator + assignees about the comment
    assignee_ids = assignees_crud.list_user_ids_ordered(db, task_id)
    creator_id = task_obj.created_by if task_obj else ""
    comment_recipients = list(set(assignee_ids) | {creator_id})
    notification_logic.notify_users(
        db,
        user_ids=comment_recipients,
        type="task_commented",
        title="New comment",
        message=f'{actor_name} commented on "{task_title}"',
        entity_type="task",
        entity_id=task_id,
        triggered_by=user_id,
    )

    # Notify mentioned users
    notification_logic.notify_users(
        db,
        user_ids=body.mentionedUserIds,
        type="task_mentioned",
        title="You were mentioned",
        message=f'{actor_name} mentioned you in "{task_title}"',
        entity_type="task",
        entity_id=task_id,
        triggered_by=user_id,
    )

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
