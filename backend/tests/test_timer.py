"""Server-side work timer: start records a run, stop logs elapsed time."""

from datetime import datetime, timedelta, timezone


def _make_task(client, user, H):
    pid = client.post("/projects", json={"name": "TP", "description": ""}, headers=H).json()["id"]
    sid = client.post(f"/projects/{pid}/sections", json={"name": "S"}, headers=H).json()["sections"][0]["id"]
    return client.post("/tasks", json={
        "title": "T", "projectId": pid, "sectionId": sid,
        "assigneeIds": [user["id"]], "assignedBy": user["id"], "createdBy": user["id"],
        "dueDate": "2026-07-01", "priority": "Medium", "tags": [],
    }, headers=H).json()["id"]


def test_timer_start_stop_logs_time(client, manager):
    user, H = manager
    tid = _make_task(client, user, H)

    assert client.post(f"/tasks/{tid}/timer/start", headers=H).status_code == 200
    assert any(a["taskId"] == tid for a in client.get("/tasks/timers/active", headers=H).json())

    # Backdate the run so elapsed > 60s without sleeping.
    import crud.timers as timers_crud
    from database.database import SessionLocal
    db = SessionLocal()
    run = timers_crud.get(db, user["id"], tid)
    run.started_at = (datetime.now(timezone.utc) - timedelta(minutes=3)).isoformat()
    db.add(run); db.commit(); db.close()

    out = client.post(f"/tasks/{tid}/timer/stop", json={"tzOffset": 0}, headers=H).json()
    assert out["timeTracked"] >= 60
    assert not any(a["taskId"] == tid for a in client.get("/tasks/timers/active", headers=H).json())
