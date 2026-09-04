"""The rules one table has to state out loud.

The split schema enforced most of these by having nowhere to put the illegal
shape. With a single self-referencing table every shape is expressible, so each
rule is checked here instead.
"""
import pytest
from fastapi import HTTPException

import crud.work_items as items_crud
import logic.work_item_logic as wil
from conftest import make_project
from database.database import get_database
from database.init_db import _migrate_work_items
from logic.schemas import WorkItemCreate, WorkItemPatch


@pytest.fixture()
def env(client, manager):
    user, H = manager
    project = make_project(client, H, name="WIL", client_name="WILCo")
    pid = project["id"]
    db = get_database()
    _migrate_work_items()
    return db, user["id"], pid


def _make(db, uid, pid, item_type, title, parent=None, assignees=None):
    return wil.create_item(db, uid, WorkItemCreate(
        type=item_type, projectId=pid, title=title, parentId=parent,
        assigneeIds=assignees or [],
    ))


# --- allowed edges ---------------------------------------------------------

def test_a_story_holds_a_story(env):
    db, uid, pid = env
    epic = _make(db, uid, pid, wil.STORY, "Epic")
    child = _make(db, uid, pid, wil.STORY, "Child", parent=epic.id)
    assert child.parentId == epic.id


def test_a_story_holds_a_task(env):
    db, uid, pid = env
    story = _make(db, uid, pid, wil.STORY, "Story")
    task = _make(db, uid, pid, wil.TASK, "Task", parent=story.id)
    assert task.parentId == story.id


def test_a_task_holds_a_task(env):
    db, uid, pid = env
    parent = _make(db, uid, pid, wil.TASK, "Parent")
    sub = _make(db, uid, pid, wil.TASK, "Sub", parent=parent.id)
    assert sub.parentId == parent.id


def test_a_task_never_holds_a_story(env):
    """The one edge the old schema made unrepresentable, now checked on purpose."""
    db, uid, pid = env
    task = _make(db, uid, pid, wil.TASK, "Task")
    story = _make(db, uid, pid, wil.STORY, "Story")
    with pytest.raises(HTTPException) as e:
        wil.reparent(db, uid, story.id, task.id)
    assert e.value.status_code == 400
    assert "cannot go inside a task" in str(e.value.detail)


# --- cycles ----------------------------------------------------------------

def test_an_item_cannot_be_its_own_parent(env):
    db, uid, pid = env
    story = _make(db, uid, pid, wil.STORY, "Lonely")
    with pytest.raises(HTTPException) as e:
        wil.reparent(db, uid, story.id, story.id)
    assert e.value.status_code == 400


def test_an_item_cannot_move_inside_its_own_child(env):
    db, uid, pid = env
    epic = _make(db, uid, pid, wil.STORY, "Epic")
    child = _make(db, uid, pid, wil.STORY, "Child", parent=epic.id)
    with pytest.raises(HTTPException) as e:
        wil.reparent(db, uid, epic.id, child.id)
    assert "inside itself" in str(e.value.detail)


def test_a_deep_cycle_is_refused(env):
    db, uid, pid = env
    a = _make(db, uid, pid, wil.STORY, "A")
    b = _make(db, uid, pid, wil.STORY, "B", parent=a.id)
    c = _make(db, uid, pid, wil.STORY, "C", parent=b.id)
    with pytest.raises(HTTPException):
        wil.reparent(db, uid, a.id, c.id)


# --- depth -----------------------------------------------------------------

def test_a_subtask_cannot_take_a_subtask(env):
    db, uid, pid = env
    parent = _make(db, uid, pid, wil.TASK, "Parent")
    sub = _make(db, uid, pid, wil.TASK, "Sub", parent=parent.id)
    loose = _make(db, uid, pid, wil.TASK, "Loose")
    with pytest.raises(HTTPException) as e:
        wil.reparent(db, uid, loose.id, sub.id)
    assert "more than one level" in str(e.value.detail)


def test_a_task_with_subtasks_cannot_itself_be_nested(env):
    db, uid, pid = env
    host = _make(db, uid, pid, wil.TASK, "Host")
    parent = _make(db, uid, pid, wil.TASK, "Parent")
    _make(db, uid, pid, wil.TASK, "Sub", parent=parent.id)
    with pytest.raises(HTTPException) as e:
        wil.reparent(db, uid, parent.id, host.id)
    assert "subtasks out" in str(e.value.detail)


def test_a_task_under_a_story_may_still_take_subtasks(env):
    """Depth is counted in tasks: a story parent does not use up the one level."""
    db, uid, pid = env
    story = _make(db, uid, pid, wil.STORY, "Story")
    task = _make(db, uid, pid, wil.TASK, "Task", parent=story.id)
    sub = _make(db, uid, pid, wil.TASK, "Sub", parent=task.id)
    assert sub.parentId == task.id


