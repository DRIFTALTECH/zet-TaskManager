import json
from datetime import date, datetime, timezone

from fastapi import HTTPException, status
from database.database import Db

import crud.projects as projects_crud
import crud.sections as sections_crud
import crud.task_assignees as assignees_crud
import crud.tasks as tasks_crud
import crud.timelog as timelog_crud
import crud.users as users_crud
from database.models import Task
from database.init_db import new_id
from logic.schemas import ApproveTaskBody, LogTimeBody, TaskCreate, TaskMoveBody, TaskOut, TaskPatch
from logic import project_logic, user_logic, notification_logic
from logic.audit import log_audit


def _actor_name(db: Db, user_id: str, default: str = "Someone") -> str:
    u = users_crud.get_by_id(db, user_id)
    return u.name if u else default


def _commit(db: Db) -> None:
    db.commit()


_PRIORITIES = frozenset({"Low", "Medium", "High", "Urgent"})
_PRIORITY_ALIASES = {"low": "Low", "medium": "Medium", "high": "High", "urgent": "Urgent"}


def _normalize_priority(value: str | None) -> str:
    s = (value or "Medium").strip()
    if s in _PRIORITIES:
        return s
    return _PRIORITY_ALIASES.get(s.lower(), "Medium")


def _unique_ordered(ids: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for i in ids:
        if i and i not in seen:
            seen.add(i)
            out.append(i)
    return out


def _parse_estimated_hours(raw: str | None) -> float | None:
    if raw is None or str(raw).strip() == "":
        return None
    try:
        v = float(str(raw).strip())
    except (TypeError, ValueError):
        return None
    if v <= 0:
        return None
    return round(v, 2)


def _fmt_estimated_hours(value: float | None) -> str | None:
    if value is None:
        return None
    if value < 0 or value > 10_000:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "estimatedHours must be 0–10000")
    if value <= 0:
        return None
    return str(round(float(value), 2))


def _is_task_creator(t: Task, user_id: str) -> bool:
    return t.created_by == user_id


def _can_delete_task(db: Db, t: Task, user_id: str) -> bool:
    return _is_task_creator(t, user_id) or project_logic.is_admin(db, user_id)


def _can_move_task_on_board(db: Db, t: Task, user_id: str) -> bool:
    """Only the task's assignees may move it between columns — no exceptions."""
    if assignees_crud.is_assignee(db, t.id, user_id):
        return True
    # Fallback: tasks created before multi-assignee support store only assigned_to
    assignee_ids = assignees_crud.list_user_ids_ordered(db, t.id)
    if not assignee_ids:
        return t.assigned_to == user_id
    return False


def _build_task_out(t: Task, assignee_ids: list[str], time_log: dict[str, int]) -> TaskOut:
    """Assemble a TaskOut from a task row plus already-loaded assignees / time log.

    No DB access — callers pass precomputed values so list endpoints can batch.
    Lean list rows omit description / tags / custom fields; treat missing as empty.
    """
    cf = json.loads(getattr(t, "custom_fields_json", None) or "{}")
    tags = json.loads(getattr(t, "tags_json", None) or "[]")
    if not assignee_ids:
        # Empty task_assignees = unassigned when assigned_to is only the creator
        # placeholder (create / CSV import). Legacy rows without a junction still
        # fall back to denormalized assigned_to when it differs from created_by.
        if getattr(t, "user_story_id", None) or (
            t.assigned_to and t.assigned_to == t.created_by
        ):
            assignee_ids = []
        elif t.assigned_to:
            assignee_ids = [t.assigned_to]
        else:
            assignee_ids = []
    primary = assignee_ids[0] if assignee_ids else (t.assigned_to or t.created_by)
    return TaskOut(
        id=t.id,
        title=t.title,
        description=getattr(t, "description", None) or "",
        projectId=t.project_id,
        sectionId=t.section_id,
        assignedTo=primary,
        assigneeIds=assignee_ids,
        assignedBy=t.assigned_by,
        createdBy=t.created_by,
        dueDate=t.due_date,
        sprint=getattr(t, "sprint", "") or "",
        priority=_normalize_priority(t.priority),
        status=t.status,
        isStarted=t.is_started,
        startedAt=t.started_at,
        completedAt=t.completed_at,
        approvedByManager=t.approved_by_manager,
        timeTracked=t.time_tracked,
        minLogMinutes=max(0, int(getattr(t, "min_log_minutes", 1) or 1)),
        estimatedHours=_parse_estimated_hours(getattr(t, "estimated_hours", None)),
        tags=tags if isinstance(tags, list) else [],
        createdAt=t.created_at,
        timeLog=time_log,
        customFields=cf if isinstance(cf, dict) else {},
        userStoryId=getattr(t, "user_story_id", None) or None,
        parentTaskId=getattr(t, "parent_task_id", None) or None,
    )


