"""Moving something to another status takes everything inside it along."""
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


def _status(client, H, task_id):
    return client.get(f"/tasks/{task_id}", headers=H).json()["status"]


def _story_status(client, H, story_id):
    return client.get(f"/user-stories/{story_id}", headers=H).json()["status"]


def test_moving_a_task_moves_its_subtasks(client, manager):
    user, H = manager
    pid, sid = _setup(client, H, "TaskCascade")
    parent = _task(client, H, user, pid, sid, "Parent")
    child = _task(client, H, user, pid, sid, "Child", parent_id=parent["id"])

    r = client.post(f"/tasks/{parent['id']}/move", json={"status": "in_review"}, headers=H)
    assert r.status_code == 200, r.text
    assert _status(client, H, child["id"]) == "in_review"


def test_patching_a_task_status_moves_its_subtasks(client, manager):
    user, H = manager
    pid, sid = _setup(client, H, "TaskPatchCascade")
    parent = _task(client, H, user, pid, sid, "Parent")
    child = _task(client, H, user, pid, sid, "Child", parent_id=parent["id"])

    client.patch(f"/tasks/{parent['id']}", json={"status": "testing"}, headers=H)
    assert _status(client, H, child["id"]) == "testing"


def test_moving_a_story_moves_its_tasks_and_subtasks(client, manager):
    user, H = manager
    pid, sid = _setup(client, H, "StoryCascade")
    story = make_user_story(client, H, pid, sid, title="Epic")
    task = _task(client, H, user, pid, sid, "Task", story_id=story["id"])
    sub = _task(client, H, user, pid, sid, "Sub", story_id=story["id"], parent_id=task["id"])

    r = client.patch(f"/user-stories/{story['id']}", json={"status": "in_progress"}, headers=H)
    assert r.status_code == 200, r.text
    assert _status(client, H, task["id"]) == "in_progress"
    assert _status(client, H, sub["id"]) == "in_progress"


def test_moving_a_story_moves_its_sub_stories(client, manager):
    user, H = manager
    pid, sid = _setup(client, H, "SubStoryCascade")
    epic = make_user_story(client, H, pid, sid, title="Epic")
    child = make_user_story(client, H, pid, sid, title="Sub")
    client.patch(f"/user-stories/{child['id']}", json={"parentStoryId": epic["id"]}, headers=H)
    child_task = _task(client, H, user, pid, sid, "Sub task", story_id=child["id"])

    client.patch(f"/user-stories/{epic['id']}", json={"status": "in_review"}, headers=H)
    assert _story_status(client, H, child["id"]) == "in_review"
    assert _status(client, H, child_task["id"]) == "in_review"


def test_a_cycle_in_the_data_does_not_hang_the_cascade(client, manager):
    user, H = manager
    pid, sid = _setup(client, H, "CycleCascade")
    a = make_user_story(client, H, pid, sid, title="A")
    b = make_user_story(client, H, pid, sid, title="B")
    client.patch(f"/user-stories/{b['id']}", json={"parentStoryId": a["id"]}, headers=H)

    # The API refuses to close the loop, so force it the way corrupt data would.
    from database.database import SessionLocal
    db = SessionLocal()
    try:
        db.write("UPDATE user_stories SET parent_story_id = %s WHERE id = %s", (b["id"], a["id"]))
        db.commit()
    finally:
        db.close()

    r = client.patch(f"/user-stories/{a['id']}", json={"status": "testing"}, headers=H)
    assert r.status_code == 200, r.text
    assert _story_status(client, H, b["id"]) == "testing"


def test_new_work_starts_where_its_container_is(client, manager):
    """So a fresh subtask is not adrift in Backlog under a task in progress."""
    user, H = manager
    pid, sid = _setup(client, H, "Inherit")
    story = make_user_story(client, H, pid, sid, title="Epic")
    client.patch(f"/user-stories/{story['id']}", json={"status": "in_progress"}, headers=H)

    task = _task(client, H, user, pid, sid, "Task", story_id=story["id"])
    assert task["status"] == "in_progress"

    client.post(f"/tasks/{task['id']}/move", json={"status": "testing"}, headers=H)
    sub = _task(client, H, user, pid, sid, "Sub", parent_id=task["id"])
    assert sub["status"] == "testing"


def test_an_explicit_status_still_wins(client, manager):
    user, H = manager
    pid, sid = _setup(client, H, "InheritOverride")
    parent = _task(client, H, user, pid, sid, "Parent")
    client.post(f"/tasks/{parent['id']}/move", json={"status": "in_review"}, headers=H)

    r = client.post(
        "/tasks",
        json={
            "title": "Deliberate", "projectId": pid, "sectionId": sid,
            "assigneeIds": [user["id"]], "assignedBy": user["id"], "createdBy": user["id"],
            "dueDate": "2026-07-01", "priority": "Medium", "tags": [],
            "parentTaskId": parent["id"], "status": "backlog",
        },
        headers=H,
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "backlog"
