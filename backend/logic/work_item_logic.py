"""Business rules for the unified work item.

One table means the shapes the old schema made impossible now have to be
refused on purpose. Two rules carry that weight:

ALLOWED EDGES
    story -> story    an epic holding stories
    story -> task     a story holding its tasks
    task  -> task     a subtask, and only one level of them
    task  -> story    REFUSED — a story never lives inside a task

    The split schema enforced the last one by having nowhere to put it: a task
    row simply had no column that could name a story child. With one
    self-referencing column it is expressible, so it is checked here.

NO CYCLES
    `parent_id` is a self-reference, so an item can be made its own ancestor.
    Every reparent walks the subtree first and refuses if the new parent is
    inside the item being moved.

TYPE-SPECIFIC COLUMNS
    A story carries no execution state and a task carries no story points. The
    database has a CHECK for the half that matters (a story with tracked time
    would corrupt every rollup); this layer keeps the rest honest so the two
    kinds cannot quietly bleed into each other.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

from fastapi import HTTPException, status

import crud.projects as projects_crud
import crud.sections as sections_crud
import crud.work_items as items_crud
from database.database import Db
from database.init_db import new_id
from logic import project_logic, user_logic
from logic.audit import log_audit
from logic.schemas import WorkItemCreate, WorkItemOut, WorkItemPatch

STORY = items_crud.STORY
TASK = items_crud.TASK
VALID_TYPES = (STORY, TASK)

# task -> story is absent on purpose; see the module docstring.
ALLOWED_EDGES = {
    (STORY, STORY),
    (TASK, STORY),   # (child, parent): a task inside a story
    (TASK, TASK),    # a subtask
}

MAX_TASK_DEPTH = 1  # a subtask may not itself have subtasks


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _tags(raw: str | None) -> list[str]:
    try:
        parsed = json.loads(raw or "[]")
        return [str(t) for t in parsed] if isinstance(parsed, list) else []
    except (ValueError, TypeError):
        return []


def _hours(raw: str | None) -> float | None:
    if raw in (None, ""):
        return None
    try:
        return float(raw)
    except (ValueError, TypeError):
        return None


def _fields(raw: str | None) -> dict[str, str] | None:
    try:
        parsed = json.loads(raw or "{}")
        return {str(k): str(v) for k, v in parsed.items()} if isinstance(parsed, dict) else None
    except (ValueError, TypeError):
        return None


def to_out(item, assignee_ids: list[str]) -> WorkItemOut:
    is_story = item.type == STORY
    return WorkItemOut(
        id=item.id,
        type=item.type,
        parentId=item.parent_id or None,
        projectId=item.project_id,
        sectionId=item.section_id or None,
        title=item.title,
        description=item.description or "",
        priority=item.priority,
        status=item.status,
        dueDate=item.due_date or None,
        sprint=item.sprint or "",
        tags=_tags(item.tags_json),
        estimatedHours=_hours(item.estimated_hours),
        approvedByManager=bool(item.approved_by_manager),
        assigneeIds=assignee_ids,
        createdBy=item.created_by or None,
        createdAt=item.created_at,
        updatedAt=item.updated_at or None,
        assignedBy=None if is_story else (item.assigned_by or None),
        isStarted=False if is_story else bool(item.is_started),
        startedAt=None if is_story else (item.started_at or None),
        completedAt=None if is_story else (item.completed_at or None),
        timeTracked=0 if is_story else int(item.time_tracked or 0),
        minLogMinutes=1 if is_story else int(item.min_log_minutes or 1),
        customFields=None if is_story else _fields(item.custom_fields_json),
        acceptanceCriteria=(item.acceptance_criteria or "") if is_story else "",
        storyPoints=item.story_points if is_story else None,
        startDate=item.start_date if is_story else None,
    )


def get_or_404(db: Db, item_id: str):
    item = items_crud.get_by_id(db, item_id)
    if not item:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Work item not found")
    return item


def _ensure_type(item_type: str) -> str:
    if item_type not in VALID_TYPES:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, f"type must be one of {', '.join(VALID_TYPES)}"
        )
    return item_type


def ensure_parent_allowed(db: Db, child_type: str, child_id: str | None, parent_id: str) -> None:
    """Every rule about what may sit inside what, in one place.

    Called by create and by every reparent, so a drag on the board and a drag in
    the list cannot disagree about what is legal.
    """
    parent = items_crud.get_by_id(db, parent_id)
    if not parent:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Parent does not exist")
    if child_id and parent.id == child_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "An item cannot be its own parent")
    if (child_type, parent.type) not in ALLOWED_EDGES:
        if child_type == STORY and parent.type == TASK:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "A story cannot go inside a task")
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "That item cannot hold this one")
    # A cycle: the proposed parent already sits under the item being moved.
    if child_id and items_crud.is_descendant_of(db, parent.id, child_id):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "That would put the item inside itself")
    if child_type == TASK and parent.type == TASK:
        if items_crud.task_depth_of(db, parent.id) >= MAX_TASK_DEPTH:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "Subtasks cannot nest more than one level"
            )
        # The other side of the same rule: this item's own children would end up
        # a level too deep. The old patch path let exactly this through.
        if child_id and items_crud.list_children(db, child_id):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "Move its subtasks out before nesting this item"
            )


def _ensure_same_project(db: Db, project_id: str, parent_id: str) -> None:
    parent = items_crud.get_by_id(db, parent_id)
    if parent and parent.project_id != project_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Move it to the same project first")


def _ensure_members(db: Db, project_id: str, user_ids: list[str]) -> None:
    if not user_ids:
        return
    mids = projects_crud.member_ids(db, project_id)
    for uid in user_ids:
        if uid not in mids:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "Every assignee must be a project member"
            )


def list_visible(db: Db, current_user_id: str) -> list[WorkItemOut]:
    """Every item the caller may see — stories and tasks in one payload.

    The board needed two round trips and rebuilt the hierarchy in the browser
    because the two halves came from different tables. One table, one call.
    """
    actor = user_logic.get_user_or_404(db, current_user_id)
    visible = (
        items_crud.list_all_lean(db)
        if actor.role == "superadmin"
        else items_crud.list_for_member_projects_lean(db, current_user_id)
    )
    assignees = items_crud.map_user_ids(db, [i.id for i in visible])
    return [to_out(i, assignees.get(i.id, [])) for i in visible]


def get_item(db: Db, current_user_id: str, item_id: str) -> WorkItemOut:
    item = get_or_404(db, item_id)
    project_logic.ensure_project_member(db, item.project_id, current_user_id)
    return to_out(item, items_crud.list_user_ids_ordered(db, item.id))


def create_item(db: Db, current_user_id: str, body: WorkItemCreate) -> WorkItemOut:
    item_type = _ensure_type(body.type)
    project_logic.ensure_project_member(db, body.projectId, current_user_id)

    if body.sectionId:
        sec = sections_crud.get_by_id(db, body.sectionId)
        if not sec or sec.project_id != body.projectId:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid section for project")

    parent_id = (body.parentId or "").strip() or None
    if parent_id:
        _ensure_same_project(db, body.projectId, parent_id)
        ensure_parent_allowed(db, item_type, None, parent_id)

    assignee_ids = list(dict.fromkeys(body.assigneeIds))
    _ensure_members(db, body.projectId, assignee_ids)

    from database.models import WorkItem

    item = WorkItem(
        id=new_id("w"),
        type=item_type,
        parent_id=parent_id,
        project_id=body.projectId,
        section_id=body.sectionId or None,
        title=body.title,
        description=body.description or "",
        priority=body.priority,
        status=body.status,
        due_date=body.dueDate,
        sprint=body.sprint or "",
        tags_json=json.dumps(list(body.tags)[:40]),
        estimated_hours=None if body.estimatedHours is None else str(body.estimatedHours),
        approved_by_manager=False,
        created_by=current_user_id,
        created_at=_now(),
        updated_at=None,
        # Execution state belongs to a task; a story stays at the defaults the
        # database CHECK insists on.
        assigned_by=current_user_id if item_type == TASK else None,
        is_started=False,
        started_at=None,
        completed_at=None,
        time_tracked=0,
        min_log_minutes=1,
        custom_fields_json="{}",
        acceptance_criteria=body.acceptanceCriteria or "" if item_type == STORY else "",
        story_points=body.storyPoints if item_type == STORY else None,
        start_date=body.startDate if item_type == STORY else None,
    )
    items_crud.create(db, item)
    items_crud.set_assignees(db, item.id, assignee_ids)
    log_audit(db, current_user_id, f"{item_type}.created", item_type, item.id, item.title, {})
    db.commit()
    return to_out(item, assignee_ids)


def patch_item(db: Db, current_user_id: str, item_id: str, body: WorkItemPatch) -> WorkItemOut:
    item = get_or_404(db, item_id)
    project_logic.ensure_project_member(db, item.project_id, current_user_id)

    if body.title is not None:
        item.title = body.title
    if body.description is not None:
        item.description = body.description
    if body.priority is not None:
        item.priority = body.priority
    if body.status is not None:
        item.status = body.status
    if body.dueDate is not None:
        item.due_date = body.dueDate or None
    if body.sprint is not None:
        item.sprint = body.sprint
    if body.tags is not None:
        item.tags_json = json.dumps([t for t in body.tags if (t or "").strip()][:40])
    if body.estimatedHours is not None:
        item.estimated_hours = str(body.estimatedHours)
    if body.sectionId is not None:
        section_id = body.sectionId.strip() or None
        if section_id:
            sec = sections_crud.get_by_id(db, section_id)
            if not sec or sec.project_id != item.project_id:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid section for project")
        item.section_id = section_id

    # Story-only fields are ignored on a task rather than silently stored: a
    # task carrying story points is the sort of drift one table invites.
    if item.type == STORY:
        if body.acceptanceCriteria is not None:
            item.acceptance_criteria = body.acceptanceCriteria
        if body.storyPoints is not None:
            item.story_points = body.storyPoints or None
        if body.startDate is not None:
            item.start_date = body.startDate or None

    if body.parentId is not None:
        # Empty string detaches. None never reaches here — it means "not
        # supplied" — which is the trap the dashboard fell into for months.
        new_parent = body.parentId.strip() or None
        if new_parent:
            _ensure_same_project(db, item.project_id, new_parent)
            ensure_parent_allowed(db, item.type, item.id, new_parent)
        item.parent_id = new_parent

    item.updated_at = _now()
    items_crud.update(db, item)

    assignee_ids = items_crud.list_user_ids_ordered(db, item.id)
    if body.assigneeIds is not None:
        assignee_ids = list(dict.fromkeys(body.assigneeIds))
        _ensure_members(db, item.project_id, assignee_ids)
        items_crud.set_assignees(db, item.id, assignee_ids)

    log_audit(db, current_user_id, f"{item.type}.updated", item.type, item.id, item.title, {})
    db.commit()
    return to_out(item, assignee_ids)


def reparent(db: Db, current_user_id: str, item_id: str, parent_id: str | None) -> WorkItemOut:
    """The one operation both views call when something is dragged into something.

    The board and the list disagreed about what a drop meant because each
    decided for itself; there is now a single answer.
    """
    return patch_item(
        db, current_user_id, item_id, WorkItemPatch(parentId=parent_id or "")
    )


def set_type(db: Db, current_user_id: str, item_id: str, new_type: str) -> WorkItemOut:
    """Story <-> task. A field, not a row move.

    This replaces convert_logic, which had to build a new row in the other
    table, carry across what both sides understood, re-home the children and
    then refuse outright when a task had logged time or a story had sub-stories
    — restrictions that were artefacts of the split, not product rules.
    """
    _ensure_type(new_type)
    item = get_or_404(db, item_id)
    project_logic.ensure_project_member(db, item.project_id, current_user_id)
    if item.type == new_type:
        return to_out(item, items_crud.list_user_ids_ordered(db, item.id))

    # Its new place in the tree has to be legal, and so does every child's.
    if item.parent_id:
        ensure_parent_allowed(db, new_type, item.id, item.parent_id)
    for child in items_crud.list_children(db, item.id):
        if (child.type, new_type) not in ALLOWED_EDGES:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "Move what is inside it out first: it cannot hold those as a " + new_type,
            )

    if new_type == STORY:
        # Tracked time has nowhere to live on a story, and the CHECK constraint
        # would refuse the row. Say so rather than dropping someone's hours.
        if int(item.time_tracked or 0) > 0:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "This has tracked time, which a story cannot hold",
            )
        item.is_started = False
        item.started_at = None
        item.assigned_by = None
        item.custom_fields_json = "{}"
    else:
        item.acceptance_criteria = ""
        item.story_points = None
        item.start_date = None
        item.assigned_by = current_user_id

    item.type = new_type
    item.updated_at = _now()
    items_crud.update(db, item)
    log_audit(db, current_user_id, "work_item.type_changed", new_type, item.id, item.title,
              {"type": new_type})
    db.commit()
    return to_out(item, items_crud.list_user_ids_ordered(db, item.id))


def delete_item(db: Db, current_user_id: str, item_id: str) -> None:
    item = get_or_404(db, item_id)
    project_logic.ensure_project_member(db, item.project_id, current_user_id)
    # Children outlive their parent at the top level rather than vanishing with
    # it: deleting a story is not a request to delete the work inside it.
    items_crud.detach_children(db, item.id)
    items_crud.delete(db, item.id)
    log_audit(db, current_user_id, f"{item.type}.deleted", item.type, item.id, item.title, {})
    db.commit()


def list_children(db: Db, current_user_id: str, item_id: str) -> list[WorkItemOut]:
    item = get_or_404(db, item_id)
    project_logic.ensure_project_member(db, item.project_id, current_user_id)
    kids = items_crud.list_children(db, item.id)
    assignees = items_crud.map_user_ids(db, [k.id for k in kids])
    return [to_out(k, assignees.get(k.id, [])) for k in kids]


def list_descendants(db: Db, current_user_id: str, item_id: str) -> list[WorkItemOut]:
    item = get_or_404(db, item_id)
    project_logic.ensure_project_member(db, item.project_id, current_user_id)
    kids = items_crud.list_descendants(db, item.id)
    assignees = items_crud.map_user_ids(db, [k.id for k in kids])
    return [to_out(k, assignees.get(k.id, [])) for k in kids]
