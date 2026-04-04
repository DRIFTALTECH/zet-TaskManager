import json
from datetime import date

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

import crud.projects as projects_crud
import crud.sections as sections_crud
import crud.task_assignees as assignees_crud
import crud.tasks as tasks_crud
import crud.timelog as timelog_crud
from database.models import Task
from database.init_db import new_id
from logic.schemas import LogTimeBody, TaskCreate, TaskMoveBody, TaskOut, TaskPatch
from logic import project_logic, user_logic


def _unique_ordered(ids: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for x in ids:
        if x not in seen:
            seen.add(x)
            out.append(x)
    return out


def _is_task_creator(t: Task, user_id: str) -> bool:
    return t.created_by == user_id


def _can_move_task_on_board(db: Session, t: Task, user_id: str) -> bool:
    """Only the task's assignees may move it between columns — no exceptions."""
    return assignees_crud.is_assignee(db, t.id, user_id)


def to_task_out(db: Session, t: Task, viewer_user_id: str) -> TaskOut:
    cf = json.loads(t.custom_fields_json or "{}")
    tags = json.loads(t.tags_json or "[]")
    assignee_ids = assignees_crud.list_user_ids_ordered(db, t.id)
    if not assignee_ids:
        assignee_ids = [t.assigned_to]
    primary = assignee_ids[0] if assignee_ids else t.assigned_to
    return TaskOut(
        id=t.id,
        title=t.title,
        description=t.description,
        projectId=t.project_id,
        sectionId=t.section_id,
        assignedTo=primary,
        assigneeIds=assignee_ids,
        assignedBy=t.assigned_by,
        createdBy=t.created_by,
        dueDate=t.due_date,
        priority=t.priority,
        status=t.status,
        isStarted=t.is_started,
        startedAt=t.started_at,
        completedAt=t.completed_at,
        approvedByManager=t.approved_by_manager,
        timeTracked=t.time_tracked,
        tags=tags if isinstance(tags, list) else [],
        createdAt=t.created_at,
        timeLog=timelog_crud.time_log_map_for_user(db, t.id, viewer_user_id),
        customFields=cf if isinstance(cf, dict) else {},
    )


def list_tasks(db: Session, current_user_id: str) -> list[TaskOut]:
    all_t = tasks_crud.list_all(db)
    visible = []
    for t in all_t:
        mids = projects_crud.member_ids(db, t.project_id)
        if current_user_id in mids:
            visible.append(t)
    return [to_task_out(db, t, current_user_id) for t in visible]


def get_task(db: Session, current_user_id: str, task_id: str) -> TaskOut:
    t = tasks_crud.get_by_id(db, task_id)
    if not t:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Task not found")
    project_logic.ensure_project_member(db, t.project_id, current_user_id)
    return to_task_out(db, t, current_user_id)


def create_task(db: Session, current_user_id: str, body: TaskCreate) -> TaskOut:
    if body.createdBy != current_user_id or body.assignedBy != current_user_id:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "createdBy and assignedBy must match the authenticated user",
        )
    project_logic.ensure_project_member(db, body.projectId, current_user_id)
    sec = sections_crud.get_by_id(db, body.sectionId)
    if not sec or sec.project_id != body.projectId:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid section for project")
    mids = projects_crud.member_ids(db, body.projectId)
    if body.assignedBy not in mids:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "assignedBy must be a project member")
    assignee_ids = _unique_ordered(body.assigneeIds)
    if not assignee_ids:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "At least one assignee is required")
    for uid in assignee_ids:
        if uid not in mids:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Every assignee must be a project member")
    actor = user_logic.get_user_or_404(db, current_user_id)
    if actor.role != "manager" and set(assignee_ids) != {current_user_id}:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Only managers can assign tasks to people other than yourself",
        )
    tid = new_id("t")
    today = date.today().isoformat()
    primary = assignee_ids[0]
    t = tasks_crud.create_task(
        db,
        task_id=tid,
        title=body.title.strip(),
        description=body.description.strip(),
        project_id=body.projectId,
        section_id=body.sectionId,
        assigned_to=primary,
        assigned_by=body.assignedBy,
        created_by=body.createdBy,
        due_date=body.dueDate,
        priority=body.priority,
        status="backlog",
        is_started=False,
        approved_by_manager=False,
        time_tracked=0,
        tags=body.tags,
        created_at=today,
    )
    assignees_crud.set_assignees(db, tid, assignee_ids)
    return to_task_out(db, t, current_user_id)


