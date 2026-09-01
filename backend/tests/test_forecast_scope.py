"""Forecast must only include tasks from the viewer's projects."""

from datetime import date, timedelta

from conftest import make_project, make_user_story


def test_forecast_excludes_other_managers_tasks(client, manager, register):
    mgr, mh = manager
    other, oh = register("manager", email=f"fc-other-{mgr['id']}@example.com", name="Other")

    mine = make_project(client, mh, name="Mine", client_name="MineCo")["id"]
    theirs = make_project(client, oh, name="Theirs", client_name="TheirCo")["id"]
    my_sid = client.post(f"/projects/{mine}/sections", json={"name": "S"}, headers=mh).json()["sections"][0]["id"]
    their_sid = client.post(f"/projects/{theirs}/sections", json={"name": "S"}, headers=oh).json()["sections"][0]["id"]
    my_us = make_user_story(client, mh, mine, my_sid)["id"]
    their_us = make_user_story(client, oh, theirs, their_sid)["id"]

    past_due = (date.today() - timedelta(days=3)).isoformat()
    client.post(
        "/tasks",
        json={
            "title": "My delayed task",
            "projectId": mine,
            "sectionId": my_sid,
            "assigneeIds": [mgr["id"]],
            "assignedBy": mgr["id"],
            "createdBy": mgr["id"],
            "dueDate": past_due,
            "priority": "High",
            "tags": [],
            "userStoryId": my_us,
        },
        headers=mh,
    )
    client.post(
        "/tasks",
        json={
            "title": "Ship the recap",
            "projectId": theirs,
            "sectionId": their_sid,
            "assigneeIds": [other["id"]],
            "assignedBy": other["id"],
            "createdBy": other["id"],
            "dueDate": past_due,
            "priority": "High",
            "tags": [],
            "userStoryId": their_us,
        },
        headers=oh,
    )

    data = client.get("/analytics/forecast", headers=mh).json()
    prediction = data.get("prediction") or {}
    delayed = prediction.get("delayedTasks") or data.get("deadlineSummary", {}).get("delayedTasks", 0)
    task_titles = {
        t["title"]
        for emp in data.get("employees", [])
        for t in emp.get("tasks", [])
    }
    delayed_details = {
        t.get("taskName") or t.get("title")
        for d in data.get("deadlines", [])
        for t in (d.get("delayedTaskDetails") or d.get("tasks") or [])
    }

    assert delayed <= 1
    assert "Ship the recap" not in task_titles
    assert "Ship the recap" not in delayed_details
    assert "My delayed task" in task_titles or delayed >= 1


def test_forecast_excludes_done_and_dedupes_multi_assignee(client, manager, register):
    mgr, mh = manager
    emp, _ = register("employee", email=f"fc-emp-{mgr['id']}@example.com", name="EmpFC")

    project = make_project(client, mh, name="DedupProj", client_name="DedupCo")
    pid = project["id"]
    client.post(f"/projects/{pid}/members", headers=mh, json={"user_id": emp["id"]})
    sid = client.post(f"/projects/{pid}/sections", json={"name": "Sprint A"}, headers=mh).json()["sections"][0]["id"]
    usid = make_user_story(client, mh, pid, sid)["id"]
    due = (date.today() + timedelta(days=4)).isoformat()

    shared = client.post(
        "/tasks",
        json={
            "title": "Shared multi-assignee task",
            "projectId": pid,
            "sectionId": sid,
            "assigneeIds": [mgr["id"], emp["id"]],
            "assignedBy": mgr["id"],
            "createdBy": mgr["id"],
            "dueDate": due,
            "priority": "Medium",
            "tags": [],
            "userStoryId": usid,
        },
        headers=mh,
    ).json()

    done_task = client.post(
        "/tasks",
        json={
            "title": "Already done on board",
            "projectId": pid,
            "sectionId": sid,
            "assigneeIds": [mgr["id"]],
            "assignedBy": mgr["id"],
            "createdBy": mgr["id"],
            "dueDate": due,
            "priority": "High",
            "tags": [],
            "userStoryId": usid,
        },
        headers=mh,
    ).json()
    r = client.post(f"/tasks/{done_task['id']}/move", headers=mh, json={"status": "done"})
    assert r.status_code == 200, r.text

    data = client.get("/analytics/forecast", headers=mh).json()
    titles = [
        t["title"]
        for emp_row in data.get("employees", [])
        for t in emp_row.get("tasks", [])
    ]
    assert "Already done on board" not in titles

    deadline_titles = [
        t.get("taskName") or t.get("title")
        for d in data.get("deadlines", [])
        for t in (d.get("delayedTaskDetails") or d.get("tasks") or [])
    ]
    assert deadline_titles.count("Shared multi-assignee task") <= 1
    assert "Already done on board" not in deadline_titles
    assert titles.count("Shared multi-assignee task") >= 1
    assert shared["id"]
