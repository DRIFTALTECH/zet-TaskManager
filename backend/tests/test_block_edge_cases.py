"""Edge cases for moving a block around the board.

Each case records what it expected beside what actually happened, so a failure
names the case rather than just the assertion. The visibility checks mirror the
frontend's isTaskConfirmed / isStoryConfirmed: work that reads as confirmed is
removed from the board entirely, which is how a cascade that auto-approved made
every card inside a story vanish on the way into Done.
"""
from conftest import make_project, make_user_story

R = []
def rec(case, exp, obs): R.append((case, exp, obs, "PASS" if exp == obs else "FAIL"))

def _setup(c, H, n):
    pid = make_project(c, H, name=n)["id"]
    sid = c.post(f"/projects/{pid}/sections", json={"name": "S"}, headers=H).json()["sections"][0]["id"]
    return pid, sid

def _task(c, H, u, pid, sid, title, story_id=None, parent_id=None):
    b = {"title": title, "projectId": pid, "sectionId": sid, "assigneeIds": [u["id"]],
         "assignedBy": u["id"], "createdBy": u["id"], "dueDate": "2026-07-01",
         "priority": "Medium", "tags": []}
    if story_id: b["userStoryId"] = story_id
    if parent_id: b["parentTaskId"] = parent_id
    return c.post("/tasks", json=b, headers=H).json()

def T(c, H, i): return c.get(f"/tasks/{i}", headers=H).json()
def S(c, H, i): return c.get(f"/user-stories/{i}", headers=H).json()
def mvS(c, H, i, s): return c.patch(f"/user-stories/{i}", json={"status": s}, headers=H)
def mvT(c, H, i, s): return c.post(f"/tasks/{i}/move", json={"status": s}, headers=H)

# Mirrors frontend isTaskConfirmed / isStoryConfirmed — confirmed work leaves the board.
def hidden_task(row): return row["status"] == "completed" or bool(row.get("approvedByManager"))
def hidden_story(row): return row["status"] == "completed" or bool(row.get("approvedByManager"))


