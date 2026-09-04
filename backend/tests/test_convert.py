"""Task ↔ story conversion."""
from conftest import make_project, make_user_story


def _setup(client, H, name):
    pid = make_project(client, H, name=name)["id"]
    sid = client.post(f"/projects/{pid}/sections", json={"name": "S"}, headers=H).json()["sections"][0]["id"]
    return pid, sid


def _task(client, H, user, pid, sid, title="T", story_id=None, parent_id=None):
    body = {
        "title": title,
        "projectId": pid,
        "sectionId": sid,
        "assigneeIds": [user["id"]],
        "assignedBy": user["id"],
        "createdBy": user["id"],
        "dueDate": "2026-07-01",
        "priority": "High",
        "tags": [],
    }
    if story_id:
        body["userStoryId"] = story_id
    if parent_id:
        body["parentTaskId"] = parent_id
    r = client.post("/tasks", json=body, headers=H)
    assert r.status_code == 200, r.text
    return r.json()


def test_a_task_becomes_a_story(client, manager):
    user, H = manager
    pid, sid = _setup(client, H, "T2S")
    task = _task(client, H, user, pid, sid, title="Promote me")

    r = client.post(f"/tasks/{task['id']}/convert-to-story", headers=H)
    assert r.status_code == 200, r.text
    story = r.json()
    assert story["title"] == "Promote me"
    assert story["priority"] == "High"
    assert story["projectId"] == pid and story["sectionId"] == sid
    assert story["assigneeIds"] == [user["id"]]
    # The task is gone; the story stands in its place.
    assert client.get(f"/tasks/{task['id']}", headers=H).status_code == 404


def test_subtasks_become_the_new_storys_tasks(client, manager):
    user, H = manager
    pid, sid = _setup(client, H, "T2SKids")
    parent = _task(client, H, user, pid, sid, title="Parent")
    child = _task(client, H, user, pid, sid, title="Child", parent_id=parent["id"])

    story = client.post(f"/tasks/{parent['id']}/convert-to-story", headers=H).json()
    moved = client.get(f"/tasks/{child['id']}", headers=H).json()
    assert moved["userStoryId"] == story["id"]
    assert moved["parentTaskId"] in (None, "")


def test_a_task_with_tracked_time_is_refused(client, manager):
    user, H = manager
    pid, sid = _setup(client, H, "T2STime")
    task = _task(client, H, user, pid, sid, title="Timed")
    client.post(f"/tasks/{task['id']}/log-time", json={"date": "2026-09-01", "seconds": 3600}, headers=H)

    r = client.post(f"/tasks/{task['id']}/convert-to-story", headers=H)
    assert r.status_code == 400, r.text
    assert "tracked time" in r.json()["detail"].lower()
    assert client.get(f"/tasks/{task['id']}", headers=H).status_code == 200


def test_a_story_becomes_a_task(client, manager):
    user, H = manager
    pid, sid = _setup(client, H, "S2T")
    story = make_user_story(client, H, pid, sid, title="Demote me")

    r = client.post(f"/user-stories/{story['id']}/convert-to-task", headers=H)
    assert r.status_code == 200, r.text
    task = r.json()
    assert task["title"] == "Demote me"
    assert task["projectId"] == pid and task["sectionId"] == sid
    assert client.get(f"/user-stories/{story['id']}", headers=H).status_code == 404


def test_the_storys_tasks_become_subtasks(client, manager):
    user, H = manager
    pid, sid = _setup(client, H, "S2TKids")
    story = make_user_story(client, H, pid, sid, title="Epic")
    child = _task(client, H, user, pid, sid, title="Child", story_id=story["id"])

    task = client.post(f"/user-stories/{story['id']}/convert-to-task", headers=H).json()
    moved = client.get(f"/tasks/{child['id']}", headers=H).json()
    assert moved["parentTaskId"] == task["id"]
    assert moved["userStoryId"] in (None, "")


def test_a_story_with_sub_stories_is_refused(client, manager):
    _, H = manager
    pid, sid = _setup(client, H, "S2TNested")
    epic = make_user_story(client, H, pid, sid, title="Epic")
    child = make_user_story(client, H, pid, sid, title="Sub")
    client.patch(f"/user-stories/{child['id']}", json={"parentStoryId": epic["id"]}, headers=H)

    r = client.post(f"/user-stories/{epic['id']}/convert-to-task", headers=H)
    assert r.status_code == 400, r.text
    assert "sub-stories" in r.json()["detail"].lower()
    assert client.get(f"/user-stories/{epic['id']}", headers=H).status_code == 200
