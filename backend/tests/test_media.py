"""Project media upload: served URL, content-type allowlist, file cleanup."""

import base64

_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC"
)


def test_media_upload_serves_url_and_sets_accent(client, manager):
    _user, H = manager
    pid = client.post("/projects", json={"name": "M", "description": ""}, headers=H).json()["id"]
    r = client.post(
        f"/projects/{pid}/media",
        data={"kind": "background", "accent_color": "#3366ff"},
        files={"file": ("x.png", _PNG, "image/png")},
        headers=H,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["backgroundImage"].startswith("/project-media/")
    assert body["accentColor"] == "#3366ff"
    assert client.get(body["backgroundImage"]).status_code == 200


def test_media_rejects_non_raster(client, manager):
    _user, H = manager
    pid = client.post("/projects", json={"name": "M2", "description": ""}, headers=H).json()["id"]
    bad = client.post(
        f"/projects/{pid}/media",
        data={"kind": "project"},
        files={"file": ("x.svg", b"<svg onload=alert(1)></svg>", "image/svg+xml")},
        headers=H,
    )
    assert bad.status_code == 400  # SVG blocked
