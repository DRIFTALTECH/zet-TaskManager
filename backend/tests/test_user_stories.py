"""Additive user-story APIs — must not break legacy tasks."""
from __future__ import annotations


def test_user_story_crud_and_progress(client, register):
    # Register manager + employee
    mgr, token = register("manager", email="us-mgr@example.com", name="Mgr")
    mgr_id = mgr["id"]
    emp, _ = register("employee", email="us-emp@example.com", name="Emp")
    emp_id = emp["id"]

    # Project + section
    r = client.post("/clients", headers=token, json={"name": "US Client"})
    assert r.status_code == 200, r.text
    client_id = r.json()["id"]
    r = client.post(
        "/projects",
        headers=token,
        json={"name": "US Proj", "description": "", "clientId": client_id},
    )
    assert r.status_code == 200, r.text
    project = r.json()
    pid = project["id"]
    r = client.post(f"/projects/{pid}/members", headers=token, json={"user_id": emp_id})
    assert r.status_code == 200, r.text
    r = client.post(f"/projects/{pid}/sections", headers=token, json={"name": "Sprint"})
    assert r.status_code == 200, r.text
    sid = r.json()["sections"][0]["id"]
    for s in r.json()["sections"]:
        if s["name"] == "Sprint":
            sid = s["id"]
            break

    # Task without story is rejected
    r = client.post(
        "/tasks",
        headers=token,
        json={
            "title": "Legacy task",
            "description": "",
            "projectId": pid,
            "sectionId": sid,
            "assigneeIds": [emp_id],
            "assignedBy": mgr_id,
            "createdBy": mgr_id,
            "dueDate": "2026-07-20",
            "priority": "Medium",
            "tags": [],
        },
    )
    assert r.status_code == 400, r.text

    # Create user story
    r = client.post(
        "/user-stories",
        headers=token,
        json={
            "projectId": pid,
            "sectionId": sid,
            "title": "As a user I can export reports",
            "description": "Long pasted requirements…\n\n## Spec\n- A\n- B",
            "acceptanceCriteria": "Given X when Y then Z",
            "priority": "High",
            "assigneeId": emp_id,
            "dueDate": "2026-08-01",
        },
    )
    assert r.status_code == 200, r.text
    story = r.json()
    assert story["assigneeIds"] == [emp_id]
    assert story["assigneeId"] == emp_id

    # Multi-assignee patch
    r = client.patch(
        f"/user-stories/{story['id']}",
        headers=token,
        json={"assigneeIds": [emp_id, mgr_id]},
    )
    assert r.status_code == 200, r.text
    assert set(r.json()["assigneeIds"]) == {emp_id, mgr_id}

    # Task under story + subtask
    r = client.post(
        "/tasks",
        headers=token,
        json={
            "title": "Build export API",
            "description": "",
            "projectId": pid,
            "sectionId": sid,
            "assigneeIds": [emp_id],
            "assignedBy": mgr_id,
            "createdBy": mgr_id,
            "dueDate": "2026-07-25",
            "priority": "High",
            "tags": [],
            "userStoryId": story["id"],
        },
    )
    assert r.status_code == 200, r.text
    parent = r.json()
    assert parent["userStoryId"] == story["id"]

    r = client.post(
        "/tasks",
        headers=token,
        json={
            "title": "Write CSV serializer",
            "description": "",
            "projectId": pid,
            "sectionId": sid,
            "assigneeIds": [mgr_id],
            "assignedBy": mgr_id,
            "createdBy": mgr_id,
            "dueDate": "2026-07-22",
            "priority": "Medium",
            "tags": [],
            "userStoryId": story["id"],
            "parentTaskId": parent["id"],
        },
    )
    assert r.status_code == 200, r.text
    sub = r.json()
    assert sub["parentTaskId"] == parent["id"]

    r = client.get(f"/user-stories/{story['id']}", headers=token)
    assert r.status_code == 200, r.text
    story2 = r.json()
    assert story2["taskCount"] == 1
    assert story2["subtaskCount"] == 1
    assert story2["progressPercent"] == 0.0

    # Complete subtask → progress updates
    r = client.patch(f"/tasks/{sub['id']}", headers=token, json={"status": "completed"})
    assert r.status_code == 200, r.text
    r = client.get(f"/user-stories/{story['id']}", headers=token)
    story3 = r.json()
    assert story3["completedSubtaskCount"] == 1
    assert story3["progressPercent"] == 50.0

    # List endpoints
    r = client.get(f"/projects/{pid}/user-stories", headers=token)
    assert r.status_code == 200
    assert any(x["id"] == story["id"] for x in r.json())
    r = client.get(f"/user-stories/{story['id']}/tasks", headers=token)
    assert r.status_code == 200
    assert len(r.json()) == 2

    # Legacy list still returns tasks
    r = client.get("/tasks", headers=token)
    assert r.status_code == 200
    ids = {t["id"] for t in r.json()}
    assert parent["id"] in ids

    # Confirm-generate creates only selected preview items (no AI call)
    r = client.post(
        f"/user-stories/{story['id']}/confirm-generate-tasks",
        headers=token,
        json={
            "replaceGenerated": False,
            "tasks": [
                {
                    "key": "t1",
                    "title": "AI Preview Task",
                    "description": "from confirm",
                    "priority": "Medium",
                    "subtasks": [
                        {"key": "s1", "title": "AI Preview Subtask", "description": ""},
                    ],
                }
            ],
        },
    )
    assert r.status_code == 200, r.text
    created = r.json()
    titles = {t["title"] for t in created}
    assert "AI Preview Task" in titles
    assert "AI Preview Subtask" in titles
    parent_ai = next(t for t in created if t["title"] == "AI Preview Task")
    assert parent_ai.get("parentTaskId") in (None, "")
    assert parent_ai.get("assigneeIds") == []  # unassigned until explicitly assigned
    sub_ai = next(t for t in created if t["title"] == "AI Preview Subtask")
    assert sub_ai["parentTaskId"] == parent_ai["id"]
    assert sub_ai.get("assigneeIds") == []

    # Inline "(sub task -> …)" in the title must become a nested child task
    r = client.post(
        f"/user-stories/{story['id']}/confirm-generate-tasks",
        headers=token,
        json={
            "replaceGenerated": False,
            "tasks": [
                {
                    "key": "t2",
                    "title": "add clockify sync from analytics ( sub task -> get clockify api key from clockify)",
                    "description": "",
                    "priority": "Medium",
                    "subtasks": [],
                }
            ],
        },
    )
    assert r.status_code == 200, r.text
    created2 = r.json()
    parent2 = next(t for t in created2 if t["title"] == "add clockify sync from analytics")
    assert parent2.get("parentTaskId") in (None, "")
    assert parent2.get("assigneeIds") == []
    sub2 = next(t for t in created2 if t["title"] == "get clockify api key from clockify")
    assert sub2["parentTaskId"] == parent2["id"]

    # Explicit assign=True applies story assignees
    r = client.post(
        f"/user-stories/{story['id']}/confirm-generate-tasks",
        headers=token,
        json={
            "replaceGenerated": False,
            "tasks": [
                {
                    "key": "t3",
                    "title": "Assigned Preview Task",
                    "description": "",
                    "priority": "Medium",
                    "assign": True,
                    "subtasks": [],
                }
            ],
        },
    )
    assert r.status_code == 200, r.text
    assigned = next(t for t in r.json() if t["title"] == "Assigned Preview Task")
    assert emp_id in assigned["assigneeIds"]

    # Attachment upload on story
    r = client.post(
        f"/user-stories/{story['id']}/attachments",
        headers=token,
        files={"file": ("notes.txt", b"hello requirements", "text/plain")},
    )
    assert r.status_code == 201, r.text
    att = r.json()
    assert att["filename"] == "notes.txt"
    r = client.get(f"/user-stories/{story['id']}/attachments", headers=token)
    assert r.status_code == 200
    assert any(a["id"] == att["id"] for a in r.json())
