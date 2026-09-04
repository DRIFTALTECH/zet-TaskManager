"""The alignment script settles drift that predates the cascade."""
import importlib.util
import pathlib
import sys

from conftest import make_project

_SCRIPT = pathlib.Path(__file__).resolve().parent.parent / "scripts" / "align_child_statuses.py"


def _load():
    spec = importlib.util.spec_from_file_location("align_child_statuses", _SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


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


def _drift(task_id: str, status: str) -> None:
    """Set a status the way the old code would have: parent only."""
    from database.database import SessionLocal
    db = SessionLocal()
    try:
        db.write("UPDATE tasks SET status = %s WHERE id = %s", (status, task_id))
        db.commit()
    finally:
        db.close()


def _status(client, H, task_id):
    return client.get(f"/tasks/{task_id}", headers=H).json()["status"]


def test_it_pulls_a_stray_subtask_back_in_line(client, manager, monkeypatch):
    user, H = manager
    pid = make_project(client, H, name="Align")["id"]
    sid = client.post(f"/projects/{pid}/sections", json={"name": "S"}, headers=H).json()["sections"][0]["id"]
    task = _task(client, H, user, pid, sid, "Task")
    sub = _task(client, H, user, pid, sid, "Sub", parent_id=task["id"])

    _drift(task["id"], "testing")          # only the parent moved, as before
    assert _status(client, H, sub["id"]) == "backlog"

    mod = _load()
    monkeypatch.setattr(sys, "argv", ["align", "--project", pid, "--apply"])
    mod.main()

    assert _status(client, H, sub["id"]) == "testing"


def test_a_dry_run_writes_nothing(client, manager, monkeypatch):
    user, H = manager
    pid = make_project(client, H, name="AlignDry")["id"]
    sid = client.post(f"/projects/{pid}/sections", json={"name": "S"}, headers=H).json()["sections"][0]["id"]
    task = _task(client, H, user, pid, sid, "Task")
    sub = _task(client, H, user, pid, sid, "Sub", parent_id=task["id"])
    _drift(task["id"], "in_review")

    mod = _load()
    monkeypatch.setattr(sys, "argv", ["align", "--project", pid])
    mod.main()

    assert _status(client, H, sub["id"]) == "backlog"