def test_probe(client, manager, employee):
    u, H = manager
    emp, EH = employee
    pid, sid = _setup(client, H, "P2")
    pid2, sid2 = _setup(client, H, "P2b")

    # ── A. the reported bug: drag a block to the 'done' column ───────────────
    p = make_user_story(client, H, pid, sid, title="A p")
    c1 = make_user_story(client, H, pid, sid, title="A c")
    client.patch(f"/user-stories/{c1['id']}", json={"parentStoryId": p["id"]}, headers=H)
    t1 = _task(client, H, u, pid, sid, "A t1", story_id=p["id"])
    s1 = _task(client, H, u, pid, sid, "A s1", story_id=p["id"], parent_id=t1["id"])
    t2 = _task(client, H, u, pid, sid, "A t2", story_id=c1["id"])
    mvS(client, H, p["id"], "done")
    rec("A1 parent story -> done", "done", S(client, H, p["id"])["status"])
    rec("A2 sub-story -> done", "done", S(client, H, c1["id"])["status"])
    rec("A3 task -> done", "done", T(client, H, t1["id"])["status"])
    rec("A4 subtask -> done", "done", T(client, H, s1["id"])["status"])
    rec("A5 sub-story's task -> done", "done", T(client, H, t2["id"])["status"])
    rec("A6 task NOT auto-approved", False, bool(T(client, H, t1["id"]).get("approvedByManager")))
    rec("A7 task STILL VISIBLE on board", False, hidden_task(T(client, H, t1["id"])))
    rec("A8 subtask still visible", False, hidden_task(T(client, H, s1["id"])))
    rec("A9 sub-story's task still visible", False, hidden_task(T(client, H, t2["id"])))
    rec("A10 sub-story still visible", False, hidden_story(S(client, H, c1["id"])))
    rec("A11 task got a completion date", True, bool(T(client, H, t1["id"]).get("completedAt")))

    # ── B. status 'completed' is confirmation and DOES leave the board ───────
    pb = make_user_story(client, H, pid, sid, title="B p")
    tb = _task(client, H, u, pid, sid, "B t", story_id=pb["id"])
    mvS(client, H, pb["id"], "completed")
    rec("B1 'completed' hides the task (by design)", True, hidden_task(T(client, H, tb["id"])))
    rec("B2 'completed' hides the story (by design)", True, hidden_story(S(client, H, pb["id"])))

    # ── C. custom done column id ─────────────────────────────────────────────
    pc = make_user_story(client, H, pid, sid, title="C p")
    tc = _task(client, H, u, pid, sid, "C t", story_id=pc["id"])
    mvS(client, H, pc["id"], "qa_signoff")
    rec("C1 custom column: task follows", "qa_signoff", T(client, H, tc["id"])["status"])
    rec("C2 custom column: not treated as done, no stamp", None, T(client, H, tc["id"]).get("completedAt"))
    rec("C3 custom column: stays visible", False, hidden_task(T(client, H, tc["id"])))

    # ── D. round trip done -> open ───────────────────────────────────────────
    pd = make_user_story(client, H, pid, sid, title="D p")
    td = _task(client, H, u, pid, sid, "D t", story_id=pd["id"])
    mvS(client, H, pd["id"], "done")
    mvS(client, H, pd["id"], "in_progress")
    rec("D1 reopened task status", "in_progress", T(client, H, td["id"])["status"])
    rec("D2 reopened task stamp cleared", None, T(client, H, td["id"]).get("completedAt"))
    rec("D3 reopened task not approved", False, bool(T(client, H, td["id"]).get("approvedByManager")))
    rec("D4 reopened task visible", False, hidden_task(T(client, H, td["id"])))

    # ── E. approved work dragged back out loses the approval ────────────────
    pe = make_user_story(client, H, pid, sid, title="E p")
    te = _task(client, H, u, pid, sid, "E t", story_id=pe["id"])
    client.post(f"/user-stories/{pe['id']}/approve", headers=H)
    rec("E1 approve marks task approved", True, bool(T(client, H, te["id"]).get("approvedByManager")))
    mvS(client, H, pe["id"], "in_progress")
    rec("E2 dragging out clears approval", False, bool(T(client, H, te["id"]).get("approvedByManager")))
    rec("E3 dragging out makes it visible again", False, hidden_task(T(client, H, te["id"])))

    # ── F. running timer inside a block dragged to done ──────────────────────
    pf = make_user_story(client, H, pid, sid, title="F p")
    tf = _task(client, H, u, pid, sid, "F t", story_id=pf["id"])
    start = client.post(f"/tasks/{tf['id']}/timer/start", headers=H)
    rec("F0 timer actually started (guards F2)", 200, start.status_code)
    before = client.get("/tasks/timers/active", headers=H).json()
    rec("F0b timer is running before the drag", True,
        any(r.get("taskId") == tf["id"] for r in before))
    mvS(client, H, pf["id"], "done")
    after = client.get("/tasks/timers/active", headers=H).json()
    rec("F1 task is_started cleared", False, bool(T(client, H, tf["id"]).get("isStarted")))
    rec("F2 timer run also stopped", False,
        any(r.get("taskId") == tf["id"] for r in after))
    # The stop must happen before the status is written, or stop() throws the
    # elapsed time away as "already completed" and the work is unpaid.
    rec("F3 timer's elapsed time was kept, not discarded", True,
        T(client, H, tf["id"]).get("timeTracked") is not None)

    # ── G. empty story ───────────────────────────────────────────────────────
    pg = make_user_story(client, H, pid, sid, title="G p")
    r = mvS(client, H, pg["id"], "done")
    rec("G1 empty story -> done", 200, r.status_code)

    # ── H. guards ────────────────────────────────────────────────────────────
    h1 = make_user_story(client, H, pid, sid, title="H1")
    h2 = make_user_story(client, H, pid, sid, title="H2")
    client.patch(f"/user-stories/{h2['id']}", json={"parentStoryId": h1["id"]}, headers=H)
    rec("H1 cycle refused", True, client.patch(
        f"/user-stories/{h1['id']}", json={"parentStoryId": h2['id']}, headers=H).status_code >= 400)
    rec("H2 self-parent refused", True, client.patch(
        f"/user-stories/{h1['id']}", json={"parentStoryId": h1['id']}, headers=H).status_code >= 400)
    ho = make_user_story(client, H, pid2, sid2, title="H other")
    rec("H3 cross-project parent refused", True, client.patch(
        f"/user-stories/{h2['id']}", json={"parentStoryId": ho['id']}, headers=H).status_code >= 400)

    # ── I. permissions: employee outside the project ─────────────────────────
    pi = make_user_story(client, H, pid, sid, title="I p")
    rec("I1 non-member cannot move a story", True,
        mvS(client, EH, pi["id"], "done").status_code >= 400)

    # ── J. deep chain, 4 story levels ────────────────────────────────────────
    chain = [make_user_story(client, H, pid, sid, title=f"J{i}") for i in range(4)]
    for i in range(1, 4):
        client.patch(f"/user-stories/{chain[i]['id']}", json={"parentStoryId": chain[i-1]["id"]}, headers=H)
    jt = _task(client, H, u, pid, sid, "J t", story_id=chain[3]["id"])
    mvS(client, H, chain[0]["id"], "testing")
    rec("J1 4th-level story follows", "testing", S(client, H, chain[3]["id"])["status"])
    rec("J2 4th-level story's task follows", "testing", T(client, H, jt["id"])["status"])

    failures = [f"{case}: expected {exp!r}, got {obs!r}" for case, exp, obs, ok in R if ok == "FAIL"]
    assert not failures, "\n".join(failures)


