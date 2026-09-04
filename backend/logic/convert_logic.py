"""Turning a task into a story and back.

The two are close cousins — a title, a status, a priority, dates, people — so a
conversion carries everything both sides understand and re-homes the children
that would otherwise be orphaned. What each side cannot hold is named in the
error rather than silently dropped:

* a task's tracked time and timesheet rows belong to the task id, so converting
  a task that has logged time would strand them; that conversion is refused.
* a story with sub-stories has nowhere to put them under a task, so that one is
  refused too — detach or convert the children first.
"""
from datetime import datetime, timezone

from fastapi import HTTPException, status

import crud.task_assignees as assignees_crud
import crud.tasks as tasks_crud
import crud.timelog as timelog_crud
import crud.user_stories as stories_crud
import crud.user_story_assignees as story_assignees_crud
from database.database import Db
from database.init_db import new_id
from logic import project_logic, task_logic, user_story_logic
from logic.audit import log_audit
from logic.schemas import TaskOut, UserStoryOut


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def task_to_story(db: Db, user_id: str, task_id: str) -> UserStoryOut:
    """Promote a task to a story. Its subtasks become the story's tasks."""
    t = tasks_crud.get_by_id(db, task_id)
    if not t:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Task not found")
    project_logic.ensure_project_member(db, t.project_id, user_id)

    if timelog_crud.sum_seconds_for_task(db, task_id) > 0:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "This task has tracked time. Clear it first — a story cannot hold time logs.",
        )

    now = _now()
    story_id = new_id("us")
    assignee_ids = assignees_crud.list_user_ids_ordered(db, task_id)
    s = stories_crud.create(
        db,
        story_id=story_id,
        project_id=t.project_id,
        section_id=t.section_id,
        title=t.title,
        description=t.description or "",
        acceptance_criteria="",
        priority=t.priority or "Medium",
        status=t.status or "backlog",
        assignee_id=assignee_ids[0] if assignee_ids else None,
        reporter_id=t.created_by or user_id,
        estimated_hours=getattr(t, "estimated_hours", None),
        story_points=None,
        start_date=getattr(t, "started_at", None),
        due_date=t.due_date,
        created_at=now,
        updated_at=now,
        sprint=getattr(t, "sprint", "") or "",
        tags_json=getattr(t, "tags_json", None) or "[]",
        approved_by_manager=False,
    )
    if assignee_ids:
        story_assignees_crud.set_assignees(db, story_id, assignee_ids)
        s.assignee_id = assignee_ids[0]
        stories_crud.update(db, s)

    # Subtasks become the story's tasks; they keep their own status and people.
    for child in tasks_crud.list_children(db, task_id):
        child.parent_task_id = None
        child.user_story_id = story_id
        tasks_crud.update_task(db, child)

    log_audit(db, user_id, "task.converted_to_story", "task", task_id, t.title, {"storyId": story_id})
    tasks_crud.delete_task(db, task_id)
    db.commit()
    return user_story_logic.get_story(db, user_id, story_id)


def story_to_task(db: Db, user_id: str, story_id: str) -> TaskOut:
    """Demote a story to a task. Its tasks become that task's subtasks."""
    s = stories_crud.get_by_id(db, story_id)
    if not s:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User story not found")
    project_logic.ensure_project_member(db, s.project_id, user_id)

    if stories_crud.list_children(db, story_id):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "This story has sub-stories. Move them out first — a task cannot hold stories.",
        )
    section_id = getattr(s, "section_id", None)
    if not section_id:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Give the story a section first — every task belongs to one.",
        )

    now = _now()
    task_id = new_id("t")
    assignee_ids = story_assignees_crud.list_user_ids_ordered(db, story_id)
    owner = assignee_ids[0] if assignee_ids else (s.reporter_id or user_id)
    tasks_crud.create_task(
        db,
        task_id=task_id,
        title=s.title,
        description=s.description or "",
        project_id=s.project_id,
        section_id=section_id,
        assigned_to=owner,
        assigned_by=user_id,
        created_by=s.reporter_id or user_id,
        due_date=s.due_date or "",
        priority=s.priority or "Medium",
        status=s.status or "backlog",
        is_started=False,
        approved_by_manager=False,
        time_tracked=0,
        tags=[],
        created_at=now,
        sprint=getattr(s, "sprint", "") or "",
        estimated_hours=None,
    )
    if assignee_ids:
        assignees_crud.set_assignees(db, task_id, assignee_ids)

    # The story's tasks become subtasks. Anything already a subtask is lifted to
    # the same level — a task holds one level of children, not two.
    for child in tasks_crud.list_for_user_story(db, story_id):
        if child.id == task_id:
            continue
        child.user_story_id = None
        child.parent_task_id = task_id
        tasks_crud.update_task(db, child)

    log_audit(db, user_id, "user_story.converted_to_task", "user_story", story_id, s.title, {"taskId": task_id})
    stories_crud.delete(db, story_id)
    db.commit()
    return task_logic.get_task(db, user_id, task_id)
