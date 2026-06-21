"""End-of-day standup recap: gathers today's tasks, time logs and timesheet rows.

The LLM pass is monkeypatched so the test is hermetic — we only assert the
data-gathering tallies and that the route wires logic → chain correctly.
"""

import uuid
from datetime import date, datetime, timezone


def _make_task(client, user, H):
    pid = client.post("/projects", json={"name": "DS", "description": ""}, headers=H).json()["id"]
    sid = client.post(f"/projects/{pid}/sections", json={"name": "S"}, headers=H).json()["sections"][0]["id"]
    tid = client.post("/tasks", json={
        "title": "Ship the recap", "projectId": pid, "sectionId": sid,
        "assigneeIds": [user["id"]], "assignedBy": user["id"], "createdBy": user["id"],
        "dueDate": "2026-07-01", "priority": "Medium", "tags": [],
    }, headers=H).json()["id"]
    return pid, sid, tid


def test_summarize_day_gathers_today(client, manager, monkeypatch):
    user, H = manager
    pid, sid, tid = _make_task(client, user, H)
    today = date.today().isoformat()

    import ai.chains as chains
    import crud.timelog as timelog_crud
    from database.database import SessionLocal
    from database.models import Task, TimesheetEntry

    # Mark the task started today + log time + add a billable timesheet row.
    db = SessionLocal()
    task = db.get(Task, tid)
    task.started_at = datetime.now(timezone.utc).isoformat()
    db.add(task); db.commit()
    timelog_crud.add_seconds(db, tid, today, 3600, user["id"])
    db.add(TimesheetEntry(
        id=uuid.uuid4().hex, user_id=user["id"], work_date=today,
        project_id=pid, section_id=sid, description="Reviewed PRs",
        time_from="09:00", time_to="09:30", seconds=1800, billable=True,
        created_at=datetime.now(timezone.utc).isoformat(),
    ))
    db.commit(); db.close()

    # Don't hit a real LLM.
    monkeypatch.setattr(chains, "summarize_day", lambda work_date, work_log: "You had a solid day.")

    out = client.get("/ai/summarize-day", headers=H).json()
    assert out["summary"] == "You had a solid day."
    assert out["taskCount"] == 1
    assert out["trackedSeconds"] == 3600
    assert out["timesheetSeconds"] == 1800
    assert out["billableSeconds"] == 1800
    assert out["hasData"] is True
    assert out["date"] == today


def test_summarize_day_empty(client, employee, monkeypatch):
    _user, H = employee
    import ai.chains as chains
    monkeypatch.setattr(chains, "summarize_day", lambda work_date, work_log: "Quiet day.")

    out = client.get("/ai/summarize-day", headers=H).json()
    assert out["hasData"] is False
    assert out["taskCount"] == 0
    assert out["trackedSeconds"] == 0
