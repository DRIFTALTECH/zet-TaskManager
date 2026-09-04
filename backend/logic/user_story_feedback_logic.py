from datetime import datetime, timezone

from fastapi import HTTPException, status
from database.database import Db

import crud.user_stories as stories_crud
import crud.user_story_assignees as story_assignees_crud
import crud.user_story_feedback as feedback_crud
import crud.users as users_crud
from database.init_db import new_id
from database.models import UserStoryFeedback
from logic import project_logic
from logic.schemas import (
    UserStoryFeedbackCreate,
    UserStoryFeedbackOut,
    UserStoryFeedbackPatch,
)


def _ensure_story_member(db: Db, story_id: str, user_id: str):
    s = stories_crud.get_by_id(db, story_id)
    if not s:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User story not found")
    project_logic.ensure_project_member(db, s.project_id, user_id)
    return s


def to_out(db: Db, row: UserStoryFeedback) -> UserStoryFeedbackOut:
    author = users_crud.get_by_id(db, row.user_id)
    return UserStoryFeedbackOut(
        id=row.id,
        userStoryId=row.user_story_id,
        userId=row.user_id,
        authorName=author.name if author else "",
        message=row.message,
        createdAt=row.created_at,
        updatedAt=row.updated_at,
    )


def list_feedback(db: Db, viewer_id: str, story_id: str) -> list[UserStoryFeedbackOut]:
    _ensure_story_member(db, story_id, viewer_id)
    rows = feedback_crud.list_for_story(db, story_id)
    return [to_out(db, r) for r in rows]


def create_feedback(
    db: Db, user_id: str, story_id: str, body: UserStoryFeedbackCreate
) -> UserStoryFeedbackOut:
    _ensure_story_member(db, story_id, user_id)
    msg = body.message.strip()
    if not msg:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Message is required")
    now = datetime.now(timezone.utc).isoformat()
    row = UserStoryFeedback(
        id=new_id("sfb"),
        user_story_id=story_id,
        user_id=user_id,
        message=msg,
        created_at=now,
        updated_at=now,
    )
    feedback_crud.create_row(db, row)
    return to_out(db, row)


def create_feedback_action(
    db: Db, user_id: str, story_id: str, body: UserStoryFeedbackCreate
) -> UserStoryFeedbackOut:
    """Create comment + audit + notify reporter/assignees/mentions + commit."""
    from logic import notification_logic
    from logic.audit import log_audit

    result = create_feedback(db, user_id, story_id, body)
    story = stories_crud.get_by_id(db, story_id)
    title = story.title if story else "a user story"
    actor = users_crud.get_by_id(db, user_id)
    actor_name = actor.name if actor else "Someone"

    log_audit(db, user_id, "user_story.comment_added", "user_story", story_id, title, {})

    assignee_ids = story_assignees_crud.list_user_ids_ordered(db, story_id)
    reporter_id = story.reporter_id if story else ""
    notification_logic.notify_users(
        db, user_ids=list(set(assignee_ids) | {reporter_id}),
        type="user_story_commented", title="New comment",
        message=f'{actor_name} commented on "{title}"',
        entity_type="user_story", entity_id=story_id, triggered_by=user_id,
    )
    notification_logic.notify_users(
        db, user_ids=body.mentionedUserIds,
        type="user_story_mentioned", title="You were mentioned",
        message=f'{actor_name} mentioned you in "{title}"',
        entity_type="user_story", entity_id=story_id, triggered_by=user_id,
    )
    db.commit()
    return result


def patch_feedback(
    db: Db, user_id: str, story_id: str, feedback_id: str, body: UserStoryFeedbackPatch
) -> UserStoryFeedbackOut:
    _ensure_story_member(db, story_id, user_id)
    row = feedback_crud.get_by_id(db, feedback_id)
    if not row or row.user_story_id != story_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Comment not found")
    if row.user_id != user_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You can only edit your own comments")
    m = body.message.strip()
    if not m:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Message is required")
    row.message = m
    row.updated_at = datetime.now(timezone.utc).isoformat()
    feedback_crud.update_row(db, row)
    db.commit()
    return to_out(db, row)


def delete_feedback(db: Db, user_id: str, story_id: str, feedback_id: str) -> None:
    _ensure_story_member(db, story_id, user_id)
    row = feedback_crud.get_by_id(db, feedback_id)
    if not row or row.user_story_id != story_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Comment not found")
    if row.user_id != user_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You can only delete your own comments")
    feedback_crud.delete_row(db, row)
    db.commit()
