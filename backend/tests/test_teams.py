"""Teams → MOM: VTT flattening, managerial gate, and graceful unconfigured behaviour."""

from logic.teams_logic import vtt_to_text

_VTT = """WEBVTT

1
00:00:01.000 --> 00:00:04.000
<v Alice Smith>Finished the login API.</v>

2
00:00:04.500 --> 00:00:07.000
<v Alice Smith>Tests tomorrow.</v>

3
00:00:08.000 --> 00:00:10.000
<v Bob>Blocked on deploy creds.</v>
"""


def test_vtt_to_text_flattens_and_collapses():
    out = vtt_to_text(_VTT)
    assert out == (
        "Alice Smith: Finished the login API. Tests tomorrow.\n"
        "Bob: Blocked on deploy creds."
    )
    # No header / timestamps / cue numbers leak through.
    assert "WEBVTT" not in out and "-->" not in out


def test_vtt_to_text_empty():
    assert vtt_to_text("WEBVTT\n\n") == ""


def test_status_requires_managerial(client, employee):
    _u, H = employee
    assert client.get("/integrations/teams/status", headers=H).status_code == 403


def test_status_ok_for_manager_unconfigured(client, manager):
    _u, H = manager
    r = client.get("/integrations/teams/status", headers=H)
    assert r.status_code == 200, r.text
    assert r.json()["configured"] is False  # no Graph creds in test env


def test_import_unconfigured_returns_503(client, manager):
    _u, H = manager
    r = client.post(
        "/integrations/teams/import",
        json={"organizerEmail": "o@x.test", "joinUrl": "https://teams.microsoft.com/x"},
        headers=H,
    )
    assert r.status_code == 503  # Graph not configured → friendly error, not a crash


def test_import_forbidden_for_employee(client, employee):
    _u, H = employee
    r = client.post(
        "/integrations/teams/import",
        json={"organizerEmail": "o@x.test", "joinUrl": "https://teams.microsoft.com/x"},
        headers=H,
    )
    assert r.status_code == 403
