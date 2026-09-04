"""Clearing the board removes the work and leaves the workspace standing."""
import importlib.util
import pathlib
import sys

from conftest import make_project, make_user_story

_SCRIPT = pathlib.Path(__file__).resolve().parent.parent / "scripts" / "clear_work_items.py"


def _load():
    spec = importlib.util.spec_from_file_location("clear_work_items", _SCRIPT)
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


def test_it_clears_the_board_but_keeps_the_project(client, manager, monkeypatch):
    user, H = manager
    pid = make_project(client, H, name="Clear")["id"]
    sid = client.post(f"/projects/{pid}/sections", json={"name": "S"}, headers=H).json()["sections"][0]["id"]
    story = make_user_story(client, H, pid, sid, title="Epic")
    task = _task(client, H, user, pid, sid, "Task", story_id=story["id"])
    _task(client, H, user, pid, sid, "Sub", parent_id=task["id"])
    client.post(f"/tasks/{task['id']}/feedback", json={"message": "note"}, headers=H)

    mod = _load()
    monkeypatch.setattr(sys, "argv", ["clear", "--project", pid, "--apply", "--yes"])
    assert mod.main() == 0

    assert [t for t in client.get("/tasks", headers=H).json() if t["projectId"] == pid] == []
    assert [s for s in client.get("/user-stories", headers=H).json() if s["projectId"] == pid] == []
    # The workspace itself is untouched.
    projects = client.get("/projects", headers=H).json()
    kept = next(p for p in projects if p["id"] == pid)
    assert kept["sections"], "sections should survive the clear"


def test_a_dry_run_deletes_nothing(client, manager, monkeypatch):
    user, H = manager
    pid = make_project(client, H, name="ClearDry")["id"]
    sid = client.post(f"/projects/{pid}/sections", json={"name": "S"}, headers=H).json()["sections"][0]["id"]
    _task(client, H, user, pid, sid, "Survivor")

    mod = _load()
    monkeypatch.setattr(sys, "argv", ["clear", "--project", pid])
    assert mod.main() == 0

    assert [t for t in client.get("/tasks", headers=H).json() if t["projectId"] == pid] != []
