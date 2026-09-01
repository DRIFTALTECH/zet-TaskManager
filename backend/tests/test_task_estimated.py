"""Optional estimatedHours on create + patch."""
from conftest import make_project, make_user_story


def test_estimated_hours_optional_and_editable(client, manager):
    user, H = manager
    pid = make_project(client, H, name="Est")["id"]
    sid = client.post(f"/projects/{pid}/sections", json={"name": "S"}, headers=H).json()["sections"][0]["id"]
    usid = make_user_story(client, H, pid, sid)["id"]
    created = client.post(
        "/tasks",
        json={
            "title": "Est task",
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
    assert created.status_code == 200, created.text
    assert created.json()["estimatedHours"] is None

    with_est = client.post(
        "/tasks",
        json={
            "title": "Est 4h",
            "projectId": pid,
            "sectionId": sid,
            "assigneeIds": [user["id"]],
            "assignedBy": user["id"],
            "createdBy": user["id"],
            "dueDate": "2026-07-01",
            "priority": "Medium",
            "tags": [],
            "userStoryId": usid,
            "estimatedHours": 4.5,
        },
        headers=H,
    )
    assert with_est.status_code == 200, with_est.text
    assert with_est.json()["estimatedHours"] == 4.5
    tid = with_est.json()["id"]

    patched = client.patch(f"/tasks/{tid}", json={"estimatedHours": 8}, headers=H)
    assert patched.status_code == 200, patched.text
    assert patched.json()["estimatedHours"] == 8.0

    cleared = client.patch(f"/tasks/{tid}", json={"estimatedHours": None}, headers=H)
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["estimatedHours"] is None
