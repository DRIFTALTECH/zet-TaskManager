from datetime import date, timedelta
from conftest import make_project


def test_forecast_visibility_toggle(client, manager):
    mgr, mh = manager
    mine = make_project(client, mh, name="VisibilityProj", client_name="VizCo")["id"]
    sid = client.post(f"/projects/{mine}/sections", json={"name": "S1"}, headers=mh).json()["sections"][0]["id"]
    past_due = (date.today() - timedelta(days=3)).isoformat()

    task_res = client.post(
        "/tasks",
        json={
            "title": "Visible Task",
            "projectId": mine,
            "sectionId": sid,
            "assigneeIds": [mgr["id"]],
            "assignedBy": mgr["id"],
            "createdBy": mgr["id"],
            "dueDate": past_due,
            "priority": "High",
            "tags": [],
        },
        headers=mh,
    ).json()
    tid = task_res["id"]

    # 1. Fetch initial forecast — hidden should be false
    data = client.get("/analytics/forecast", headers=mh).json()
    delayed_tasks = [t for d in data["deadlines"] for t in d.get("tasks", [])]
    matched = [t for t in delayed_tasks if t["taskId"] == tid]
    assert len(matched) == 1
    assert matched[0]["hidden"] is False

    # 2. Toggle visibility (hide it)
    res = client.post(
        "/analytics/forecast/visibility",
        json={"entityType": "task", "entityId": tid, "hidden": True},
        headers=mh,
    )
    assert res.status_code == 204

    # 3. Fetch forecast again — hidden should now be true
    data2 = client.get("/analytics/forecast", headers=mh).json()
    delayed_tasks2 = [t for d in data2["deadlines"] for t in d.get("tasks", [])]
    matched2 = [t for t in delayed_tasks2 if t["taskId"] == tid]
    assert len(matched2) == 1
    assert matched2[0]["hidden"] is True

    # 4. Toggle visibility (restore it)
    res2 = client.post(
        "/analytics/forecast/visibility",
        json={"entityType": "task", "entityId": tid, "hidden": False},
        headers=mh,
    )
    assert res2.status_code == 204

    # 5. Fetch forecast again — hidden should be false
    data3 = client.get("/analytics/forecast", headers=mh).json()
    delayed_tasks3 = [t for d in data3["deadlines"] for t in d.get("tasks", [])]
    matched3 = [t for t in delayed_tasks3 if t["taskId"] == tid]
    assert len(matched3) == 1
    assert matched3[0]["hidden"] is False
