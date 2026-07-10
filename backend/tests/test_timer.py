"""Server-side work timer: start records a run, stop logs elapsed time."""

from datetime import datetime, timedelta, timezone

from conftest import make_project


def _make_task(client, user, H):
    pid = make_project(client, H, name="TP")["id"]
    sid = client.post(f"/projects/{pid}/sections", json={"name": "S"}, headers=H).json()["sections"][0]["id"]
    return client.post("/tasks", json={
        "title": "T", "projectId": pid, "sectionId": sid,
        "assigneeIds": [user["id"]], "assignedBy": user["id"], "createdBy": user["id"],
        "dueDate": "2026-07-01", "priority": "Medium", "tags": [],
    }, headers=H).json()["id"]


def _backdate_timer(user_id, task_id, *, minutes_ago: float):
    from database.database import SessionLocal

    db = SessionLocal()
    backdated = (datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)).isoformat()
    db.write(
        "UPDATE task_timer_runs SET started_at = %s WHERE user_id = %s AND task_id = %s",
        (backdated, user_id, task_id),
    )
    db.close()


def test_timer_start_stop_logs_time(client, manager):
    user, H = manager
    tid = _make_task(client, user, H)

    assert client.post(f"/tasks/{tid}/timer/start", headers=H).status_code == 200
    assert any(a["taskId"] == tid for a in client.get("/tasks/timers/active", headers=H).json())

    _backdate_timer(user["id"], tid, minutes_ago=3)

    out = client.post(f"/tasks/{tid}/timer/stop", json={"tzOffset": 0}, headers=H).json()
    assert out["timeTracked"] >= 60
    assert not any(a["taskId"] == tid for a in client.get("/tasks/timers/active", headers=H).json())


def test_task_min_log_minutes_manager_only_and_enforced(client, manager, employee):
    muser, MH = manager
    _euser, EH = employee

    tid = _make_task(client, muser, MH)
    created = next(t for t in client.get("/tasks", headers=MH).json() if t["id"] == tid)
    assert created["minLogMinutes"] == 1

    assert client.patch(f"/tasks/{tid}", json={"minLogMinutes": 5}, headers=EH).status_code == 403
    assert client.patch(f"/tasks/{tid}", json={"minLogMinutes": 5}, headers=MH).json()["minLogMinutes"] == 5

    # 3 min run is below the task's 5 min threshold → not logged.
    assert client.post(f"/tasks/{tid}/timer/start", headers=MH).status_code == 200
    _backdate_timer(muser["id"], tid, minutes_ago=3)
    out = client.post(f"/tasks/{tid}/timer/stop", json={"tzOffset": 0}, headers=MH).json()
    assert out["timeTracked"] == 0