def to_task_out(db: Db, t: Task, viewer_user_id: str) -> TaskOut:
    cf = json.loads(t.custom_fields_json or "{}")
    tags = json.loads(t.tags_json or "[]")
    assignee_ids = assignees_crud.list_user_ids_ordered(db, t.id)
    if not assignee_ids:
        if getattr(t, "user_story_id", None) or (
            t.assigned_to and t.assigned_to == t.created_by
        ):
            assignee_ids = []
        elif t.assigned_to:
            assignee_ids = [t.assigned_to]
        else:
            assignee_ids = []
    primary = assignee_ids[0] if assignee_ids else (t.assigned_to or t.created_by)
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
        sprint=getattr(t, "sprint", "") or "",
        priority=_normalize_priority(t.priority),
        status=t.status,
        isStarted=t.is_started,
        startedAt=t.started_at,
        completedAt=t.completed_at,
        approvedByManager=t.approved_by_manager,
        timeTracked=t.time_tracked,
        minLogMinutes=max(0, int(getattr(t, "min_log_minutes", 1) or 1)),
        estimatedHours=_parse_estimated_hours(getattr(t, "estimated_hours", None)),
        tags=tags if isinstance(tags, list) else [],
        createdAt=t.created_at,
        timeLog=timelog_crud.time_log_map_for_user(db, t.id, viewer_user_id),
        customFields=cf if isinstance(cf, dict) else {},
        userStoryId=getattr(t, "user_story_id", None) or None,
        parentTaskId=getattr(t, "parent_task_id", None) or None,
    )


def list_tasks(db: Db, current_user_id: str) -> list[TaskOut]:
    # Lean board payload: title + status, no description / timeLog blobs.
    # Open a task → GET /tasks/{id} for the full body.
    actor = user_logic.get_user_or_404(db, current_user_id)
    visible = (
        tasks_crud.list_all_lean(db)
        if actor.role == "superadmin"
        else tasks_crud.list_for_member_projects_lean(db, current_user_id)
    )
    ids = [t.id for t in visible]
    assignee_map = assignees_crud.map_user_ids_for_tasks(db, ids)
    return [_build_task_out(t, assignee_map.get(t.id, []), {}) for t in visible]


def get_task(db: Db, current_user_id: str, task_id: str) -> TaskOut:
    t = tasks_crud.get_by_id(db, task_id)
    if not t:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Task not found")
    project_logic.ensure_project_member(db, t.project_id, current_user_id)
    return to_task_out(db, t, current_user_id)


