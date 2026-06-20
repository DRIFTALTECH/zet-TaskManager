def test_health_ok(client):
    j = client.get("/health").json()
    assert j["status"] == "ok"
    assert j["db"] == "up"


def test_whoami_requires_auth(client):
    # No bearer token → unauthorized.
    assert client.get("/users").status_code == 401
