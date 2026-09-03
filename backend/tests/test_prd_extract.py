"""PRD extract chain — stories with project-member assignment (no tasks)."""
import json

from ai.schemas import (
    ProjectRef,
    SectionRef,
    UserRef,
    PrdExtractedStory,
    PrdOutlineResponse,
    PrdOutlineStory,
)
from logic.prd_extract_logic import (
    match_project_section,
    _to_preview,
    snap_assignee_ids,
    ensure_story_assignee,
)


def _projects(**kwargs):
    return [
        ProjectRef(
            id="p1",
            name="ZET",
            sections=[SectionRef(id="s1", name="Platform"), SectionRef(id="s2", name="Mobile")],
            **kwargs,
        )
    ]


def _members():
    return [
        UserRef(id="u1", name="Ada", job_title="Backend", current_experience_months=36),
        UserRef(id="u2", name="Bob", job_title="Frontend", current_experience_months=8),
    ]


def test_acceptance_criteria_list_coerces_to_string():
    story = PrdExtractedStory.model_validate(
        {
            "title": "Overdue alerts",
            "acceptance_criteria": ["Count is returned", "Digest is emailed"],
        }
    )
    assert story.acceptance_criteria == "Count is returned\nDigest is emailed"


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


def test_preview_assigns_story_owner():
    story = PrdExtractedStory(
        title="Forecast view",
        description="Managers need at-risk work visible with overdue digests and filters.",
        acceptance_criteria="Board shows overdue stories\nDigest emails daily",
        priority="High",
        project_id="p1",
        project_name="ZET",
        section_id="s1",
        section_name="Platform",
        assignee_id="u1",
        assignee_name="Ada",
    )
    preview = _to_preview(story, _projects(members=_members()))
    assert preview is not None
    assert preview.projectId == "p1"
    assert preview.sectionId == "s1"
    assert preview.assigneeIds == ["u1"]
    assert preview.tasks == []


def test_snap_drops_invented_ids_then_fills_members():
    members = _members()
    assert snap_assignee_ids("nope", None, members) == []
    assert snap_assignee_ids(None, "ada", members) == ["u1"]
    assert ensure_story_assignee("invented", None, members, round_robin_index=0) == ["u1"]
    assert ensure_story_assignee(None, None, members, round_robin_index=1) == ["u2"]
    assert ensure_story_assignee(None, None, [], round_robin_index=0) == []


def test_extract_prd_preview_endpoint(client, manager, monkeypatch):
    _user, headers = manager
    from conftest import make_project

    proj = make_project(client, headers, name="ZET")

    def fake_outline(_text, projects):
        return PrdOutlineResponse(
            stories=[
                PrdOutlineStory(
                    title="Login",
                    description="Users sign in with email",
                    acceptance_criteria="Session is issued",
                    priority="Medium",
                    project_id=proj["id"],
                    project_name="ZET",
                    assignee_id=_user["id"],
                    assignee_name=_user["name"],
                )
            ]
        )

    monkeypatch.setattr("logic.prd_extract_logic.chains.outline_prd", fake_outline)
    res = client.post("/ai/extract-prd", data={"text": "PRD: users must log in."}, headers=headers)
    assert res.status_code == 200, res.text
    body = res.json()
    assert "sourceText" in body
    assert len(body["stories"]) == 1
    story = body["stories"][0]
    assert story["title"] == "Login"
    assert story["assigneeIds"] == [_user["id"]]
    assert story["projectId"] == proj["id"]
    assert not story.get("sectionId")
    assert story["tasks"] == []


def test_extract_prd_employee_forbidden(client, employee):
    _user, headers = employee
    res = client.post("/ai/extract-prd", data={"text": "A PRD"}, headers=headers)
    assert res.status_code == 403


