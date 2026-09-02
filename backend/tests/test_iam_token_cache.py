"""IAM token cache must be keyed by (hostname, username)."""

from types import SimpleNamespace

from db_wrapper.pool import ConnectionPools


class _FakeRds:
    def __init__(self) -> None:
        self.calls: list[dict] = []

    def generate_db_auth_token(self, **kwargs):
        self.calls.append(kwargs)
        return f"token-for-{kwargs['DBUsername']}@{kwargs['DBHostname']}"


def test_iam_token_cache_does_not_reuse_across_users():
    rds = _FakeRds()
    connector = SimpleNamespace(
        DB_USER="postgres",
        DB_PORT=5432,
        AWS_REGION="ap-south-2",
        _rds_client=lambda: rds,
    )
    pools = ConnectionPools(connector)

    first = pools._iam_token("reader.example")
    connector.DB_USER = "app_user"
    second = pools._iam_token("reader.example")

    assert first == "token-for-postgres@reader.example"
    assert second == "token-for-app_user@reader.example"
    assert len(rds.calls) == 2
