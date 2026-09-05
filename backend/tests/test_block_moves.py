"""Proves the reported bug is fixed: a block moves whole, in both directions."""
from conftest import make_project, make_user_story


def _setup(client, H, name):
    pid = make_project(client, H, name=name)["id"]
    sid = client.post(f"/projects/{pid}/sections", json={"name": "S"}, headers=H).json()["sections"][0]["id"]
    return pid, sid


def _task(client, H, user, pid, sid, title, story_id=None, parent_id=None):
    body = {"title": title, "projectId": pid, "sectionId": sid,
            "assigneeIds": [user["id"]], "assignedBy": user["id"], "createdBy": user["id"],
            "dueDate": "2026-07-01", "priority": "Medium", "tags": []}
    if story_id: body["userStoryId"] = story_id
    if parent_id: body["parentTaskId"] = parent_id
    r = client.post("/tasks", json=body, headers=H)
    assert r.status_code == 200, r.text
    return r.json()


def _ts(client, H, tid): return client.get(f"/tasks/{tid}", headers=H).json()
def _ss(client, H, sid): return client.get(f"/user-stories/{sid}", headers=H).json()["status"]


def _tree(client, H, user, pid, sid, tag):
    """parent story > child story > grandchild story, each carrying a task+subtask."""
    parent = make_user_story(client, H, pid, sid, title=f"{tag} parent")
    child = make_user_story(client, H, pid, sid, title=f"{tag} child")
    grand = make_user_story(client, H, pid, sid, title=f"{tag} grand")
    client.patch(f"/user-stories/{child['id']}", json={"parentStoryId": parent["id"]}, headers=H)
    client.patch(f"/user-stories/{grand['id']}", json={"parentStoryId": child["id"]}, headers=H)
    tasks = {}
    for label, st in (("parent", parent), ("child", child), ("grand", grand)):
        t = _task(client, H, user, pid, sid, f"{tag} {label} task", story_id=st["id"])
        s = _task(client, H, user, pid, sid, f"{tag} {label} sub", story_id=st["id"], parent_id=t["id"])
        tasks[label] = (t["id"], s["id"])
    return parent, child, grand, tasks


def test_the_reported_bug_nested_stories_travel_with_their_parent(client, manager):
    user, H = manager
    pid, sid = _setup(client, H, "BlockMove")
    parent, child, grand, tasks = _tree(client, H, user, pid, sid, "A")

    r = client.patch(f"/user-stories/{parent['id']}", json={"status": "in_review"}, headers=H)
    assert r.status_code == 200, r.text

    assert _ss(client, H, parent["id"]) == "in_review"
    assert _ss(client, H, child["id"]) == "in_review", "sub-story left behind"
    assert _ss(client, H, grand["id"]) == "in_review", "grandchild story left behind"
    for label, (tid, subid) in tasks.items():
        assert _ts(client, H, tid)["status"] == "in_review", f"{label} task left behind"
        assert _ts(client, H, subid)["status"] == "in_review", f"{label} subtask left behind"


def test_dragging_the_block_into_done_finishes_all_of_it(client, manager):
    user, H = manager
    pid, sid = _setup(client, H, "BlockDone")
    parent, child, grand, tasks = _tree(client, H, user, pid, sid, "B")

    client.patch(f"/user-stories/{parent['id']}", json={"status": "completed"}, headers=H)

    assert _ss(client, H, child["id"]) == "completed"
    assert _ss(client, H, grand["id"]) == "completed"
    for label, (tid, subid) in tasks.items():
        for tid_ in (tid, subid):
            row = _ts(client, H, tid_)
            assert row["status"] == "completed", f"{label} {tid_} not completed"
            assert row.get("completedAt"), f"{label} {tid_} has no completion stamp"