def test_prd_import_analyze_stages_then_commit(client, manager, monkeypatch):
    _user, headers = manager
    from conftest import make_project

    proj = make_project(client, headers, name="ZET")
    sec = client.post(f"/projects/{proj['id']}/sections", json={"name": "Platform"}, headers=headers)
    assert sec.status_code == 200, sec.text

    def fake_outline(_text, projects):
        return PrdOutlineResponse(
            stories=[
                PrdOutlineStory(
                    title="Login",
                    description="Users sign in with email and stay signed in across sessions.",
                    acceptance_criteria="Session issued\nInvalid credentials rejected",
                    priority="High",
                    project_id=proj["id"],
                    project_name="ZET",
                    assignee_id=_user["id"],
                    assignee_name=_user["name"],
                )
            ]
        )

    monkeypatch.setattr("logic.prd_import_logic.chains.outline_prd", fake_outline)
    res = client.post("/prd-imports/analyze", data={"text": "PRD login"}, headers=headers)
    assert res.status_code == 200, res.text
    draft = res.json()
    assert draft["importId"]
    assert len(draft["stories"]) == 1
    story = draft["stories"][0]
    assert story["title"] == "Login"
    assert story["projectId"] == proj["id"]
    assert story["assigneeIds"] == [_user["id"]]
    assert story["tasks"] == []

    patched = client.patch(
        f"/prd-imports/items/{story['id']}",
        json={"title": "Login flow", "description": "Updated requirements"},
        headers=headers,
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["stories"][0]["title"] == "Login flow"

    committed = client.post("/prd-imports/commit", json={}, headers=headers)
    assert committed.status_code == 200, committed.text
    body = committed.json()
    assert body["storiesCreated"] == 1
    assert body["tasksCreated"] == 0
    assert len(body["storyIds"]) == 1

    leftover = client.get("/prd-imports/draft", headers=headers)
    assert leftover.status_code == 200
    assert leftover.json()["stories"] == []

    stories = client.get(f"/projects/{proj['id']}/user-stories", headers=headers)
    assert stories.status_code == 200
    saved = next(s for s in stories.json() if s["title"] == "Login flow")
    assert saved["assigneeIds"] == [_user["id"]]
    tasks = client.get(f"/user-stories/{saved['id']}/tasks", headers=headers)
    assert tasks.status_code == 200
    assert tasks.json() == []


def test_prd_import_analyze_stream(client, manager, monkeypatch):
    _user, headers = manager
    from conftest import make_project

    proj = make_project(client, headers, name="ZET")

    def fake_outline(_text, projects):
        return PrdOutlineResponse(
            stories=[
                PrdOutlineStory(
                    title="Login",
                    description="Users sign in",
                    acceptance_criteria="Session issued",
                    priority="High",
                    project_id=proj["id"],
                    project_name="ZET",
                    assignee_id=_user["id"],
                    assignee_name=_user["name"],
                )
            ]
        )

    monkeypatch.setattr("logic.prd_import_logic.chains.outline_prd", fake_outline)
    res = client.post("/prd-imports/analyze/stream", data={"text": "PRD login"}, headers=headers)
    assert res.status_code == 200, res.text
    events = []
    for block in res.text.split("\n\n"):
        line = next((ln for ln in block.split("\n") if ln.startswith("data:")), None)
        if not line:
            continue
        events.append(json.loads(line.split("data:", 1)[1].strip()))
    assert any(e.get("type") == "progress" and e.get("percent") >= 0 for e in events)
    stories = [e for e in events if e.get("type") == "story"]
    assert len(stories) == 1
    assert stories[0]["story"]["title"] == "Login"
    assert stories[0]["story"]["tasks"] == []
    assert stories[0]["story"]["assigneeIds"] == [_user["id"]]
    assert not any(e.get("type") == "tasks" for e in events)
    done = next(e for e in events if e.get("type") == "done")
    assert done["percent"] == 100
    assert done["draft"]["stories"][0]["title"] == "Login"
    assert done["draft"]["stories"][0]["tasks"] == []


def test_prd_import_employee_forbidden(client, employee):
    _user, headers = employee
    assert client.post("/prd-imports/analyze", data={"text": "PRD"}, headers=headers).status_code == 403
    assert client.get("/prd-imports/draft", headers=headers).status_code == 403


def test_prd_import_outline_then_commit_selected(client, manager, monkeypatch):
    _user, headers = manager
    from conftest import make_project

    proj = make_project(client, headers, name="ZET")
    sec = client.post(f"/projects/{proj['id']}/sections", json={"name": "Platform"}, headers=headers)
    assert sec.status_code == 200, sec.text

    def fake_outline(_text, projects):
        return PrdOutlineResponse(
            stories=[
                PrdOutlineStory(
                    title="Login",
                    description="Users sign in",
                    acceptance_criteria="Session issued",
                    priority="High",
                    project_id=proj["id"],
                    project_name="ZET",
                    assignee_id=_user["id"],
                    assignee_name=_user["name"],
                ),
                PrdOutlineStory(
                    title="Logout",
                    description="Users sign out",
                    acceptance_criteria="Session cleared",
                    priority="Medium",
                    project_id=proj["id"],
                    project_name="ZET",
                    assignee_id=_user["id"],
                    assignee_name=_user["name"],
                ),
            ]
        )

    monkeypatch.setattr("logic.prd_import_logic.chains.outline_prd", fake_outline)
    res = client.post("/prd-imports/analyze/stream", data={"text": "PRD auth"}, headers=headers)
    assert res.status_code == 200, res.text
    events = []
    for block in res.text.split("\n\n"):
        line = next((ln for ln in block.split("\n") if ln.startswith("data:")), None)
        if not line:
            continue
        events.append(json.loads(line.split("data:", 1)[1].strip()))
    story_evs = [e for e in events if e.get("type") == "story"]
    assert len(story_evs) == 2
    assert all(e["story"]["tasks"] == [] for e in story_evs)
    assert not any(e.get("type") == "tasks" for e in events)
    login_id = next(e["story"]["id"] for e in story_evs if e["story"]["title"] == "Login")
    committed = client.post(
        "/prd-imports/commit",
        json={"storyIds": [login_id], "taskIds": []},
        headers=headers,
    )
    assert committed.status_code == 200, committed.text
    assert committed.json()["storiesCreated"] == 1
    assert committed.json()["tasksCreated"] == 0
    leftover = client.get("/prd-imports/draft", headers=headers).json()
    assert len(leftover["stories"]) == 1
    assert leftover["stories"][0]["title"] == "Logout"
    assert leftover["stories"][0]["tasks"] == []
    created = client.get(f"/projects/{proj['id']}/user-stories", headers=headers).json()
    sid = next(s["id"] for s in created if s["title"] == "Login")
    tasks = client.get(f"/user-stories/{sid}/tasks", headers=headers).json()
    assert tasks == []


def test_prd_import_joins_multiple_files(client, manager, monkeypatch):
    _user, headers = manager
    from conftest import make_project

    make_project(client, headers, name="ZET")
    seen: list[str] = []

    def fake_outline(text, projects):
        seen.append(text)
        return PrdOutlineResponse(
            stories=[
                PrdOutlineStory(
                    title="Joined",
                    description="From two files",
                    acceptance_criteria="Both sources used",
                    priority="Medium",
                    project_id=None,
                    project_name="ZET",
                )
            ]
        )

    monkeypatch.setattr("logic.prd_import_logic.chains.outline_prd", fake_outline)
    res = client.post(
        "/prd-imports/analyze/stream",
        data={"text": "Cover note"},
        files=[
            ("files", ("alpha.txt", b"Alpha login requirement", "text/plain")),
            ("files", ("beta.txt", b"Beta logout requirement", "text/plain")),
        ],
        headers=headers,
    )
    assert res.status_code == 200, res.text
    assert seen, "outline should receive concatenated source"
    src = seen[0]
    assert "Cover note" in src
    assert "===== alpha.txt =====" in src
    assert "Alpha login requirement" in src
    assert "===== beta.txt =====" in src
    assert "Beta logout requirement" in src
    events = []
    for block in res.text.split("\n\n"):
        line = next((ln for ln in block.split("\n") if ln.startswith("data:")), None)
        if not line:
            continue
        events.append(json.loads(line.split("data:", 1)[1].strip()))
    assert any(e.get("type") == "story" and e["story"]["title"] == "Joined" for e in events)


def test_prd_generate_tasks_preview_does_not_save_story(client, manager, monkeypatch):
    _user, headers = manager
    from ai.schemas import PrdExtractedTask, PrdTaskBundle
    from conftest import make_project

    proj = make_project(client, headers, name="ZET")

    def fake_outline(_text, projects):
        return PrdOutlineResponse(
            stories=[
                PrdOutlineStory(
                    title="Login",
                    description="Users sign in",
                    acceptance_criteria="Session issued",
                    priority="High",
                    project_id=proj["id"],
                    project_name="ZET",
                    assignee_id=_user["id"],
                    assignee_name=_user["name"],
                )
            ]
        )

    def fake_expand(**_kwargs):
        return PrdTaskBundle(
            tasks=[PrdExtractedTask(title="Build login form", description="Email + password", priority="High")]
        )

    monkeypatch.setattr("logic.prd_import_logic.chains.outline_prd", fake_outline)
    monkeypatch.setattr("ai.chains.expand_story_tasks", fake_expand)

    staged = client.post("/prd-imports/analyze", data={"text": "PRD login"}, headers=headers)
    assert staged.status_code == 200, staged.text
    story = staged.json()["stories"][0]

    preview = client.post(f"/prd-imports/items/{story['id']}/generate-tasks", headers=headers)
    assert preview.status_code == 200, preview.text
    body = preview.json()
    assert body["storyId"] == story["id"]
    assert [t["title"] for t in body["tasks"]] == ["Build login form"]

    leftover = client.get("/prd-imports/draft", headers=headers)
    assert leftover.status_code == 200
    assert leftover.json()["stories"][0]["id"] == story["id"]

    live = client.get(f"/projects/{proj['id']}/user-stories", headers=headers)
    assert live.status_code == 200
    assert live.json() == []