def create_task(db: Db, current_user_id: str, body: TaskCreate) -> TaskOut:
    if body.createdBy != current_user_id or body.assignedBy != current_user_id:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "createdBy and assignedBy must match the authenticated user",
        )
    project_logic.ensure_project_member(db, body.projectId, current_user_id)
    sec = sections_crud.get_by_id(db, body.sectionId)
    if not sec or sec.project_id != body.projectId:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid section for project")
    assignee_ids = _unique_ordered(body.assigneeIds)
    mids = projects_crud.member_ids(db, body.projectId)
    if body.assignedBy not in mids:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "assignedBy must be a project member")
    for uid in assignee_ids:
        if uid not in mids:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Every assignee must be a project member")
    # Empty assigneeIds = unassigned in the API; assigned_to is NOT NULL so we store
    # the creator as a placeholder (same pattern as AI story task generation).
    primary = assignee_ids[0] if assignee_ids else current_user_id
    user_story_id = (body.userStoryId or "").strip() or None
    parent_task_id = (body.parentTaskId or "").strip() or None
    if parent_task_id:
        parent = tasks_crud.get_by_id(db, parent_task_id)
        if not parent or parent.project_id != body.projectId:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid parentTaskId")
        if getattr(parent, "parent_task_id", None):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Subtasks cannot nest more than one level")
        if not user_story_id:
            user_story_id = getattr(parent, "user_story_id", None) or None
    if user_story_id:
        from crud import user_stories as stories_crud

        story = stories_crud.get_by_id(db, user_story_id)
        if not story or story.project_id != body.projectId:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid userStoryId for project")
    tid = new_id("t")
    today = date.today().isoformat()
    created_at = datetime.now(timezone.utc).isoformat()
    due = (body.dueDate or "").strip() or today
    min_log = 1
    if body.minLogMinutes is not None:
        project_logic.ensure_manager(db, current_user_id)
        if body.minLogMinutes < 0 or body.minLogMinutes > 180:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "minLogMinutes must be 0–180")
        min_log = int(body.minLogMinutes)
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
        due_date=due,
        sprint=(body.sprint or "").strip(),
        priority=body.priority,
        status=_status_for_new_task(db, body),
        is_started=False,
        approved_by_manager=False,
        time_tracked=0,
        tags=body.tags,
        created_at=created_at,
        min_log_minutes=min_log,
        estimated_hours=_fmt_estimated_hours(body.estimatedHours),
        user_story_id=user_story_id,
        parent_task_id=parent_task_id,
    )
    assignees_crud.set_assignees(db, tid, assignee_ids)
    return to_task_out(db, t, current_user_id)


def _status_for_new_task(db: Db, body: TaskCreate) -> str:
    """What column a new task starts in.

    An explicit status wins. Otherwise it starts wherever its container already
    is: a subtask added to a task that is In Progress belongs beside its siblings
    there, not alone in Backlog — which is what made freshly created work look
    like it had been moved out.
    """
    asked = (body.status or "").strip()[:80]
    if asked:
        return asked
    parent_id = (body.parentTaskId or "").strip()
    if parent_id:
        parent = tasks_crud.get_by_id(db, parent_id)
        if parent and (parent.status or "").strip():
            return parent.status
    story_id = (body.userStoryId or "").strip()
    if story_id:
        from crud import user_stories as stories_crud

        story = stories_crud.get_by_id(db, story_id)
        if story and (story.status or "").strip():
            return story.status
    return "backlog"


def _date_or_none(value: str | None) -> str | None:
    s = (value or "").strip()[:10]
    return s or None


def _set_actual_hours(db: Db, task_id: str, user_id: str, hours: float | None) -> None:
    """Replace tracked time with the hours entered at Done / Approve. None = leave as-is.

    The same figure is mirrored onto the user's timesheet: the hours someone gives
    when closing a task are the hours they worked, and re-typing them by hand on
    the Timesheet page is how the two drift apart.
    """
    if hours is None:
        return
    if hours < 0 or hours > 10_000:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "actualHours must be 0–10000")
    seconds = int(round(hours * 3600))
    work_date = date.today().isoformat()
    timelog_crud.replace_task_seconds(db, task_id, user_id, work_date, seconds)

    from logic import timesheet_logic

    task = tasks_crud.get_by_id(db, task_id)
    if task:
        timesheet_logic.record_task_time(db, user_id, task, seconds, work_date)


_FINISHED = frozenset({"done", "completed"})


