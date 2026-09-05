"""Story moves leave a trace.

Nothing in the story flow was audited at all, so a whole block changing status —
and every approval inside it being cleared on the way out of Done — left no
record of who did it or when.
"""
from conftest import make_project, make_user_story


def _setup(client, H, name):
    pid = make_project(client, H, name=name)["id"]
    sid = client.post(f"/projects/{pid}/sections", json={"name": "S"}, headers=H).json()["sections"][0]["id"]
    return pid, sid


def _task(client, H, u, pid, sid, title, story=None, parent=None):
    b = {"title": title, "projectId": pid, "sectionId": sid, "assigneeIds": [u["id"]],
         "assignedBy": u["id"], "createdBy": u["id"], "dueDate": "2026-07-01",
         "priority": "Medium", "tags": []}
    if story: b["userStoryId"] = story
    if parent: b["parentTaskId"] = parent
    return client.post("/tasks", json=b, headers=H).json()


def _story_rows(client, H):
    rows = client.get("/audit?limit=200", headers=H).json()
    if not isinstance(rows, list):
        rows = rows.get("logs", rows.get("items", []))
    return [r for r in rows if str(r.get("action", "")).startswith("user_story.")]


def test_a_status_move_is_recorded_with_what_it_disturbed(client, manager):
    u, H = manager
    pid, sid = _setup(client, H, "AuditMove")
    parent = make_user_story(client, H, pid, sid, title="P")
    child = make_user_story(client, H, pid, sid, title="C")
    client.patch(f"/user-stories/{child['id']}", json={"parentStoryId": parent["id"]}, headers=H)
    _task(client, H, u, pid, sid, "t1", story=parent["id"])
    _task(client, H, u, pid, sid, "t2", story=child["id"])

    client.patch(f"/user-stories/{parent['id']}", json={"status": "in_review"}, headers=H)

    moves = [r for r in _story_rows(client, H) if r["action"] == "user_story.status_changed"]
    assert len(moves) == 1, moves
    d = moves[0]["details"]
    assert d["to"] == "in_review"
    assert d["subStoriesMoved"] == 1
    # Two tasks, counted once each. list_for_user_story reaches a sub-story's
    # tasks through the grandparent link, so a per-level tally said three.
    assert d["tasksMoved"] == 2, d


def test_clearing_approvals_on_the_way_out_of_done_is_recorded(client, manager):
    u, H = manager
    pid, sid = _setup(client, H, "AuditReopen")
    parent = make_user_story(client, H, pid, sid, title="P")
    child = make_user_story(client, H, pid, sid, title="C")
    client.patch(f"/user-stories/{child['id']}", json={"parentStoryId": parent["id"]}, headers=H)
    _task(client, H, u, pid, sid, "t1", story=parent["id"])
    _task(client, H, u, pid, sid, "t2", story=child["id"])
    client.post(f"/user-stories/{parent['id']}/approve", headers=H)

    client.patch(f"/user-stories/{parent['id']}", json={"status": "in_progress"}, headers=H)

    rows = _story_rows(client, H)
    approved = [r for r in rows if r["action"] == "user_story.approved"]
    assert len(approved) == 1, rows
    assert approved[0]["details"]["tasksApproved"] == 2

    reopen = [r for r in rows if r["action"] == "user_story.status_changed"][0]
    assert reopen["details"]["approvalsCleared"] == 2, reopen["details"]


def test_moving_into_done_reports_no_approvals_cleared(client, manager):
    u, H = manager
    pid, sid = _setup(client, H, "AuditDone")
    story = make_user_story(client, H, pid, sid, title="P")
    _task(client, H, u, pid, sid, "t1", story=story["id"])

    client.patch(f"/user-stories/{story['id']}", json={"status": "done"}, headers=H)

    move = [r for r in _story_rows(client, H) if r["action"] == "user_story.status_changed"][0]
    assert move["details"]["approvalsCleared"] == 0
