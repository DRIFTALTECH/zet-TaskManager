"""The Backlog reset moves statuses and nothing else."""
import importlib.util
import pathlib
import sys

from conftest import make_project

_SCRIPT = pathlib.Path(__file__).resolve().parent.parent / "scripts" / "reset_status_to_backlog.py"


def _load():
    spec = importlib.util.spec_from_file_location("reset_status_to_backlog", _SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _task(client, H, user, pid, sid, title, status):
    r = client.post(
        "/tasks",
        json={
            "title": title, "projectId": pid, "sectionId": sid,
            "assigneeIds": [user["id"]], "assignedBy": user["id"], "createdBy": user["id"],
            "dueDate": "2026-07-01", "priority": "Medium", "tags": [],
        },
        headers=H,
    )
    assert r.status_code == 200, r.text
    tid = r.json()["id"]
    if status != "backlog":
        client.post(f"/tasks/{tid}/move", json={"status": status, "actualHours": 1}, headers=H)
    return tid


def test_reset_moves_open_work_and_leaves_completed_alone(client, manager, monkeypatch):
    user, H = manager
    pid = make_project(client, H, name="Reset")["id"]
    sid = client.post(f"/projects/{pid}/sections", json={"name": "S"}, headers=H).json()["sections"][0]["id"]

    moving = _task(client, H, user, pid, sid, "In progress", "in_progress")
    done = _task(client, H, user, pid, sid, "Done", "done")
    finished = _task(client, H, user, pid, sid, "Completed", "done")
    client.post(f"/tasks/{finished}/approve", json={"actualHours": 1}, headers=H)

    mod = _load()
    monkeypatch.setattr(sys, "argv", ["reset", "--project", pid, "--apply"])
    mod.main()

    def status_of(tid: str) -> str:
        return client.get(f"/tasks/{tid}", headers=H).json()["status"]

    assert status_of(moving) == "backlog"
    assert status_of(done) == "backlog"
    # Approved-and-closed work is not "somewhere on the board"; it stays put.
    assert status_of(finished) == "completed"


def test_a_dry_run_writes_nothing(client, manager, monkeypatch):
    user, H = manager
    pid = make_project(client, H, name="ResetDry")["id"]
    sid = client.post(f"/projects/{pid}/sections", json={"name": "S"}, headers=H).json()["sections"][0]["id"]
    tid = _task(client, H, user, pid, sid, "Still moving", "in_progress")

    mod = _load()
    monkeypatch.setattr(sys, "argv", ["reset", "--project", pid])
    mod.main()

    assert client.get(f"/tasks/{tid}", headers=H).json()["status"] == "in_progress"
