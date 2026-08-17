"""User-story forecast must stay separate from task forecast and respect project scope."""

from datetime import date, timedelta

from conftest import make_project


def test_user_story_forecast_excludes_other_managers_stories(client, manager, register):
    mgr, mh = manager
    other, oh = register("manager", email=f"usfc-other-{mgr['id']}@example.com", name="Other")

    mine = make_project(client, mh, name="MineUS", client_name="MineUSCo")["id"]
    theirs = make_project(client, oh, name="TheirsUS", client_name="TheirUSCo")["id"]
    my_sid = client.post(f"/projects/{mine}/sections", json={"name": "S"}, headers=mh).json()["sections"][0]["id"]
    their_sid = client.post(f"/projects/{theirs}/sections", json={"name": "S"}, headers=oh).json()["sections"][0]["id"]

    past_due = (date.today() - timedelta(days=3)).isoformat()
    client.post(
        "/user-stories",
        json={
            "projectId": mine,
            "sectionId": my_sid,
            "title": "My delayed story",
            "description": "Mine",
            "acceptanceCriteria": "",
            "priority": "High",
            "assigneeId": mgr["id"],
            "dueDate": past_due,
        },
        headers=mh,
    )
    client.post(
        "/user-stories",
        json={
            "projectId": theirs,
            "sectionId": their_sid,
            "title": "Their delayed story",
            "description": "Theirs",
            "acceptanceCriteria": "",
            "priority": "High",
            "assigneeId": other["id"],
            "dueDate": past_due,
        },
        headers=oh,
    )

    # Task with same due date must not appear in user-story forecast
    client.post(
        "/tasks",
        json={
            "title": "Standalone task only",
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

    data = client.get("/analytics/forecast/user-stories", headers=mh).json()
    assert data.get("level") == "user_story"

    titles = {
        t["title"]
        for emp in data.get("employees", [])
        for t in emp.get("tasks", [])
    }
    delayed_details = {
        t.get("taskName") or t.get("title")
        for d in data.get("deadlines", [])
        for t in (d.get("delayedTaskDetails") or d.get("tasks") or [])
    }

    assert "Their delayed story" not in titles
    assert "Their delayed story" not in delayed_details
    assert "Standalone task only" not in titles
    assert "Standalone task only" not in delayed_details
    assert "My delayed story" in titles or "My delayed story" in delayed_details


def test_task_and_user_story_forecasts_do_not_overlap(client, manager):
    mgr, mh = manager
    project = make_project(client, mh, name="BothLevels", client_name="BothCo")
    pid = project["id"]
    sid = client.post(f"/projects/{pid}/sections", json={"name": "S"}, headers=mh).json()["sections"][0]["id"]
    due = (date.today() + timedelta(days=5)).isoformat()

    story = client.post(
        "/user-stories",
        json={
            "projectId": pid,
            "sectionId": sid,
            "title": "Story only item",
            "description": "Story forecast unit",
            "acceptanceCriteria": "",
            "priority": "Medium",
            "assigneeId": mgr["id"],
            "dueDate": due,
        },
        headers=mh,
    ).json()

    client.post(
        "/tasks",
        json={
            "title": "Task only item",
            "projectId": pid,
            "sectionId": sid,
            "assigneeIds": [mgr["id"]],
            "assignedBy": mgr["id"],
            "createdBy": mgr["id"],
            "dueDate": due,
            "priority": "Medium",
            "tags": [],
            "userStoryId": story["id"],
        },
        headers=mh,
    )

    task_fc = client.get("/analytics/forecast", headers=mh).json()
    story_fc = client.get("/analytics/forecast/user-stories", headers=mh).json()

    task_titles = {
        t["title"]
        for emp in task_fc.get("employees", [])
        for t in emp.get("tasks", [])
    }
    story_titles = {
        t["title"]
        for emp in story_fc.get("employees", [])
        for t in emp.get("tasks", [])
    }

    assert "Task only item" in task_titles
    assert "Story only item" not in task_titles
    assert "Story only item" in story_titles
    assert "Task only item" not in story_titles

    # Section name should be present for recognition
    story_rows = [
        t
        for emp in story_fc.get("employees", [])
        for t in emp.get("tasks", [])
        if t["title"] == "Story only item"
    ]
    assert story_rows
    assert story_rows[0].get("sectionName")