def prepare_status_change(db: Db, t: Task, status: str, *, approve: bool = False) -> None:
    """Put everything a status change implies onto `t`, without writing it.

    The one place that decides what "this task moved column" means. It used to
    be decided in four: `move_task` cleared the started flag, `patch_task`
    assigned the status and nothing else, `approve_task` stamped its own fields,
    and the cascade did the full job — so a task and its own subtasks came out
    of a single move in different states, one with a finish date and no timer
    and the other with a running timer and no date.

    Reaching Done is not approval. The board deliberately keeps finished but
    unapproved work on screen so a manager can approve it there, so `approve`
    stays off for anything a drag can reach; only an explicit Approve passes it.

    Callers that are mid-edit keep their own changes: this mutates `t` in place
    and leaves the write to them.
    """
    was_finished = (t.status or "").strip().lower() in _FINISHED
    finishing = (status or "").strip().lower() in _FINISHED

    if finishing and not was_finished:
        # Before the status is written: `stop` throws away the elapsed time of a
        # task it finds already completed, so stopping afterwards loses the work.
        # Imported here because timer_logic imports this module.
        from logic import timer_logic
        timer_logic.stop_all_for_task(db, t.id)
        # Logging that time rewrote time_tracked on the row. Without picking the
        # new total back up, the caller's write would put the old one back and
        # the time just logged would vanish.
        fresh = tasks_crud.get_by_id(db, t.id)
        if fresh is not None:
            t.time_tracked = fresh.time_tracked

    t.status = status
    if finishing:
        if not was_finished:
            t.completed_at = date.today().isoformat()
        if approve:
            t.approved_by_manager = True
        t.is_started = False
        t.started_at = None
    elif was_finished:
        # Out of Done: a completion date left behind still reads as finished
        # everywhere it is shown, and an approval left behind hides the card.
        t.completed_at = None
        t.approved_by_manager = False
        t.is_started = False
        t.started_at = None


def apply_status_to_task(db: Db, t: Task, status: str, *, approve: bool = False) -> None:
    """`prepare_status_change`, written straight away. For callers not mid-edit."""
    prepare_status_change(db, t, status, approve=approve)
    tasks_crud.update_task(db, t)


def _cascade_status_to_children(db: Db, task: Task, status: str) -> None:
    """Move everything under a task to the status the task just took.

    A card and the pieces it is made of are one block, and dragging the card
    moves the block whole — whatever column each piece happened to be sitting
    in. A subtask that was already finished comes back open with its parent,
    because leaving it behind in Done splits one job across two columns, which
    is the thing dragging the parent was meant to avoid.
    """
    for child in tasks_crud.list_children(db, task.id):
        if (child.status or "") != status:
            apply_status_to_task(db, child, status)
        _cascade_status_to_children(db, child, status)


def _refresh_task(db: Db, task_id: str) -> Task:
    t = tasks_crud.get_by_id(db, task_id)
    if not t:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Task not found")
    return t


