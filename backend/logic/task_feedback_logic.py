from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

import crud.task_assignees as assignees_crud
import crud.task_feedback as feedback_crud
import crud.tasks as tasks_crud
import crud.users as users_crud
from database.init_db import new_id
from database.models import TaskFeedback
from logic import project_logic
from logic.schemas import TaskFeedbackCreate, TaskFeedbackOut, TaskFeedbackPatch


def _ensure_task_member(db: Session, task_id: str, user_id: str):
    t = tasks_crud.get_by_id(db, task_id)
    if not t:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Task not found")
    project_logic.ensure_project_member(db, t.project_id, user_id)
    return t


def to_out(db: Session, row: TaskFeedback) -> TaskFeedbackOut:
    author = users_crud.get_by_id(db, row.user_id)
    return TaskFeedbackOut(
        id=row.id,
        taskId=row.task_id,
        userId=row.user_id,
        authorName=author.name if author else "",
        message=row.message,
        createdAt=row.created_at,
        updatedAt=row.updated_at,
    )


def list_feedback(db: Session, viewer_id: str, task_id: str) -> list[TaskFeedbackOut]:
    _ensure_task_member(db, task_id, viewer_id)
    rows = feedback_crud.list_for_task(db, task_id)
    return [to_out(db, r) for r in rows]


def create_feedback(db: Session, user_id: str, task_id: str, body: TaskFeedbackCreate) -> TaskFeedbackOut:
    _ensure_task_member(db, task_id, user_id)
    msg = body.message.strip()
    if not msg:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Message is required")
    now = datetime.now(timezone.utc).isoformat()
    row = TaskFeedback(
        id=new_id("fb"),
        task_id=task_id,
        user_id=user_id,
        message=msg,
        created_at=now,
        updated_at=now,
    )
    feedback_crud.create_row(db, row)
    return to_out(db, row)


def create_feedback_action(db: Session, user_id: str, task_id: str, body: TaskFeedbackCreate) -> TaskFeedbackOut:
    """Create feedback + audit + notify creator/assignees/mentions + commit."""
    from logic import notification_logic
    from logic.audit import log_audit

    result = create_feedback(db, user_id, task_id, body)
    task = tasks_crud.get_by_id(db, task_id)
    title = task.title if task else "a task"
    actor = users_crud.get_by_id(db, user_id)
    actor_name = actor.name if actor else "Someone"

    log_audit(db, user_id, "task.comment_added", "task", task_id, task.title if task else "", {})

    assignee_ids = assignees_crud.list_user_ids_ordered(db, task_id)
    creator_id = task.created_by if task else ""
    notification_logic.notify_users(
        db, user_ids=list(set(assignee_ids) | {creator_id}),
        type="task_commented", title="New comment",
        message=f'{actor_name} commented on "{title}"',
        entity_type="task", entity_id=task_id, triggered_by=user_id,
    )
    notification_logic.notify_users(
        db, user_ids=body.mentionedUserIds,
        type="task_mentioned", title="You were mentioned",
        message=f'{actor_name} mentioned you in "{title}"',
        entity_type="task", entity_id=task_id, triggered_by=user_id,
    )
    db.commit()
    return result


def patch_feedback(db: Session, user_id: str, task_id: str, feedback_id: str, body: TaskFeedbackPatch) -> TaskFeedbackOut:
    _ensure_task_member(db, task_id, user_id)
    row = feedback_crud.get_by_id(db, feedback_id)
    if not row or row.task_id != task_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Feedback not found")
    if row.user_id != user_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You can only edit your own feedback")
    if body.message is not None:
        m = body.message.strip()
        if not m:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Message is required")
        row.message = m
    row.updated_at = datetime.now(timezone.utc).isoformat()
    feedback_crud.update_row(db, row)
    return to_out(db, row)


def delete_feedback(db: Session, user_id: str, task_id: str, feedback_id: str) -> None:
    _ensure_task_member(db, task_id, user_id)
    row = feedback_crud.get_by_id(db, feedback_id)
    if not row or row.task_id != task_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Feedback not found")
    if row.user_id != user_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You can only delete your own feedback")
    feedback_crud.delete_row(db, row)
