"""`delete_tasks.py` removes tasks only.

Tasks and stories share one table now, so "delete every task" is a delete of the
task-typed rows — a plain DELETE would take the stories with them.
"""
import importlib.util
import pathlib
import sys

from conftest import make_project, make_user_story

_SCRIPT = pathlib.Path(__file__).resolve().parent.parent / "scripts" / "delete_tasks.py"


def _load():
    spec = importlib.util.spec_from_file_location("delete_tasks", _SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


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


def test_it_deletes_every_task_and_keeps_the_stories(client, manager, monkeypatch):
    user, H = manager
    pid, sid = _setup(client, H, "DelTasks")
    story = make_user_story(client, H, pid, sid, title="Survivor")
    parent = _task(client, H, user, pid, sid, "Parent", story_id=story["id"])
    _task(client, H, user, pid, sid, "Sub", parent_id=parent["id"])

    mod = _load()
    monkeypatch.setattr(sys, "argv", ["delete_tasks", "--apply", "--yes"])
    assert mod.main() == 0

    assert client.get("/tasks", headers=H).json() == []
    titles = [s["title"] for s in client.get("/user-stories", headers=H).json()]
    assert "Survivor" in titles


def test_a_dry_run_deletes_nothing(client, manager, monkeypatch):
    user, H = manager
    pid, sid = _setup(client, H, "DelDry")
    _task(client, H, user, pid, sid, "Still here")

    mod = _load()
    monkeypatch.setattr(sys, "argv", ["delete_tasks"])
    assert mod.main() == 0

    assert [t["title"] for t in client.get("/tasks", headers=H).json()] == ["Still here"]
