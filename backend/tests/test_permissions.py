"""Role + visibility rules — the gates that matter most."""

from conftest import make_project


def _make_task(client, headers, *, creator_id: str, assignee_id: str, project_id: str):
    sid = client.post(
        f"/projects/{project_id}/sections", json={"name": "S"}, headers=headers,
    ).json()["sections"][0]["id"]
    r = client.post("/tasks", json={
        "title": "T", "projectId": project_id, "sectionId": sid,
        "assigneeIds": [assignee_id], "assignedBy": creator_id, "createdBy": creator_id,
        "dueDate": "2026-07-01", "priority": "Medium", "tags": [],
    }, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()["id"]


def test_employee_cannot_create_project(client, employee):
    _user, H = employee
    r = client.post("/projects", json={"name": "Nope", "description": "", "clientId": "c1"}, headers=H)
    assert r.status_code == 403  # ensure_manager


def test_manager_creates_project_and_is_member(client, manager):
    user, H = manager
    p = make_project(client, H, name="Proj")
    assert user["id"] in p["members"]  # creator auto-added


def test_visibility_is_member_scoped(client, manager, employee):
    _muser, MH = manager
    _euser, EH = employee
    pid = make_project(client, MH, name="Private")["id"]
    # Manager (member) sees it; employee (non-member) does not.
    assert any(p["id"] == pid for p in client.get("/projects", headers=MH).json())
    assert all(p["id"] != pid for p in client.get("/projects", headers=EH).json())


def test_non_creator_cannot_delete_task(client, manager, employee):
    muser, MH = manager
    euser, EH = employee
    pid = make_project(client, MH, name="Del")["id"]
    client.post(f"/projects/{pid}/members", json={"user_id": euser["id"]}, headers=MH)
    tid = _make_task(client, MH, creator_id=muser["id"], assignee_id=euser["id"], project_id=pid)
    r = client.delete(f"/tasks/{tid}", headers=EH)
    assert r.status_code == 403


def test_creator_can_delete_own_task(client, manager):
    muser, MH = manager
    pid = make_project(client, MH, name="Own")["id"]
    tid = _make_task(client, MH, creator_id=muser["id"], assignee_id=muser["id"], project_id=pid)
    assert client.delete(f"/tasks/{tid}", headers=MH).status_code == 204


def test_superadmin_can_delete_any_task(client, manager, superadmin):
    muser, MH = manager
    _suser, SH = superadmin
    pid = make_project(client, MH, name="Any")["id"]
    tid = _make_task(client, MH, creator_id=muser["id"], assignee_id=muser["id"], project_id=pid)
    assert client.delete(f"/tasks/{tid}", headers=SH).status_code == 204


def test_project_member_can_edit_any_task_field(client, manager, employee):
    muser, MH = manager
    euser, EH = employee
    pid = make_project(client, MH, name="Edit")["id"]
    client.post(f"/projects/{pid}/members", json={"user_id": euser["id"]}, headers=MH)
    tid = _make_task(client, MH, creator_id=muser["id"], assignee_id=muser["id"], project_id=pid)
    r = client.patch(f"/tasks/{tid}", headers=EH, json={
        "title": "Renamed",
        "description": "Updated",
        "priority": "High",
        "sprint": "Week 1",
        "dueDate": "2026-08-30",
        "tags": ["Phase:Build"],
        "startedAt": "2026-08-01",
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["title"] == "Renamed"
    assert body["description"] == "Updated"
    assert body["priority"] == "High"
    assert body["sprint"] == "Week 1"
    assert body["dueDate"] == "2026-08-30"
    assert body["tags"] == ["Phase:Build"]
    assert (body.get("startedAt") or "").startswith("2026-08-01")
