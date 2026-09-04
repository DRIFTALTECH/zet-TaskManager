"""Querying the unified table — above all, walking the tree in SQL.

The split schema could not walk the hierarchy at all: a story's tasks sat in
another table under a different foreign key, so the dashboard fetched every row
flat and rebuilt the tree in JavaScript. One parent column makes it a query.
"""
from conftest import make_project, make_user_story
from database.database import get_database
from database.init_db import _migrate_work_items

import crud.work_items as wi


def _setup(client, H, name):
    pid = make_project(client, H, name=name)["id"]
    sid = client.post(f"/projects/{pid}/sections", json={"name": "S"}, headers=H).json()["sections"][0]["id"]
    return pid, sid


def _task(client, H, user, pid, sid, title, story_id=None, parent_id=None):
    body = {
        "title": title, "projectId": pid, "sectionId": sid,
        "assigneeIds": [user["id"]], "assignedBy": user["id"], "createdBy": user["id"],
        "dueDate": "2026-07-01", "priority": "Medium", "tags": [],
    }
    if story_id:
        body["userStoryId"] = story_id
    if parent_id:
        body["parentTaskId"] = parent_id
    r = client.post("/tasks", json=body, headers=H)
    assert r.status_code == 200, r.text
    return r.json()


def _db():
    """Tasks and stories are already work items — nothing to copy or convert."""
    db = get_database()
    _migrate_work_items()
    return db


def _tree(client, H, user, name):
    """story → task → subtask, the shape the board actually draws."""
    pid, sid = _setup(client, H, name)
    story = make_user_story(client, H, pid, sid, title="Story")
    task = _task(client, H, user, pid, sid, "Task", story_id=story["id"])
    sub = _task(client, H, user, pid, sid, "Subtask", story_id=story["id"], parent_id=task["id"])
    return _db(), story, task, sub


def test_get_by_id_reads_a_work_item(client, manager):
    user, H = manager
    db, story, _, _ = _tree(client, H, user, "Get")
    item = wi.get_by_id(db, story["id"])
    assert item is not None and item.type == "story" and item.title == "Story"


def test_children_are_the_level_below_only(client, manager):
    user, H = manager
    db, story, task, sub = _tree(client, H, user, "Children")
    kids = [w.id for w in wi.list_children(db, story["id"])]
    assert kids == [task["id"]]
    assert sub["id"] not in kids


def test_descendants_reach_every_level(client, manager):
    """One recursive query where the old schema needed a walk per level."""
    user, H = manager
    db, story, task, sub = _tree(client, H, user, "Descendants")
    found = {w.id for w in wi.list_descendants(db, story["id"])}
    assert found == {task["id"], sub["id"]}


def test_is_descendant_of_is_the_cycle_guard(client, manager):
    user, H = manager
    db, story, task, sub = _tree(client, H, user, "Cycle")
    assert wi.is_descendant_of(db, sub["id"], story["id"]) is True
    assert wi.is_descendant_of(db, story["id"], sub["id"]) is False
    # An item is trivially inside itself, which a reparent must also refuse.
    assert wi.is_descendant_of(db, story["id"], story["id"]) is True


def test_depth_counts_the_parents_above(client, manager):
    user, H = manager
    db, story, task, sub = _tree(client, H, user, "Depth")
    assert wi.depth_of(db, story["id"]) == 0
    assert wi.depth_of(db, task["id"]) == 1
    assert wi.depth_of(db, sub["id"]) == 2


def test_type_filters_a_project_listing(client, manager):
    user, H = manager
    db, story, task, sub = _tree(client, H, user, "Filter")
    pid = wi.get_by_id(db, story["id"]).project_id
    stories = wi.list_for_project(db, pid, wi.STORY)
    tasks = wi.list_for_project(db, pid, wi.TASK)
    assert [s.id for s in stories] == [story["id"]]
    assert {t.id for t in tasks} == {task["id"], sub["id"]}


def test_assignees_come_back_in_one_query_for_many_items(client, manager):
    user, H = manager
    db, story, task, sub = _tree(client, H, user, "BatchAssignees")
    mapped = wi.map_user_ids(db, [task["id"], sub["id"]])
    assert mapped[task["id"]] == [user["id"]]
    assert mapped[sub["id"]] == [user["id"]]


def test_setting_a_parent_moves_the_item(client, manager):
    user, H = manager
    db, story, task, sub = _tree(client, H, user, "Reparent")
    wi.set_parent(db, sub["id"], story["id"])
    assert wi.get_by_id(db, sub["id"]).parent_id == story["id"]
    assert wi.depth_of(db, sub["id"]) == 1


def test_detaching_children_leaves_them_at_top_level(client, manager):
    user, H = manager
    db, story, task, _ = _tree(client, H, user, "Detach")
    wi.detach_children(db, story["id"])
    assert wi.get_by_id(db, task["id"]).parent_id is None


def test_a_story_cannot_carry_tracked_time(client, manager):
    """The invariant the two-table split used to give for free.

    A time log could not point at a story when stories lived in their own table.
    With one table nothing stops a story row accruing execution state except
    this constraint, so it is checked rather than assumed.
    """
    import pytest

    user, H = manager
    db, story, _, _ = _tree(client, H, user, "NoTime")
    with pytest.raises(Exception):
        db.write(
            "UPDATE work_items SET time_tracked = 3600 WHERE id = %s AND type = 'story'",
            (story["id"],),
        )


def test_a_story_parent_does_not_use_up_the_subtask_level(client, manager):
    """Task depth counts tasks only.

    Counting every parent made a task inside a story look one level deep
    already, so it was refused its own subtasks — a rule nobody asked for.
    """
    user, H = manager
    db, story, task, sub = _tree(client, H, user, "TaskDepth")
    assert wi.depth_of(db, task["id"]) == 1        # story above it
    assert wi.task_depth_of(db, task["id"]) == 0   # but no task above it
    assert wi.task_depth_of(db, sub["id"]) == 1
    assert wi.task_depth_of(db, story["id"]) == 0


def test_a_stale_work_items_table_gains_its_late_columns(client, manager):
    """A cluster created before a column existed must still get it.

    CREATE TABLE IF NOT EXISTS is a no-op once the table is there, so a column
    added later only ever arrives through an explicit ALTER. Aurora hit exactly
    this: work_items existed without assigned_to, and every board read failed
    with "column w.assigned_to does not exist".
    """
    from database.init_db import _column_exists, _migrate_work_items

    db = get_database()
    db.write("DROP TABLE IF EXISTS work_items_stale_probe")
    db.write("CREATE TABLE work_items_stale_probe (id TEXT PRIMARY KEY)")
    assert not _column_exists(db, "work_items_stale_probe", "assigned_to")

    # The real table keeps its column across a re-run of the migration.
    _migrate_work_items()
    assert _column_exists(db, "work_items", "assigned_to")
    assert _column_exists(db, "work_items", "acceptance_criteria")
    db.write("DROP TABLE work_items_stale_probe")
