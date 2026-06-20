"""Role + visibility rules — the gates that matter most."""


def test_employee_cannot_create_project(client, employee):
    _user, H = employee
    r = client.post("/projects", json={"name": "Nope", "description": ""}, headers=H)
    assert r.status_code == 403  # ensure_manager


def test_manager_creates_project_and_is_member(client, manager):
    user, H = manager
    p = client.post("/projects", json={"name": "Proj", "description": ""}, headers=H).json()
    assert user["id"] in p["members"]  # creator auto-added


def test_visibility_is_member_scoped(client, manager, employee):
    _muser, MH = manager
    _euser, EH = employee
    pid = client.post("/projects", json={"name": "Private", "description": ""}, headers=MH).json()["id"]
    # Manager (member) sees it; employee (non-member) does not.
    assert any(p["id"] == pid for p in client.get("/projects", headers=MH).json())
    assert all(p["id"] != pid for p in client.get("/projects", headers=EH).json())