def patch_task(db: Db, current_user_id: str, task_id: str, body: TaskPatch) -> TaskOut:
    t = tasks_crud.get_by_id(db, task_id)
    if not t:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Task not found")
    project_logic.ensure_project_member(db, t.project_id, current_user_id)
    if "actualHours" in body.model_fields_set:
        _set_actual_hours(db, task_id, current_user_id, body.actualHours if body.actualHours is not None else 0)
        t = _refresh_task(db, task_id)
    if body.minLogMinutes is not None:
        project_logic.ensure_manager(db, current_user_id)
        if body.minLogMinutes < 0 or body.minLogMinutes > 180:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "minLogMinutes must be 0–180")
        t.min_log_minutes = int(body.minLogMinutes)
    if "estimatedHours" in body.model_fields_set:
        t.estimated_hours = _fmt_estimated_hours(body.estimatedHours)
    if body.title is not None:
        t.title = body.title
    if body.description is not None:
        t.description = body.description
    if body.priority is not None:
        t.priority = body.priority
    if body.status is not None:
        prepare_status_change(db, t, body.status)
    if body.projectId is not None:
        new_pid = (body.projectId or "").strip()
        dest = projects_crud.get_by_id(db, new_pid) if new_pid else None
        if not dest:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid projectId")
        project_logic.ensure_project_member(db, new_pid, current_user_id)
        t.project_id = new_pid
        if getattr(t, "parent_task_id", None):
            parent = tasks_crud.get_by_id(db, t.parent_task_id)
            if not parent or parent.project_id != new_pid:
                t.parent_task_id = None
    if body.sectionId is not None:
        sec = sections_crud.get_by_id(db, body.sectionId)
        if not sec or sec.project_id != t.project_id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid section")
        t.section_id = body.sectionId
    elif body.projectId is not None:
        sec = sections_crud.get_by_id(db, t.section_id)
        if not sec or sec.project_id != t.project_id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Pick a section in the new project")
    if body.assigneeIds is not None:
        mids = projects_crud.member_ids(db, t.project_id)
        assignee_ids = _unique_ordered(body.assigneeIds)
        if not assignee_ids:
            # Unassigned: clear junction rows; keep assigned_to as creator placeholder.
            assignees_crud.set_assignees(db, t.id, [])
            t.assigned_to = t.created_by
        else:
            for uid in assignee_ids:
                if uid not in mids:
                    raise HTTPException(status.HTTP_400_BAD_REQUEST, "Every assignee must be a project member")
            assignees_crud.set_assignees(db, t.id, assignee_ids)
            t.assigned_to = assignee_ids[0]
    if body.customFields is not None:
        t.custom_fields_json = json.dumps(body.customFields)
    if body.dueDate is not None:
        t.due_date = (body.dueDate or "").strip()
    if body.sprint is not None:
        t.sprint = (body.sprint or "").strip()[:120]
    if body.tags is not None:
        cleaned = [x.strip() for x in body.tags if (x or "").strip()]
        t.tags_json = json.dumps(cleaned[:40])
    if body.startedAt is not None:
        t.started_at = _date_or_none(body.startedAt)
        t.is_started = bool(t.started_at)
    if body.completedAt is not None:
        t.completed_at = _date_or_none(body.completedAt)
    if body.userStoryId is not None:
        usid = (body.userStoryId or "").strip() or None
        if usid:
            from crud import user_stories as stories_crud

            story = stories_crud.get_by_id(db, usid)
            if not story or story.project_id != t.project_id:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid userStoryId")
            t.user_story_id = usid
        else:
            t.user_story_id = None
    if body.projectId is not None or body.sectionId is not None:
        from crud import user_stories as stories_crud

        story = stories_crud.get_by_id(db, t.user_story_id) if t.user_story_id else None
        if t.user_story_id and (not story or story.project_id != t.project_id):
            t.user_story_id = None
    if body.parentTaskId is not None:
        pid = (body.parentTaskId or "").strip() or None
        if pid:
            if pid == t.id:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, "Task cannot be its own parent")
            parent = tasks_crud.get_by_id(db, pid)
            if not parent or parent.project_id != t.project_id:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid parentTaskId")
            if getattr(parent, "parent_task_id", None):
                raise HTTPException(status.HTTP_400_BAD_REQUEST, "Subtasks cannot nest more than one level")
            # The depth rule has two sides: a task that already has subtasks
            # would drag them to level three, which the create path refuses and
            # this one used to let through.
            if tasks_crud.list_children(db, t.id):
                raise HTTPException(
                    status.HTTP_400_BAD_REQUEST,
                    "Move its subtasks out before nesting this task",
                )
        t.parent_task_id = pid
    tasks_crud.update_task(db, t)
    if body.status is not None:
        _cascade_status_to_children(db, t, t.status)
    return to_task_out(db, t, current_user_id)


