#!/usr/bin/env python3
"""
Connect to Aurora / RDS PostgreSQL using an IAM authentication token.

A fresh token is generated on every connection via boto3
(rds.generate_db_auth_token). The token acts as the DB password and is
valid for 15 minutes. SSL is mandatory for IAM auth; this script uses
sslmode=verify-full and validates the server certificate against the
region-specific RDS CA bundle (auto-downloaded if absent).

Prereqs (must already be true on the AWS side):
  * IAM database authentication enabled on the cluster.
  * DB user has the rds_iam role:  GRANT rds_iam TO postgres;
    NOTE: once a Postgres role has rds_iam it authenticates ONLY via IAM
    token -- password login for that role stops working.
  * Caller's IAM identity has an attached policy allowing rds-db:connect
    on the DB resource, e.g.:
      arn:aws:rds-db:ap-south-2:<account-id>:dbuser:<cluster-resource-id>/postgres
  * DB_HOST region must match AWS_REGION (e.g. both ap-south-2).

AWS credentials are taken from the default boto3 chain
(env vars / shared config / SSO / instance or task role).

Copy .env.example to .env and fill in DB_WRITE_HOST / DB_READ_HOST
(or legacy DB_HOST / RDS_HOSTNAME) before running.

ZET's db_wrapper.pool expects module attrs DB_WRITE_HOST and DB_READ_HOST.
"""

import os
import sys
import urllib.request
from functools import lru_cache
from typing import Any

import boto3
import psycopg2
from dotenv import load_dotenv

load_dotenv()

# --- Config (from .env or environment) ----------------------------------------
# Prefer explicit read/write hosts (used by backend/db_wrapper/pool.py).
# Fallbacks keep older .env layouts working:
#   DB_WRITE_HOST ← DB_WRITE_HOST | RDS_HOSTNAME | DB_HOST
#   DB_READ_HOST  ← DB_READ_HOST  | DB_HOST      | DB_WRITE_HOST
DB_WRITE_HOST = (
    os.getenv("DB_WRITE_HOST")
    or os.getenv("RDS_HOSTNAME")
    or os.getenv("DB_HOST")
    or ""
).strip()
DB_READ_HOST = (
    os.getenv("DB_READ_HOST")
    or os.getenv("DB_HOST")
    or DB_WRITE_HOST
    or ""
).strip()
# Legacy single-host alias (CLI / older scripts).
DB_HOST = (os.getenv("DB_HOST") or DB_WRITE_HOST or DB_READ_HOST or "").strip() or None
DB_PORT = int(os.getenv("DB_PORT") or os.getenv("RDS_PORT") or "5432")
DB_NAME = (os.getenv("DB_NAME") or os.getenv("RDS_DB_NAME") or "postgres").strip()
DB_USER = (os.getenv("DB_USER") or os.getenv("RDS_USERNAME") or "postgres").strip()
AWS_REGION = (os.getenv("AWS_REGION") or os.getenv("AWS_DEFAULT_REGION") or "ap-south-2").strip()

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
    # Use certifi's CA store — python.org macOS builds often lack system trust roots,
    # so bare urllib.urlretrieve fails with SSLCertVerificationError.
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

    host = DB_WRITE_HOST or DB_HOST
    if not host:
        raise ValueError(
            "DB_WRITE_HOST (or DB_HOST / RDS_HOSTNAME) is required for IAM token generation."
        )
    return _rds_client().generate_db_auth_token(
        DBHostname=host,
        Port=DB_PORT,
        DBUsername=DB_USER,
        Region=AWS_REGION,
    )


def get_db_connection(*, write: bool = True):
    """Open a new connection using a fresh IAM token."""
    host = DB_WRITE_HOST if write else DB_READ_HOST
    host = host or DB_HOST
    if not host:
        raise ValueError(
            "DB_WRITE_HOST / DB_READ_HOST (or DB_HOST) is required. "
            "Set them in .env or export them in your shell."
        )

    ensure_ca_bundle(CA_BUNDLE_PATH, CA_BUNDLE_URL)
    token = _rds_client().generate_db_auth_token(
        DBHostname=host,
        Port=DB_PORT,
        DBUsername=DB_USER,
        Region=AWS_REGION,
    ) if not os.environ.get("DB_AUTH_TOKEN") else os.environ["DB_AUTH_TOKEN"]

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
    print(f"Connecting to {DB_HOST}:{DB_PORT}/{DB_NAME} as {DB_USER} (IAM token) ...")
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
