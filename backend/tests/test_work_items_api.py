"""The unified endpoints, over HTTP.

The logic tests prove the rules; these prove the wiring — that a client can
drive the whole board through one resource instead of two that disagree.
"""
from conftest import make_project


def _project(client, H, name):
    p = make_project(client, H, name=name, client_name=f"{name}Co")
    sid = client.post(f"/projects/{p['id']}/sections", json={"name": "S"}, headers=H).json()["sections"][0]["id"]
    return p["id"], sid


def _create(client, H, pid, item_type, title, parent=None, section=None):
    body = {"type": item_type, "projectId": pid, "title": title}
    if parent:
        body["parentId"] = parent
    if section:
        body["sectionId"] = section
    r = client.post("/work-items", json=body, headers=H)
    assert r.status_code == 200, r.text
    return r.json()


def test_a_story_and_a_task_come_back_from_one_endpoint(client, manager):
    _, H = manager
    pid, sid = _project(client, H, "OneList")
    story = _create(client, H, pid, "story", "Story", section=sid)
    task = _create(client, H, pid, "task", "Task", parent=story["id"], section=sid)

    rows = client.get("/work-items", headers=H).json()
    by_id = {r["id"]: r for r in rows}
    assert by_id[story["id"]]["type"] == "story"
    assert by_id[task["id"]]["type"] == "task"
    assert by_id[task["id"]]["parentId"] == story["id"]


def test_dragging_a_task_into_a_story_is_a_patch(client, manager):
    _, H = manager
    pid, sid = _project(client, H, "DragIn")
    story = _create(client, H, pid, "story", "Story", section=sid)
    task = _create(client, H, pid, "task", "Loose", section=sid)

    r = client.patch(f"/work-items/{task['id']}", json={"parentId": story["id"]}, headers=H)
    assert r.status_code == 200, r.text
    assert r.json()["parentId"] == story["id"]


def test_dragging_it_back_out_actually_detaches_it(client, manager):
    """The bug that started all of this, checked at the HTTP boundary."""
    _, H = manager
    pid, sid = _project(client, H, "DragOut")
    story = _create(client, H, pid, "story", "Story", section=sid)
    task = _create(client, H, pid, "task", "Child", parent=story["id"], section=sid)

    r = client.patch(f"/work-items/{task['id']}", json={"parentId": ""}, headers=H)
    assert r.status_code == 200, r.text
    assert r.json()["parentId"] is None
    assert client.get(f"/work-items/{task['id']}", headers=H).json()["parentId"] is None


def test_a_story_dropped_on_a_task_is_refused_with_a_reason(client, manager):
    _, H = manager
    pid, sid = _project(client, H, "BadDrop")
    task = _create(client, H, pid, "task", "Task", section=sid)
    story = _create(client, H, pid, "story", "Story", section=sid)

    r = client.patch(f"/work-items/{story['id']}", json={"parentId": task["id"]}, headers=H)
    assert r.status_code == 400
    assert "cannot go inside a task" in r.json()["detail"]


def test_children_and_descendants_are_separate_views(client, manager):
    _, H = manager
    pid, sid = _project(client, H, "Levels")
    story = _create(client, H, pid, "story", "Story", section=sid)
    task = _create(client, H, pid, "task", "Task", parent=story["id"], section=sid)
    sub = _create(client, H, pid, "task", "Sub", parent=task["id"], section=sid)

    kids = client.get(f"/work-items/{story['id']}/children", headers=H).json()
    assert [k["id"] for k in kids] == [task["id"]]

    all_below = client.get(f"/work-items/{story['id']}/descendants", headers=H).json()
    assert {d["id"] for d in all_below} == {task["id"], sub["id"]}


def test_deleting_a_story_keeps_the_work_inside_it(client, manager):
    _, H = manager
    pid, sid = _project(client, H, "DeleteStory")
    story = _create(client, H, pid, "story", "Story", section=sid)
    task = _create(client, H, pid, "task", "Task", parent=story["id"], section=sid)

    assert client.delete(f"/work-items/{story['id']}", headers=H).status_code == 204
    assert client.get(f"/work-items/{story['id']}", headers=H).status_code == 404
    survivor = client.get(f"/work-items/{task['id']}", headers=H).json()
    assert survivor["parentId"] is None


def test_someone_outside_the_project_cannot_read_an_item(client, manager, employee):
    _, H = manager
    _, EH = employee
    pid, sid = _project(client, H, "Private")
    story = _create(client, H, pid, "story", "Story", section=sid)

    assert client.get(f"/work-items/{story['id']}", headers=EH).status_code == 403


def test_an_unauthenticated_caller_gets_nothing(client):
    assert client.get("/work-items").status_code == 401