def start_task(db: Db, current_user_id: str, task_id: str) -> TaskOut:
    t = tasks_crud.get_by_id(db, task_id)
    if not t:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Task not found")
    project_logic.ensure_project_member(db, t.project_id, current_user_id)
    if t.status == "completed":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Cannot change a completed task")
    if not (_can_move_task_on_board(db, t, current_user_id) or _is_task_creator(t, current_user_id)):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Only an assignee or the creator can start this task",
        )
    t.is_started = True
    if not t.started_at:
        t.started_at = date.today().isoformat()
    tasks_crud.update_task(db, t)
    return to_task_out(db, t, current_user_id)


def move_task(db: Db, current_user_id: str, task_id: str, body: TaskMoveBody) -> TaskOut:
    t = tasks_crud.get_by_id(db, task_id)
    if not t:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Task not found")
    # Any project member may move tasks between columns on the board.
    project_logic.ensure_project_member(db, t.project_id, current_user_id)
    if t.status == "completed":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Completed tasks cannot be moved on the board")
    if body.actualHours is not None:
        _set_actual_hours(db, task_id, current_user_id, body.actualHours)
        t = _refresh_task(db, task_id)
    apply_status_to_task(db, t, body.status)
    _cascade_status_to_children(db, t, t.status)
    return to_task_out(db, t, current_user_id)


def _can_reopen_completed_task(db: Db, t: Task, user_id: str) -> bool:
    if _is_task_creator(t, user_id):
        return True
    if assignees_crud.is_assignee(db, t.id, user_id):
        return True
    actor = user_logic.get_user_or_404(db, user_id)
    return actor.role in ("manager", "superadmin")


def reopen_completed_to_backlog(db: Db, current_user_id: str, task_id: str) -> TaskOut:
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
    apply_status_to_task(db, t, "backlog")
    _cascade_status_to_children(db, t, t.status)
    return to_task_out(db, t, current_user_id)


def approve_task(db: Db, current_user_id: str, task_id: str, actual_hours: float | None = None) -> TaskOut:
    project_logic.ensure_manager(db, current_user_id)
    t = tasks_crud.get_by_id(db, task_id)
    if not t:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Task not found")
    project_logic.ensure_project_member(db, t.project_id, current_user_id)
    if actual_hours is not None:
        _set_actual_hours(db, task_id, current_user_id, actual_hours)
        t = _refresh_task(db, task_id)
    if t.status == "completed":
        # Already confirmed — return as-is so a stale Approve click is not an error.
        return to_task_out(db, t, current_user_id)
    apply_status_to_task(db, t, "completed", approve=True)
    _cascade_status_to_children(db, t, t.status)
    return to_task_out(db, t, current_user_id)


def log_time(db: Db, current_user_id: str, task_id: str, body: LogTimeBody) -> TaskOut:
    t = tasks_crud.get_by_id(db, task_id)
    if not t:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Task not found")
    if t.status == "completed":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Cannot log time on a completed task")
    if not _can_move_task_on_board(db, t, current_user_id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only assigned team members can log time on this task")
    if body.seconds <= 0:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "seconds must be positive")
    timelog_crud.add_seconds(db, task_id, body.date, body.seconds, current_user_id)
    t2 = tasks_crud.get_by_id(db, task_id)
    return to_task_out(db, t2, current_user_id)


def delete_task(db: Db, current_user_id: str, task_id: str) -> None:
    t = tasks_crud.get_by_id(db, task_id)
    if not t:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Task not found")
    project_logic.ensure_project_member(db, t.project_id, current_user_id)
    if not _can_delete_task(db, t, current_user_id):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Only the creator or a superadmin can delete this task",
        )
    tasks_crud.delete_task(db, task_id)


# ── Orchestration actions (audit + notifications + commit) ────────────────────
# Routes call these directly; they own the side-effects so endpoints stay thin.

