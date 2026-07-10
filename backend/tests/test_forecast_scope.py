"""Forecast must only include tasks from the viewer's projects."""

from datetime import date, timedelta

from conftest import make_project


def test_forecast_excludes_other_managers_tasks(client, manager):
    mgr, mh = manager
    other_reg = client.post(
        "/auth/register",
        json={
            "name": "Other",
            "email": f"fc-other-{mgr['id']}@t.test",
            "password": "secret123",
            "role": "manager",
        },
    ).json()
    other = other_reg["user"]
    oh = {"Authorization": f"Bearer {other_reg['access_token']}"}

    mine = make_project(client, mh, name="Mine", client_name="MineCo")["id"]
    theirs = make_project(client, oh, name="Theirs", client_name="TheirCo")["id"]
    my_sid = client.post(f"/projects/{mine}/sections", json={"name": "S"}, headers=mh).json()["sections"][0]["id"]
    their_sid = client.post(f"/projects/{theirs}/sections", json={"name": "S"}, headers=oh).json()["sections"][0]["id"]

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
