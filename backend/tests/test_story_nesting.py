"""A story may sit under another story (epic → story)."""
from conftest import make_project, make_user_story


def _setup(client, H, name):
    pid = make_project(client, H, name=name)["id"]
    sid = client.post(f"/projects/{pid}/sections", json={"name": "S"}, headers=H).json()["sections"][0]["id"]
    return pid, sid


def _story(client, H, pid, sid, title):
    return make_user_story(client, H, pid, sid, title=title)


def _get(client, H, sid_):
    r = client.get(f"/user-stories/{sid_}", headers=H)
    assert r.status_code == 200, r.text
    return r.json()


def test_a_story_can_be_nested_under_another(client, manager):
    _, H = manager
    pid, sid = _setup(client, H, "Nest")
    epic = _story(client, H, pid, sid, "Epic")
    child = _story(client, H, pid, sid, "Child")

    r = client.patch(f"/user-stories/{child['id']}", json={"parentStoryId": epic["id"]}, headers=H)
    assert r.status_code == 200, r.text
    assert r.json()["parentStoryId"] == epic["id"]
    assert _get(client, H, child["id"])["parentStoryId"] == epic["id"]


def test_empty_string_detaches_it(client, manager):
    _, H = manager
    pid, sid = _setup(client, H, "Detach")
    epic = _story(client, H, pid, sid, "Epic")
    child = _story(client, H, pid, sid, "Child")

    client.patch(f"/user-stories/{child['id']}", json={"parentStoryId": epic["id"]}, headers=H)
    r = client.patch(f"/user-stories/{child['id']}", json={"parentStoryId": ""}, headers=H)
    assert r.status_code == 200, r.text
    assert r.json()["parentStoryId"] is None


def test_a_story_cannot_sit_under_itself(client, manager):
    _, H = manager
    pid, sid = _setup(client, H, "Self")
    story = _story(client, H, pid, sid, "Lonely")
    r = client.patch(f"/user-stories/{story['id']}", json={"parentStoryId": story["id"]}, headers=H)
    assert r.status_code == 400, r.text


def test_a_cycle_is_refused(client, manager):
    _, H = manager
    pid, sid = _setup(client, H, "Cycle")
    a = _story(client, H, pid, sid, "A")
    b = _story(client, H, pid, sid, "B")

    client.patch(f"/user-stories/{b['id']}", json={"parentStoryId": a["id"]}, headers=H)
    r = client.patch(f"/user-stories/{a['id']}", json={"parentStoryId": b["id"]}, headers=H)
    assert r.status_code == 400, r.text
    assert _get(client, H, a["id"])["parentStoryId"] is None


def test_nesting_stops_at_the_depth_limit(client, manager):
    _, H = manager
    pid, sid = _setup(client, H, "Deep")
    chain = [_story(client, H, pid, sid, f"S{i}") for i in range(6)]
    last_ok = None
    for parent, child in zip(chain, chain[1:]):
        r = client.patch(f"/user-stories/{child['id']}", json={"parentStoryId": parent["id"]}, headers=H)
        if r.status_code == 400:
            break
        last_ok = child
    assert last_ok is not None
    # The chain stopped somewhere rather than nesting forever.
    assert any(
        client.patch(f"/user-stories/{c['id']}", json={"parentStoryId": p["id"]}, headers=H).status_code == 400
        for p, c in zip(chain, chain[1:])
    )


def test_a_parent_in_another_project_is_refused(client, manager):
    _, H = manager
    pid_a, sid_a = _setup(client, H, "ProjA")
    pid_b, sid_b = _setup(client, H, "ProjB")
    a = _story(client, H, pid_a, sid_a, "A")
    b = _story(client, H, pid_b, sid_b, "B")

    r = client.patch(f"/user-stories/{b['id']}", json={"parentStoryId": a["id"]}, headers=H)
    assert r.status_code == 400, r.text


def test_deleting_a_parent_leaves_its_children_at_the_top(client, manager):
    _, H = manager
    pid, sid = _setup(client, H, "Orphan")
    epic = _story(client, H, pid, sid, "Epic")
    child = _story(client, H, pid, sid, "Child")
    client.patch(f"/user-stories/{child['id']}", json={"parentStoryId": epic["id"]}, headers=H)

    assert client.delete(f"/user-stories/{epic['id']}", headers=H).status_code in (200, 204)
    assert _get(client, H, child["id"])["parentStoryId"] is None


def test_moving_a_child_to_another_project_detaches_it(client, manager):
    _, H = manager
    pid_a, sid_a = _setup(client, H, "MoveA")
    pid_b, _ = _setup(client, H, "MoveB")
    epic = _story(client, H, pid_a, sid_a, "Epic")
    child = _story(client, H, pid_a, sid_a, "Child")
    client.patch(f"/user-stories/{child['id']}", json={"parentStoryId": epic["id"]}, headers=H)

    r = client.patch(f"/user-stories/{child['id']}", json={"projectId": pid_b}, headers=H)
    assert r.status_code == 200, r.text
    assert r.json()["parentStoryId"] is None
