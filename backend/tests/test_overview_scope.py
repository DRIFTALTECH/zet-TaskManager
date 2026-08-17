"""Overview analytics must be scoped to the viewer's projects."""

from datetime import date, timedelta

from conftest import make_project


def _overview(client, headers):
    end = date.today()
    start = end - timedelta(days=29)
    return client.get(
        f"/analytics/overview?startDate={start.isoformat()}&endDate={end.isoformat()}",
        headers=headers,
    ).json()


def test_overview_counts_only_viewer_projects(client, manager, register):
    mgr, mh = manager
    other, oh = register("manager", email=f"other-{mgr['id']}@example.com", name="Other")

    mine = make_project(client, mh, name="Mine", client_name="MineCo")["id"]
    theirs = make_project(client, oh, name="Theirs", client_name="TheirCo")["id"]

    my_sid = client.post(f"/projects/{mine}/sections", json={"name": "S"}, headers=mh).json()["sections"][0]["id"]
    their_sid = client.post(f"/projects/{theirs}/sections", json={"name": "S"}, headers=oh).json()["sections"][0]["id"]

    client.post(
        "/tasks",
        json={
            "title": "My task",
            "projectId": mine,
            "sectionId": my_sid,
            "assigneeIds": [mgr["id"]],
            "assignedBy": mgr["id"],
            "createdBy": mgr["id"],
            "dueDate": "2026-12-01",
            "priority": "Medium",
            "tags": [],
        },
        headers=mh,
    )
    client.post(
        "/tasks",
        json={
            "title": "Their task",
            "projectId": theirs,
            "sectionId": their_sid,
            "assigneeIds": [other["id"]],
            "assignedBy": other["id"],
            "createdBy": other["id"],
            "dueDate": "2026-12-01",
            "priority": "High",
            "tags": [],
        },
        headers=oh,
    )

    data = _overview(client, mh)
    assert data["kpis"]["activeProjects"] == 1
    assert data["kpis"]["activeTasks"] == 1


def test_overview_project_filter(client, manager):
    mgr, mh = manager
    p1 = make_project(client, mh, name="P1", client_name="C1")["id"]
    p2 = make_project(client, mh, name="P2", client_name="C2")["id"]
    s1 = client.post(f"/projects/{p1}/sections", json={"name": "S"}, headers=mh).json()["sections"][0]["id"]
    s2 = client.post(f"/projects/{p2}/sections", json={"name": "S"}, headers=mh).json()["sections"][0]["id"]
    for pid, sid, title in ((p1, s1, "T1"), (p2, s2, "T2")):
        client.post(
            "/tasks",
            json={
                "title": title,
                "projectId": pid,
                "sectionId": sid,
                "assigneeIds": [mgr["id"]],
                "assignedBy": mgr["id"],
                "createdBy": mgr["id"],
                "dueDate": "2026-12-01",
                "priority": "Medium",
                "tags": [],
            },
            headers=mh,
        )

    end = date.today()
    start = end - timedelta(days=29)
    q = f"startDate={start.isoformat()}&endDate={end.isoformat()}"
    all_data = client.get(f"/analytics/overview?{q}", headers=mh).json()
    assert all_data["kpis"]["activeTasks"] == 2

    one = client.get(f"/analytics/overview?{q}&projectId={p1}", headers=mh).json()
    assert one["kpis"]["activeTasks"] == 1
    assert one["kpis"]["activeProjects"] == 1
