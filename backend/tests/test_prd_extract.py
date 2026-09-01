"""PRD extract chain — preview only, no assignees."""

from ai.schemas import ProjectRef, SectionRef, PrdExtractResponse, PrdExtractedStory, PrdExtractedTask
from logic.prd_extract_logic import match_project_section, _to_preview


def _projects():
    return [
        ProjectRef(
            id="p1",
            name="ZET",
            sections=[SectionRef(id="s1", name="Platform"), SectionRef(id="s2", name="Mobile")],
        )
    ]


def test_match_by_id():
    p, s = match_project_section(_projects(), "p1", None, "s2", None)
    assert p is not None and p.id == "p1"
    assert s is not None and s.id == "s2"


def test_match_by_name_case_insensitive():
    p, s = match_project_section(_projects(), None, "zet", None, "platform")
    assert p is not None and p.id == "p1"
    assert s is not None and s.id == "s1"


def test_match_single_project_when_unspecified():
    p, s = match_project_section(_projects(), None, None, None, None)
    assert p is not None and p.id == "p1"
    assert s is None  # two sections, do not guess


def test_preview_never_assigns_people():
    story = PrdExtractedStory(
        title="Forecast view",
        description="Managers need at-risk work visible",
        acceptance_criteria="Board shows overdue stories",
        priority="High",
        project_id="p1",
        project_name="ZET",
        section_id="s1",
        section_name="Platform",
        tasks=[
            PrdExtractedTask(title="API for forecast", description="Return at-risk stories", priority="High"),
            PrdExtractedTask(title="UI board", description="Render cards", priority="Medium"),
        ],
    )
    preview = _to_preview(story, _projects())
    assert preview is not None
    assert preview.assigneeIds == []
    assert preview.projectId == "p1"
    assert preview.sectionId is None
    assert all(t.assign is False for t in preview.tasks)
    assert [t.title for t in preview.tasks] == ["API for forecast", "UI board"]


def test_extract_prd_preview_endpoint(client, manager, monkeypatch):
    _user, headers = manager
    from conftest import make_project

    proj = make_project(client, headers, name="ZET")
    r = client.post(f"/projects/{proj['id']}/sections", json={"name": "Platform"}, headers=headers)
    assert r.status_code == 200, r.text
    section = next(s for s in r.json()["sections"] if s["name"] == "Platform")

    def fake_extract(_text, projects):
        return PrdExtractResponse(
            stories=[
                PrdExtractedStory(
                    title="Login",
                    description="Users sign in with email",
                    acceptance_criteria="Session is issued",
                    priority="Medium",
                    project_id=proj["id"],
                    project_name="ZET",
                    section_id=section["id"],
                    section_name="Platform",
                    tasks=[
                        PrdExtractedTask(title="Auth API", description="POST /auth/login", priority="Medium"),
                    ],
                )
            ]
        )

    monkeypatch.setattr("logic.prd_extract_logic.chains.extract_prd", fake_extract)
    res = client.post("/ai/extract-prd", data={"text": "PRD: users must log in."}, headers=headers)
    assert res.status_code == 200, res.text
    body = res.json()
    assert "sourceText" in body
    assert len(body["stories"]) == 1
    story = body["stories"][0]
    assert story["title"] == "Login"
    assert story["assigneeIds"] == []
    assert story["projectId"] == proj["id"]
    assert not story.get("sectionId")
    assert story["tasks"][0]["assign"] is False
    assert story["tasks"][0]["title"] == "Auth API"


def test_extract_prd_employee_forbidden(client, employee):
    _user, headers = employee
    res = client.post("/ai/extract-prd", data={"text": "A PRD"}, headers=headers)
    assert res.status_code == 403


def test_prd_import_analyze_stages_then_commit(client, manager, monkeypatch):
    _user, headers = manager
    from conftest import make_project

    proj = make_project(client, headers, name="ZET")
    r = client.post(f"/projects/{proj['id']}/sections", json={"name": "Platform"}, headers=headers)
    section = next(s for s in r.json()["sections"] if s["name"] == "Platform")

    def fake_extract(_text, projects):
        return PrdExtractResponse(
            stories=[
                PrdExtractedStory(
                    title="Login",
                    description="Users sign in",
                    acceptance_criteria="Session issued",
                    priority="High",
                    project_id=proj["id"],
                    project_name="ZET",
                    section_id=section["id"],
                    section_name="Platform",
                    tasks=[
                        PrdExtractedTask(title="Auth API", description="POST /auth/login", priority="High"),
                    ],
                )
            ]
        )

    monkeypatch.setattr("logic.prd_extract_logic.chains.extract_prd", fake_extract)
    res = client.post("/prd-imports/analyze", data={"text": "PRD login"}, headers=headers)
    assert res.status_code == 200, res.text
    draft = res.json()
    assert draft["importId"]
    assert len(draft["stories"]) == 1
    story = draft["stories"][0]
    assert story["title"] == "Login"
    assert story["projectId"] == proj["id"]
    task_id = story["tasks"][0]["id"]

    patched = client.patch(
        f"/prd-imports/items/{task_id}",
        json={"title": "Auth API v2", "description": "Updated"},
        headers=headers,
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["stories"][0]["tasks"][0]["title"] == "Auth API v2"

    committed = client.post("/prd-imports/commit", headers=headers)
    assert committed.status_code == 200, committed.text
    body = committed.json()
    assert body["storiesCreated"] == 1
    assert body["tasksCreated"] >= 1

    leftover = client.get("/prd-imports/draft", headers=headers)
    assert leftover.status_code == 200
    assert leftover.json()["stories"] == []

    stories = client.get(f"/projects/{proj['id']}/user-stories", headers=headers)
    assert stories.status_code == 200
    assert any(s["title"] == "Login" for s in stories.json())
    sid = next(s["id"] for s in stories.json() if s["title"] == "Login")
    tasks = client.get(f"/user-stories/{sid}/tasks", headers=headers)
    assert tasks.status_code == 200
    created = tasks.json()
    assert any(t["title"] == "Auth API v2" for t in created)
    for t in created:
        assert t.get("assigneeIds") in ([], None)


def test_prd_import_employee_forbidden(client, employee):
    _user, headers = employee
    assert client.post("/prd-imports/analyze", data={"text": "PRD"}, headers=headers).status_code == 403
    assert client.get("/prd-imports/draft", headers=headers).status_code == 403

