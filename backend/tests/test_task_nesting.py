"""Nesting a task: joining a story, becoming a subtask, and getting back out.

The board and the list both drive these through PATCH /tasks/{id}, and the
detaching half was silently doing nothing: the API reads a null as "field
absent, leave it alone", so the only way to remove a link is the empty string.
"""
from conftest import make_project, make_user_story


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


def _get(client, H, task_id):
    r = client.get(f"/tasks/{task_id}", headers=H)
    assert r.status_code == 200, r.text
    return r.json()


def test_empty_string_detaches_a_task_from_its_story(client, manager):
    user, H = manager
    pid, sid = _setup(client, H, "Detach")
    story = make_user_story(client, H, pid, sid, title="Story")
    task = _task(client, H, user, pid, sid, "Child", story_id=story["id"])

    r = client.patch(f"/tasks/{task['id']}", json={"userStoryId": ""}, headers=H)
    assert r.status_code == 200, r.text
    assert _get(client, H, task["id"])["userStoryId"] is None


def test_null_is_not_a_detach(client, manager):
    """The contract the dashboard was getting wrong — pinned so it stays visible."""
    user, H = manager
    pid, sid = _setup(client, H, "NullNoop")
    story = make_user_story(client, H, pid, sid, title="Story")
    task = _task(client, H, user, pid, sid, "Child", story_id=story["id"])

    r = client.patch(f"/tasks/{task['id']}", json={"userStoryId": None}, headers=H)
    assert r.status_code == 200, r.text
    assert _get(client, H, task["id"])["userStoryId"] == story["id"]


def test_empty_string_detaches_a_subtask_from_its_parent(client, manager):
    user, H = manager
    pid, sid = _setup(client, H, "DetachParent")
    parent = _task(client, H, user, pid, sid, "Parent")
    child = _task(client, H, user, pid, sid, "Child", parent_id=parent["id"])

    r = client.patch(f"/tasks/{child['id']}", json={"parentTaskId": ""}, headers=H)
    assert r.status_code == 200, r.text
    assert _get(client, H, child["id"])["parentTaskId"] is None


def test_a_task_becomes_a_subtask_of_another(client, manager):
    user, H = manager
    pid, sid = _setup(client, H, "Nest")
    host = _task(client, H, user, pid, sid, "Host")
    loose = _task(client, H, user, pid, sid, "Loose")

    r = client.patch(f"/tasks/{loose['id']}", json={"parentTaskId": host["id"]}, headers=H)
    assert r.status_code == 200, r.text
    assert _get(client, H, loose["id"])["parentTaskId"] == host["id"]


def test_a_task_cannot_be_its_own_parent(client, manager):
    user, H = manager
    pid, sid = _setup(client, H, "Self")
    task = _task(client, H, user, pid, sid, "Lonely")
    r = client.patch(f"/tasks/{task['id']}", json={"parentTaskId": task["id"]}, headers=H)
    assert r.status_code == 400, r.text


def test_nesting_under_a_subtask_is_refused(client, manager):
    user, H = manager
    pid, sid = _setup(client, H, "TooDeep")
    parent = _task(client, H, user, pid, sid, "Parent")
    child = _task(client, H, user, pid, sid, "Child", parent_id=parent["id"])
    loose = _task(client, H, user, pid, sid, "Loose")

    r = client.patch(f"/tasks/{loose['id']}", json={"parentTaskId": child["id"]}, headers=H)
    assert r.status_code == 400, r.text


def test_a_task_with_subtasks_cannot_itself_be_nested(client, manager):
    """The other side of the one-level rule: create refused it, patch let it through."""
    user, H = manager
    pid, sid = _setup(client, H, "DeepFromBelow")
    host = _task(client, H, user, pid, sid, "Host")
    parent = _task(client, H, user, pid, sid, "Parent")
    _task(client, H, user, pid, sid, "Child", parent_id=parent["id"])

    r = client.patch(f"/tasks/{parent['id']}", json={"parentTaskId": host["id"]}, headers=H)
    assert r.status_code == 400, r.text
    assert _get(client, H, parent["id"])["parentTaskId"] is None


def test_a_task_moves_from_one_story_to_another(client, manager):
    user, H = manager
    pid, sid = _setup(client, H, "Rehome")
    a = make_user_story(client, H, pid, sid, title="A")
    b = make_user_story(client, H, pid, sid, title="B")
    task = _task(client, H, user, pid, sid, "Child", story_id=a["id"])

    r = client.patch(f"/tasks/{task['id']}", json={"userStoryId": b["id"]}, headers=H)
    assert r.status_code == 200, r.text
    assert _get(client, H, task["id"])["userStoryId"] == b["id"]