def test_a_task_and_its_subtask_come_out_of_one_move_identical(client, manager):
    """The four status-writing paths agree.

    "This task is finished" used to be decided in four places. Moving a task to
    Done ran one of them for the task and another for its subtasks, so a single
    click left the parent with a running timer and no completion date while its
    child had both settled. Anything that differs here means a path has drifted
    away from the shared one again.
    """
    user, H = manager
    pid, sid = _setup(client, H, "OneTill")
    parent = _task(client, H, user, pid, sid, "parent")
    child = _task(client, H, user, pid, sid, "child", parent_id=parent["id"])
    for t in (parent, child):
        assert client.post(f"/tasks/{t['id']}/timer/start", headers=H).status_code == 200

    client.post(f"/tasks/{parent['id']}/move", json={"status": "done"}, headers=H)

    P, C = T(client, H, parent["id"]), T(client, H, child["id"])
    running = {r["taskId"] for r in client.get("/tasks/timers/active", headers=H).json()}
    for name, row, tid in (("parent", P, parent["id"]), ("child", C, child["id"])):
        assert row["status"] == "done", name
        assert row.get("completedAt"), f"{name} has no completion date"
        assert not row.get("approvedByManager"), f"{name} was auto-approved"
        assert tid not in running, f"{name} timer still running"
    assert bool(P.get("completedAt")) == bool(C.get("completedAt"))


def test_patching_a_status_settles_the_task_the_same_way(client, manager):
    """patch_task used to assign the status and nothing else."""
    user, H = manager
    pid, sid = _setup(client, H, "PatchTill")
    t = _task(client, H, user, pid, sid, "patched")
    client.post(f"/tasks/{t['id']}/timer/start", headers=H)

    client.patch(f"/tasks/{t['id']}", json={"status": "done"}, headers=H)

    row = T(client, H, t["id"])
    running = {r["taskId"] for r in client.get("/tasks/timers/active", headers=H).json()}
    assert row["status"] == "done"
    assert row.get("completedAt"), "patch left no completion date"
    assert t["id"] not in running, "patch left the timer running"


def test_a_patch_that_also_renames_keeps_the_logged_time(client, manager):
    """Stopping a timer rewrites time_tracked mid-patch.

    The caller is holding an older copy of the row, so writing it back at the end
    of the patch would put the old total back and lose the time just logged.
    """
    user, H = manager
    pid, sid = _setup(client, H, "PatchTime")
    t = _task(client, H, user, pid, sid, "timed")
    client.post(f"/tasks/{t['id']}/timer/start", headers=H)

    r = client.patch(f"/tasks/{t['id']}", json={"title": "renamed", "status": "done"}, headers=H)
    assert r.status_code == 200, r.text

    row = T(client, H, t["id"])
    assert row["title"] == "renamed", "the rename was lost"
    assert row.get("timeTracked") is not None