def test_dragging_the_block_back_out_of_done_reopens_all_of_it(client, manager):
    user, H = manager
    pid, sid = _setup(client, H, "BlockReopen")
    parent, child, grand, tasks = _tree(client, H, user, pid, sid, "C")

    client.patch(f"/user-stories/{parent['id']}", json={"status": "completed"}, headers=H)
    client.patch(f"/user-stories/{parent['id']}", json={"status": "in_progress"}, headers=H)

    assert _ss(client, H, child["id"]) == "in_progress"
    assert _ss(client, H, grand["id"]) == "in_progress"
    for label, (tid, subid) in tasks.items():
        for tid_ in (tid, subid):
            row = _ts(client, H, tid_)
            assert row["status"] == "in_progress", f"{label} {tid_} stayed finished"
            assert not row.get("completedAt"), f"{label} {tid_} kept a stale completion date"


def test_work_outside_the_block_is_never_touched(client, manager):
    user, H = manager
    pid, sid = _setup(client, H, "BlockOutside")
    parent, child, grand, tasks = _tree(client, H, user, pid, sid, "D")
    loose = _task(client, H, user, pid, sid, "Unrelated")
    sibling = make_user_story(client, H, pid, sid, title="Unrelated story")

    client.patch(f"/user-stories/{parent['id']}", json={"status": "in_review"}, headers=H)

    assert _ts(client, H, loose["id"])["status"] == "backlog"
    assert _ss(client, H, sibling["id"]) != "in_review"


def test_already_finished_work_keeps_the_day_it_finished(client, manager):
    user, H = manager
    pid, sid = _setup(client, H, "BlockStamp")
    story = make_user_story(client, H, pid, sid, title="E parent")
    early = _task(client, H, user, pid, sid, "Finished earlier", story_id=story["id"])
    client.post(f"/tasks/{early['id']}/move", json={"status": "done"}, headers=H)
    client.patch(f"/tasks/{early['id']}", json={"status": "completed"}, headers=H)
    stamped = _ts(client, H, early["id"]).get("completedAt")

    client.patch(f"/user-stories/{story['id']}", json={"status": "completed"}, headers=H)

    assert _ts(client, H, early["id"]).get("completedAt") == stamped, "re-stamped an old completion"


def test_a_task_carries_its_subtasks_out_of_done_too(client, manager):
    user, H = manager
    pid, sid = _setup(client, H, "TaskReopen")
    parent = _task(client, H, user, pid, sid, "Parent")
    sub = _task(client, H, user, pid, sid, "Sub", parent_id=parent["id"])
    client.post(f"/tasks/{parent['id']}/move", json={"status": "done"}, headers=H)
    assert _ts(client, H, sub["id"])["status"] == "done"

    client.post(f"/tasks/{parent['id']}/move", json={"status": "in_progress"}, headers=H)
    assert _ts(client, H, sub["id"])["status"] == "in_progress", "subtask stayed in Done"


def test_dragging_to_done_does_not_approve_and_so_does_not_hide_the_cards(client, manager):
    """Reaching Done is not approval.

    The board keeps finished-but-unapproved work on screen so a manager can
    approve it there; anything carrying approvedByManager is treated as
    confirmed and drops off the board entirely. Stamping the approval while
    cascading made every task inside a story vanish the moment the story was
    dragged to Done.
    """
    user, H = manager
    pid, sid = _setup(client, H, "DoneNoApprove")
    parent, child, grand, tasks = _tree(client, H, user, pid, sid, "F")

    client.patch(f"/user-stories/{parent['id']}", json={"status": "done"}, headers=H)

    for label, (tid, subid) in tasks.items():
        for tid_ in (tid, subid):
            row = _ts(client, H, tid_)
            assert row["status"] == "done", f"{label} {tid_} did not move"
            assert not row.get("approvedByManager"), (
                f"{label} {tid_} was auto-approved, so the board hides it"
            )


def test_approving_a_story_really_does_approve_the_block(client, manager):
    """The one path where approval is meant to happen still does."""
    user, H = manager
    pid, sid = _setup(client, H, "ApproveBlock")
    parent, child, grand, tasks = _tree(client, H, user, pid, sid, "G")

    r = client.post(f"/user-stories/{parent['id']}/approve", headers=H)
    assert r.status_code == 200, r.text

    for label, (tid, subid) in tasks.items():
        for tid_ in (tid, subid):
            row = _ts(client, H, tid_)
            assert row["status"] == "completed", f"{label} {tid_} not completed"
            assert row.get("approvedByManager"), f"{label} {tid_} not approved"
