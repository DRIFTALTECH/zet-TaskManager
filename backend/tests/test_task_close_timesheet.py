"""Closing a task with hours puts those hours on the closer's timesheet."""
from datetime import date

from conftest import make_project, make_user_story


def _make_task(client, H, user, pid, sid, usid, title="Close me"):
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
            "userStoryId": usid,
        },
        headers=H,
    )
    assert r.status_code == 200, r.text
    return r.json()


def _setup(client, H, user, name):
    pid = make_project(client, H, name=name)["id"]
    sid = client.post(f"/projects/{pid}/sections", json={"name": "S"}, headers=H).json()["sections"][0]["id"]
    usid = make_user_story(client, H, pid, sid)["id"]
    return pid, sid, usid


def _entries_today(client, H):
    today = date.today().isoformat()
    r = client.get(f"/timesheet/entries?start={today}&end={today}", headers=H)
    assert r.status_code == 200, r.text
    return r.json()


def test_actual_hours_land_on_the_timesheet(client, manager):
    user, H = manager
    pid, sid, usid = _setup(client, H, user, "CloseTS")
    task = _make_task(client, H, user, pid, sid, usid)

    before = len(_entries_today(client, H))

    r = client.patch(
        f"/tasks/{task['id']}",
        json={"status": "completed", "actualHours": 2.5},
        headers=H,
    )
    assert r.status_code == 200, r.text
    assert r.json()["timeTracked"] == 9000

    rows = [e for e in _entries_today(client, H) if e["taskId"] == task["id"]]
    assert len(rows) == 1
    assert rows[0]["seconds"] == 9000
    assert rows[0]["description"] == "Close me"
    assert rows[0]["projectId"] == pid and rows[0]["sectionId"] == sid
    assert len(_entries_today(client, H)) == before + 1


def test_hours_and_minutes_are_kept(client, manager):
    user, H = manager
    pid, sid, usid = _setup(client, H, user, "CloseHM")
    task = _make_task(client, H, user, pid, sid, usid, title="Ninety minutes")

    r = client.patch(
        f"/tasks/{task['id']}",
        json={"status": "completed", "actualHours": 1.5},
        headers=H,
    )
    assert r.status_code == 200, r.text

    row = next(e for e in _entries_today(client, H) if e["taskId"] == task["id"])
    assert row["seconds"] == 5400
    assert row["timeFrom"] != row["timeTo"]


def test_reclosing_replaces_the_row_instead_of_adding_one(client, manager):
    user, H = manager
    pid, sid, usid = _setup(client, H, user, "CloseTwice")
    task = _make_task(client, H, user, pid, sid, usid, title="Revised")

    client.patch(f"/tasks/{task['id']}", json={"status": "completed", "actualHours": 2}, headers=H)
    client.patch(f"/tasks/{task['id']}", json={"status": "completed", "actualHours": 3}, headers=H)

    rows = [e for e in _entries_today(client, H) if e["taskId"] == task["id"]]
    assert len(rows) == 1
    assert rows[0]["seconds"] == 10800


def test_closing_with_zero_hours_leaves_no_row(client, manager):
    user, H = manager
    pid, sid, usid = _setup(client, H, user, "CloseZero")
    task = _make_task(client, H, user, pid, sid, usid, title="Nothing logged")

    client.patch(f"/tasks/{task['id']}", json={"status": "completed", "actualHours": 0}, headers=H)

    rows = [e for e in _entries_today(client, H) if e["taskId"] == task["id"]]
    assert rows == []


def test_task_rows_do_not_overlap_on_the_same_day(client, manager):
    user, H = manager
    pid, sid, usid = _setup(client, H, user, "CloseStack")
    a = _make_task(client, H, user, pid, sid, usid, title="First")
    b = _make_task(client, H, user, pid, sid, usid, title="Second")

    client.patch(f"/tasks/{a['id']}", json={"status": "completed", "actualHours": 2}, headers=H)
    client.patch(f"/tasks/{b['id']}", json={"status": "completed", "actualHours": 1}, headers=H)

    rows = {e["taskId"]: e for e in _entries_today(client, H) if e["taskId"] in (a["id"], b["id"])}
    assert len(rows) == 2
    assert rows[a["id"]]["timeTo"] <= rows[b["id"]]["timeFrom"]
