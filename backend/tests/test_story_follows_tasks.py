"""A story tracks the work underneath it: start a task, the story starts too."""
from conftest import make_project, make_user_story


def _setup(client, H, user, name):
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


def test_moving_a_task_to_in_progress_moves_its_story(client, manager):
    user, H = manager
    pid, sid, story = _setup(client, H, user, "Follows")
    task = _task(client, H, user, pid, sid, story["id"])
    assert _story(client, H, story["id"])["status"] == "backlog"

    r = client.post(f"/tasks/{task['id']}/move", json={"status": "in_progress"}, headers=H)
    assert r.status_code == 200, r.text
    assert _story(client, H, story["id"])["status"] == "in_progress"


def test_one_task_done_does_not_finish_the_story(client, manager):
    user, H = manager
    pid, sid, story = _setup(client, H, user, "PartlyDone")
    a = _task(client, H, user, pid, sid, story["id"], title="A")
    _task(client, H, user, pid, sid, story["id"], title="B")

    client.post(f"/tasks/{a['id']}/move", json={"status": "done", "actualHours": 1}, headers=H)
    assert _story(client, H, story["id"])["status"] != "done"


def test_story_is_done_once_every_task_is(client, manager):
    user, H = manager
    pid, sid, story = _setup(client, H, user, "AllDone")
    a = _task(client, H, user, pid, sid, story["id"], title="A")
    b = _task(client, H, user, pid, sid, story["id"], title="B")

    client.post(f"/tasks/{a['id']}/move", json={"status": "done", "actualHours": 1}, headers=H)
    client.post(f"/tasks/{b['id']}/move", json={"status": "done", "actualHours": 1}, headers=H)
    assert _story(client, H, story["id"])["status"] == "done"


def test_a_task_returning_to_backlog_leaves_the_story_alone(client, manager):
    user, H = manager
    pid, sid, story = _setup(client, H, user, "NoRegress")
    task = _task(client, H, user, pid, sid, story["id"])

    client.post(f"/tasks/{task['id']}/move", json={"status": "in_progress"}, headers=H)
    client.post(f"/tasks/{task['id']}/move", json={"status": "backlog"}, headers=H)
    assert _story(client, H, story["id"])["status"] == "in_progress"


def test_patching_a_task_status_moves_the_story_too(client, manager):
    user, H = manager
    pid, sid, story = _setup(client, H, user, "ViaPatch")
    task = _task(client, H, user, pid, sid, story["id"])

    r = client.patch(f"/tasks/{task['id']}", json={"status": "in_review"}, headers=H)
    assert r.status_code == 200, r.text
    assert _story(client, H, story["id"])["status"] == "in_review"


def test_backfill_lifts_stories_left_behind_and_runs_once(client, manager):
    """Old data: the story predates the follow rule and sits in Backlog."""
    import crud.settings as settings_crud
    import database.init_db as init_db
    from database.database import SessionLocal

    user, H = manager
    pid, sid, story = _setup(client, H, user, "Backfill")
    task = _task(client, H, user, pid, sid, story["id"])
    client.post(f"/tasks/{task['id']}/move", json={"status": "in_progress"}, headers=H)

    # Put the story back where the old data would have left it.
    client.patch(f"/user-stories/{story['id']}", json={"status": "backlog"}, headers=H)
    assert _story(client, H, story["id"])["status"] == "backlog"

    db = SessionLocal()
    try:
        db.write("DELETE FROM app_settings WHERE key = 'story_status_backfill_v1'")
        db.commit()
    finally:
        db.close()

    init_db._migrate_story_status_from_tasks()
    assert _story(client, H, story["id"])["status"] == "in_progress"

    db = SessionLocal()
    try:
        assert settings_crud.get(db, "story_status_backfill_v1") == "done"
    finally:
        db.close()

    # A later, deliberate move back to Backlog must survive the next boot.
    client.patch(f"/user-stories/{story['id']}", json={"status": "backlog"}, headers=H)
    init_db._migrate_story_status_from_tasks()
    assert _story(client, H, story["id"])["status"] == "backlog"