def patch_task(db: Session, current_user_id: str, task_id: str, body: TaskPatch) -> TaskOut:
    t = tasks_crud.get_by_id(db, task_id)
    if not t:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Task not found")
    project_logic.ensure_project_member(db, t.project_id, current_user_id)
    if t.status == "completed":
        if body.assigneeIds is not None:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "Completed tasks cannot be reassigned",
            )
        if body.status is not None and body.status != "completed":
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "Completed tasks cannot be moved back to an active state",
            )
        if (
            body.title is not None
            or body.description is not None
            or body.priority is not None
            or body.sectionId is not None
            or body.customFields is not None
        ):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "Completed tasks are read-only",
            )
    core_fields = (
        body.title is not None
        or body.description is not None
        or body.priority is not None
        or body.status is not None
        or body.sectionId is not None
        or body.customFields is not None
    )
    if core_fields and not _is_task_creator(t, current_user_id):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Only the task creator can edit title, description, priority, section, status, and custom fields",
        )
    if body.title is not None:
        t.title = body.title
    if body.description is not None:
        t.description = body.description
    if body.priority is not None:
        t.priority = body.priority
    if body.status is not None:
        t.status = body.status
    if body.sectionId is not None:
        sec = sections_crud.get_by_id(db, body.sectionId)
        if not sec or sec.project_id != t.project_id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid section")
        t.section_id = body.sectionId
    if body.assigneeIds is not None:
        mids = projects_crud.member_ids(db, t.project_id)
        assignee_ids = _unique_ordered(body.assigneeIds)
        if not assignee_ids:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "At least one assignee is required")
        for uid in assignee_ids:
            if uid not in mids:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, "Every assignee must be a project member")
        actor = user_logic.get_user_or_404(db, current_user_id)
        if actor.role != "manager":
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "Only managers can change who is assigned",
            )
        assignees_crud.set_assignees(db, t.id, assignee_ids)
        t.assigned_to = assignee_ids[0]
    if body.customFields is not None:
        t.custom_fields_json = json.dumps(body.customFields)
    tasks_crud.update_task(db, t)
    return to_task_out(db, t, current_user_id)


def start_task(db: Session, current_user_id: str, task_id: str) -> TaskOut:
    t = tasks_crud.get_by_id(db, task_id)
    if not t:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Task not found")
    project_logic.ensure_project_member(db, t.project_id, current_user_id)
    if t.status == "completed":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Cannot change a completed task")
    if not (assignees_crud.is_assignee(db, t.id, current_user_id) or _is_task_creator(t, current_user_id)):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Only an assignee or the creator can start this task",
        )
    t.is_started = True
    if not t.started_at:
        t.started_at = date.today().isoformat()
    tasks_crud.update_task(db, t)
    return to_task_out(db, t, current_user_id)


def move_task(db: Session, current_user_id: str, task_id: str, body: TaskMoveBody) -> TaskOut:
    t = tasks_crud.get_by_id(db, task_id)
    if not t:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Task not found")
    project_logic.ensure_project_member(db, t.project_id, current_user_id)
    if t.status == "completed":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Completed tasks cannot be moved on the board")
    if not _can_move_task_on_board(db, t, current_user_id):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Only the task's assignees can move it between columns",
        )
    t.status = body.status
    # Moving to Done ends any active work session
    if body.status == "done":
        t.is_started = False
        t.started_at = None
    tasks_crud.update_task(db, t)
    return to_task_out(db, t, current_user_id)


def _can_reopen_completed_task(db: Session, t: Task, user_id: str) -> bool:
    if _is_task_creator(t, user_id):
        return True
    if assignees_crud.is_assignee(db, t.id, user_id):
        return True
    actor = user_logic.get_user_or_404(db, user_id)
    return actor.role == "manager"


def reopen_completed_to_backlog(db: Session, current_user_id: str, task_id: str) -> TaskOut:
    t = tasks_crud.get_by_id(db, task_id)
    if not t:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Task not found")
    project_logic.ensure_project_member(db, t.project_id, current_user_id)
    if t.status != "completed":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Only completed tasks can be moved back to the backlog")
    if not _can_reopen_completed_task(db, t, current_user_id):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Only the creator, an assignee, or a manager can reopen a completed task",
        )
    t.status = "backlog"
    t.completed_at = None
    t.approved_by_manager = False
    t.is_started = False
    t.started_at = None
    tasks_crud.update_task(db, t)
    return to_task_out(db, t, current_user_id)


def approve_task(db: Session, current_user_id: str, task_id: str) -> TaskOut:
    project_logic.ensure_manager(db, current_user_id)
    t = tasks_crud.get_by_id(db, task_id)
    if not t:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Task not found")
    project_logic.ensure_project_member(db, t.project_id, current_user_id)
    if t.status == "completed":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Task is already completed")
    t.status = "completed"
    t.approved_by_manager = True
    t.completed_at = date.today().isoformat()
    tasks_crud.update_task(db, t)
    return to_task_out(db, t, current_user_id)


def log_time(db: Session, current_user_id: str, task_id: str, body: LogTimeBody) -> TaskOut:
    t = tasks_crud.get_by_id(db, task_id)
    if not t:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Task not found")
    if t.status == "completed":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Cannot log time on a completed task")
    if not assignees_crud.is_assignee(db, task_id, current_user_id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only assigned team members can log time on this task")
    if body.seconds <= 0:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "seconds must be positive")
    timelog_crud.add_seconds(db, task_id, body.date, body.seconds, current_user_id)
    t2 = tasks_crud.get_by_id(db, task_id)
    return to_task_out(db, t2, current_user_id)


def delete_task(db: Session, current_user_id: str, task_id: str) -> None:
    t = tasks_crud.get_by_id(db, task_id)
    if not t:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Task not found")
    project_logic.ensure_project_member(db, t.project_id, current_user_id)
    if t.created_by != current_user_id:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Only the user who created this task can delete it",
        )
    tasks_crud.delete_task(db, task_id)