def create_task_action(db: Db, user_id: str, body: TaskCreate) -> TaskOut:
    result = create_task(db, user_id, body)
    log_audit(db, user_id, "task.created", "task", result.id, result.title,
              {"projectId": result.projectId, "priority": result.priority})
    notification_logic.notify_users(
        db, user_ids=result.assigneeIds, type="task_assigned", title="New task assigned",
        message=f'{_actor_name(db, user_id)} assigned you to "{result.title}"',
        entity_type="task", entity_id=result.id, triggered_by=user_id,
    )
    _commit(db)
    return result


def patch_task_action(db: Db, user_id: str, task_id: str, body: TaskPatch) -> TaskOut:
    old_assignee_ids = set(assignees_crud.list_user_ids_ordered(db, task_id))
    result = patch_task(db, user_id, task_id, body)
    details: dict = {}
    if body.status is not None:
        details["status"] = body.status
    if body.priority is not None:
        details["priority"] = body.priority
    log_audit(db, user_id, "task.updated", "task", task_id, result.title, details)
    actor_name = _actor_name(db, user_id)
    if body.assigneeIds is not None:
        new_assignees = set(result.assigneeIds) - old_assignee_ids
        notification_logic.notify_users(
            db, user_ids=list(new_assignees), type="task_assigned", title="New task assigned",
            message=f'{actor_name} assigned you to "{result.title}"',
            entity_type="task", entity_id=task_id, triggered_by=user_id,
        )
    if body.status is not None:
        notification_logic.notify_users(
            db, user_ids=list(set(result.assigneeIds) | {result.createdBy}),
            type="task_status_changed", title="Task status updated",
            message=f'{actor_name} moved "{result.title}" to {body.status}',
            entity_type="task", entity_id=task_id, triggered_by=user_id,
        )
    _commit(db)
    return result


def delete_task_action(db: Db, user_id: str, task_id: str) -> None:
    t = tasks_crud.get_by_id(db, task_id)
    title = t.title if t else task_id
    delete_task(db, user_id, task_id)
    log_audit(db, user_id, "task.deleted", "task", task_id, title, {})
    _commit(db)


def start_task_action(db: Db, user_id: str, task_id: str) -> TaskOut:
    result = start_task(db, user_id, task_id)
    log_audit(db, user_id, "task.started", "task", task_id, result.title, {})
    _commit(db)
    return result


def move_task_action(db: Db, user_id: str, task_id: str, body: TaskMoveBody) -> TaskOut:
    result = move_task(db, user_id, task_id, body)
    log_audit(db, user_id, "task.status_changed", "task", task_id, result.title, {"status": body.status})
    notification_logic.notify_users(
        db, user_ids=list(set(result.assigneeIds) | {result.createdBy}),
        type="task_status_changed", title="Task status updated",
        message=f'{_actor_name(db, user_id)} moved "{result.title}" to {body.status}',
        entity_type="task", entity_id=task_id, triggered_by=user_id,
    )
    _commit(db)
    return result


def reopen_to_backlog_action(db: Db, user_id: str, task_id: str) -> TaskOut:
    result = reopen_completed_to_backlog(db, user_id, task_id)
    log_audit(db, user_id, "task.reopened", "task", task_id, result.title, {})
    _commit(db)
    return result


def approve_task_action(db: Db, user_id: str, task_id: str, body: ApproveTaskBody | None = None) -> TaskOut:
    existing = tasks_crud.get_by_id(db, task_id)
    already_completed = bool(existing and existing.status == "completed")
    hours = body.actualHours if body is not None else None
    result = approve_task(db, user_id, task_id, hours)
    if already_completed:
        return result
    log_audit(db, user_id, "task.approved", "task", task_id, result.title, {})
    notification_logic.notify_users(
        db, user_ids=list(set(result.assigneeIds) | {result.createdBy}),
        type="task_approved", title="Task approved",
        message=f'{_actor_name(db, user_id, "Manager")} approved "{result.title}"',
        entity_type="task", entity_id=task_id, triggered_by=user_id,
    )
    _commit(db)
    return result
