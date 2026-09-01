"""Lean GET /tasks vs full GET /tasks/{id}."""
from conftest import make_project, make_user_story


def test_task_list_omits_body_until_get_by_id(client, manager):
    user, H = manager
    pid = make_project(client, H, name="Lean")["id"]
    sid = client.post(f"/projects/{pid}/sections", json={"name": "S"}, headers=H).json()["sections"][0]["id"]
    usid = make_user_story(client, H, pid, sid)["id"]
    body = "A long description that must not ride on every board poll."
    created = client.post(
        "/tasks",
        json={
            "title": "Lean task",
            "description": body,
            "projectId": pid,
            "sectionId": sid,
            "assigneeIds": [user["id"]],
            "assignedBy": user["id"],
            "createdBy": user["id"],
            "dueDate": "2026-07-01",
            "priority": "Medium",
            "tags": ["keep"],
            "userStoryId": usid,
        },
        headers=H,
    )
    assert created.status_code == 200, created.text
    tid = created.json()["id"]
    assert created.json()["description"] == body
    patched = client.patch(f"/tasks/{tid}", json={"customFields": {"k": "v"}}, headers=H)
    assert patched.status_code == 200, patched.text

    listed = client.get("/tasks", headers=H)
    assert listed.status_code == 200, listed.text
    row = next(t for t in listed.json() if t["id"] == tid)
    assert row["title"] == "Lean task"
    assert row["description"] == ""
    assert row["timeLog"] == {}
    assert row["tags"] == []
    assert row["customFields"] == {}

    full = client.get(f"/tasks/{tid}", headers=H)
    assert full.status_code == 200, full.text
    assert full.json()["description"] == body
    assert full.json()["tags"] == ["keep"]
    assert full.json()["customFields"] == {"k": "v"}
    assert client.get("/tasks/t_missing", headers=H).status_code == 404
