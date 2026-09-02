#!/usr/bin/env python3
"""
Connect to Aurora / RDS PostgreSQL using an IAM authentication token.

A fresh token is generated on every connection via boto3
(rds.generate_db_auth_token). The token acts as the DB password and is
valid for 15 minutes. SSL is mandatory for IAM auth.

Required environment variables (no aliases, no silent defaults for identity):
  DB_USER         Postgres role that has GRANT rds_iam (never the master user)
  DB_WRITE_HOST   Aurora cluster / writer endpoint
  DB_READ_HOST    Aurora reader endpoint
  AWS_REGION      Must match the cluster's region (e.g. ap-south-2)

Optional:
  DB_PORT         default 5432
  DB_NAME         default postgres
  DB_AUTH_TOKEN   passthrough token when boto3 creds are unavailable
  DB_SSL_ROOT_CERT  override CA bundle path

These are Postgres usernames and hostnames — not AWS credentials.
An Access Key ID (AKIA...) in DB_USER is rejected at import.

AWS credentials come from the default boto3 chain
(env vars / shared config / SSO / instance or task role).

ZET's db_wrapper.pool expects module attrs DB_WRITE_HOST, DB_READ_HOST,
DB_USER, DB_PORT, DB_NAME, AWS_REGION, and _rds_client().
"""

from __future__ import annotations

import logging
import os
import sys
import urllib.request
from functools import lru_cache
from typing import Any

import boto3
import psycopg2
from dotenv import load_dotenv

load_dotenv()

log = logging.getLogger("zet.db.connector")

_REQUIRED = ("DB_USER", "DB_WRITE_HOST", "DB_READ_HOST", "AWS_REGION")
_DEAD_ALIASES = (
    "RDS_USERNAME",
    "RDS_HOSTNAME",
    "RDS_PORT",
    "RDS_DB_NAME",
    "DATABASE_URL",
    "DB_HOST",
)


def _require_env(name: str) -> str:
    value = (os.getenv(name) or "").strip()
    if not value:
        raise RuntimeError(
            f"{name} is required and has no default. Set it in backend/.env. "
            "This is a Postgres username or Aurora hostname — not an AWS credential."
        )
    return value


def _reject_aws_credential_as_db_user(user: str) -> None:
    """Fail if someone pasted an IAM access key into DB_USER."""
    if user.upper().startswith("AKIA"):
        raise RuntimeError(
            "DB_USER looks like an AWS access key ID (AKIA...). "
            "DB_USER must be a Postgres role (e.g. app_user), not an AWS credential."
        )


DB_USER = _require_env("DB_USER")
_reject_aws_credential_as_db_user(DB_USER)
DB_WRITE_HOST = _require_env("DB_WRITE_HOST")
DB_READ_HOST = _require_env("DB_READ_HOST")
AWS_REGION = _require_env("AWS_REGION")
DB_PORT = int((os.getenv("DB_PORT") or "5432").strip() or "5432")
DB_NAME = (os.getenv("DB_NAME") or "postgres").strip() or "postgres"

_leftover = [k for k in _DEAD_ALIASES if (os.getenv(k) or "").strip()]
if _leftover:
    log.warning(
        "Ignoring leftover env vars %s; the connector reads only "
        "DB_USER, DB_WRITE_HOST, DB_READ_HOST, AWS_REGION",
        ", ".join(_leftover),
    )

_IDENTITY = (
    f"zet.db.connector | identity user={DB_USER} write={DB_WRITE_HOST} "
    f"read={DB_READ_HOST} region={AWS_REGION} db={DB_NAME} port={DB_PORT}"
)
log.info(_IDENTITY)
print(_IDENTITY, flush=True)

# Region-specific RDS CA bundle (used for sslmode=verify-full).
CA_BUNDLE_URL = (
    f"https://truststore.pki.rds.amazonaws.com/{AWS_REGION}/{AWS_REGION}-bundle.pem"
)
CA_BUNDLE_PATH = os.environ.get(
    "DB_SSL_ROOT_CERT",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), f"{AWS_REGION}-bundle.pem"),
)


@lru_cache(maxsize=1)
def _rds_client():
    return boto3.client("rds", region_name=AWS_REGION)


def ensure_ca_bundle(path: str, url: str) -> str:
    """Download the RDS CA bundle if it is not already present."""
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return path
    print(f"CA bundle not found. Downloading from {url} ...")
    import ssl

    try:
        import certifi

        ctx = ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        ctx = ssl.create_default_context()
    with urllib.request.urlopen(url, context=ctx) as resp, open(path, "wb") as out:
        out.write(resp.read())
    print(f"Saved CA bundle to {path}")
    return path


def generate_iam_token() -> str:
    """Generate an IAM auth token (valid 15 minutes).

    If DB_AUTH_TOKEN is set, use it as-is (passthrough) -- handy for testing
    with a console/CloudShell-generated token when no local AWS creds exist.
    Otherwise generate a fresh token via boto3.
    """
    pre = os.environ.get("DB_AUTH_TOKEN")
    if pre:
        print("Using DB_AUTH_TOKEN from environment (passthrough, no boto3).")
        return pre

    return _rds_client().generate_db_auth_token(
        DBHostname=DB_WRITE_HOST,
        Port=DB_PORT,
        DBUsername=DB_USER,
        Region=AWS_REGION,
    )


def get_db_connection(*, write: bool = True):
    """Open a new connection using a fresh IAM token."""
    host = DB_WRITE_HOST if write else DB_READ_HOST
    ensure_ca_bundle(CA_BUNDLE_PATH, CA_BUNDLE_URL)
    token = (
        os.environ["DB_AUTH_TOKEN"]
        if os.environ.get("DB_AUTH_TOKEN")
        else _rds_client().generate_db_auth_token(
            DBHostname=host,
            Port=DB_PORT,
            DBUsername=DB_USER,
            Region=AWS_REGION,
        )
    )

    conn = psycopg2.connect(
        host=host,
        port=DB_PORT,
        user=DB_USER,
        password=token,
        database=DB_NAME,
        sslmode="require",
        connect_timeout=10,
    )
    conn.autocommit = True
    return conn


class DBConnectionPool:
    """Lightweight helper: opens a fresh IAM-authenticated connection per call."""

    def get_connection(self):
        return get_db_connection()

    def execute_query(self, query: str, params: tuple | None = None) -> Any:
        conn = self.get_connection()
        try:
            with conn.cursor() as cur:
                cur.execute(query, params)
                if cur.description:
                    return cur.fetchall()
                return True
        finally:
            conn.close()


def main() -> int:
    pool = DBConnectionPool()
    print(f"Connecting to {DB_WRITE_HOST}:{DB_PORT}/{DB_NAME} as {DB_USER} (IAM token) ...")
    try:
        rows = pool.execute_query(
            "SELECT version(), current_user, now() AS current_time;"
        )
    except Exception as exc:  # noqa: BLE001 - surface the real cause to the user
        print(f"Connection FAILED: {exc}", file=sys.stderr)
        return 1

    version, user, now = rows[0]
    print("Connected OK.")
    print(f"  server : {version}")
    print(f"  user   : {user}")
    print(f"  time   : {now}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
