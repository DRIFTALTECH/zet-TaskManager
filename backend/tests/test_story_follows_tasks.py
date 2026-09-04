"""A story's status is its own: moving a task must not move the story with it."""
from conftest import make_project, make_user_story


def _setup(client, H, name):
    pid = make_project(client, H, name=name)["id"]
    sid = client.post(f"/projects/{pid}/sections", json={"name": "S"}, headers=H).json()["sections"][0]["id"]
    story = make_user_story(client, H, pid, sid, title=f"{name} story")
    return pid, sid, story


def _task(client, H, user, pid, sid, story_id, title="T"):
    r = client.post(
        "/tasks",
        json={
            "title": title,
            "projectId": pid,
            "sectionId": sid,
            "assigneeIds": [user["id"]],
            "assignedBy": user["id"],
            "createdBy": user["id"],
            "dueDate": "2026-07-01",
            "priority": "Medium",
            "tags": [],
            "userStoryId": story_id,
        },
        headers=H,
    )
    assert r.status_code == 200, r.text
    return r.json()


def _story(client, H, story_id):
    r = client.get(f"/user-stories/{story_id}", headers=H)
    assert r.status_code == 200, r.text
    return r.json()


def test_moving_a_task_leaves_its_story_where_it_is(client, manager):
    user, H = manager
    pid, sid, story = _setup(client, H, "Independent")
    task = _task(client, H, user, pid, sid, story["id"])

    r = client.post(f"/tasks/{task['id']}/move", json={"status": "in_progress"}, headers=H)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "in_progress"
    assert _story(client, H, story["id"])["status"] == "backlog"


def test_patching_a_task_status_leaves_its_story_where_it_is(client, manager):
    user, H = manager
    pid, sid, story = _setup(client, H, "IndependentPatch")
    task = _task(client, H, user, pid, sid, story["id"])

    r = client.patch(f"/tasks/{task['id']}", json={"status": "in_review"}, headers=H)
    assert r.status_code == 200, r.text
    assert _story(client, H, story["id"])["status"] == "backlog"


def test_finishing_every_task_still_leaves_the_story_alone(client, manager):
    user, H = manager
    pid, sid, story = _setup(client, H, "AllDone")
    a = _task(client, H, user, pid, sid, story["id"], title="A")
    b = _task(client, H, user, pid, sid, story["id"], title="B")

    client.post(f"/tasks/{a['id']}/move", json={"status": "done", "actualHours": 1}, headers=H)
    client.post(f"/tasks/{b['id']}/move", json={"status": "done", "actualHours": 1}, headers=H)
    assert _story(client, H, story["id"])["status"] == "backlog"