# --- detaching -------------------------------------------------------------

def test_an_empty_string_detaches(env):
    """The bug that made every drag-out silently do nothing, pinned as a rule."""
    db, uid, pid = env
    story = _make(db, uid, pid, wil.STORY, "Story")
    task = _make(db, uid, pid, wil.TASK, "Task", parent=story.id)
    out = wil.patch_item(db, uid, task.id, WorkItemPatch(parentId=""))
    assert out.parentId is None


def test_none_means_leave_the_parent_alone(env):
    db, uid, pid = env
    story = _make(db, uid, pid, wil.STORY, "Story")
    task = _make(db, uid, pid, wil.TASK, "Task", parent=story.id)
    out = wil.patch_item(db, uid, task.id, WorkItemPatch(title="Renamed"))
    assert out.parentId == story.id
    assert out.title == "Renamed"


# --- type-specific columns -------------------------------------------------

def test_a_task_never_stores_story_points(env):
    db, uid, pid = env
    task = _make(db, uid, pid, wil.TASK, "Task")
    out = wil.patch_item(db, uid, task.id, WorkItemPatch(storyPoints="8"))
    assert out.storyPoints is None


def test_a_story_reports_no_execution_state(env):
    db, uid, pid = env
    story = _make(db, uid, pid, wil.STORY, "Story")
    assert story.timeTracked == 0
    assert story.isStarted is False
    assert story.assignedBy is None


# --- changing type ---------------------------------------------------------

def test_a_task_becomes_a_story_in_place(env):
    """One field, one row. The old convert built a new row in the other table."""
    db, uid, pid = env
    task = _make(db, uid, pid, wil.TASK, "Promote me")
    out = wil.set_type(db, uid, task.id, wil.STORY)
    assert out.id == task.id
    assert out.type == wil.STORY


def test_changing_type_keeps_the_children(env):
    db, uid, pid = env
    parent = _make(db, uid, pid, wil.TASK, "Parent")
    sub = _make(db, uid, pid, wil.TASK, "Sub", parent=parent.id)
    wil.set_type(db, uid, parent.id, wil.STORY)
    assert items_crud.get_by_id(db, sub.id).parent_id == parent.id


def test_a_story_with_sub_stories_can_become_a_task_only_when_emptied(env):
    """The old code refused this outright; here the reason is the tree, not the schema."""
    db, uid, pid = env
    epic = _make(db, uid, pid, wil.STORY, "Epic")
    child = _make(db, uid, pid, wil.STORY, "Child", parent=epic.id)
    with pytest.raises(HTTPException):
        wil.set_type(db, uid, epic.id, wil.TASK)
    wil.patch_item(db, uid, child.id, WorkItemPatch(parentId=""))
    assert wil.set_type(db, uid, epic.id, wil.TASK).type == wil.TASK


def test_a_task_with_tracked_time_cannot_become_a_story(env):
    db, uid, pid = env
    task = _make(db, uid, pid, wil.TASK, "Worked on")
    db.write("UPDATE work_items SET time_tracked = 3600 WHERE id = %s", (task.id,))
    with pytest.raises(HTTPException) as e:
        wil.set_type(db, uid, task.id, wil.STORY)
    assert "tracked time" in str(e.value.detail)


# --- delete ----------------------------------------------------------------

def test_deleting_a_parent_leaves_its_children_at_top_level(env):
    db, uid, pid = env
    story = _make(db, uid, pid, wil.STORY, "Story")
    task = _make(db, uid, pid, wil.TASK, "Task", parent=story.id)
    wil.delete_item(db, uid, story.id)
    assert items_crud.get_by_id(db, story.id) is None
    survivor = items_crud.get_by_id(db, task.id)
    assert survivor is not None and survivor.parent_id is None


# --- listing ---------------------------------------------------------------

def test_one_call_returns_both_kinds(env):
    """What replaces the board's two round trips and its tree rebuild in JS."""
    db, uid, pid = env
    story = _make(db, uid, pid, wil.STORY, "Story")
    task = _make(db, uid, pid, wil.TASK, "Task", parent=story.id)
    rows = {r.id: r for r in wil.list_visible(db, uid)}
    assert rows[story.id].type == wil.STORY
    assert rows[task.id].type == wil.TASK
    assert rows[task.id].parentId == story.id


def test_descendants_come_back_at_every_level(env):
    db, uid, pid = env
    story = _make(db, uid, pid, wil.STORY, "Story")
    task = _make(db, uid, pid, wil.TASK, "Task", parent=story.id)
    sub = _make(db, uid, pid, wil.TASK, "Sub", parent=task.id)
    found = {d.id for d in wil.list_descendants(db, uid, story.id)}
    assert found == {task.id, sub.id}


def test_an_unknown_type_is_refused(env):
    db, uid, pid = env
    with pytest.raises(HTTPException):
        _make(db, uid, pid, "epic", "Not a type")
