"""Pre-deploy check: can this machine reach Aurora with certificate verification?

Connections now use sslmode=verify-full, which validates the certificate chain and
the hostname. That fails CLOSED — if verification does not succeed the app cannot
reach the database at all. Run this from the environment that will host the app
(or anything on the same network path) BEFORE deploying.

    cd backend && python scripts/check_db_tls.py

It tries verify-full first, then falls back to require, so the output tells you
whether a failure is a certificate problem or a plain connectivity problem.
Read-only: it runs SELECT 1 and nothing else.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

import psycopg2  # noqa: E402

from db_wrapper.loader import load_connector  # noqa: E402
from db_wrapper.pool import ConnectionPools  # noqa: E402


def _try(kwargs: dict, label: str) -> bool:
    redacted = {k: ("<token>" if k == "password" else v) for k, v in kwargs.items()}
    print(f"\n{label}")
    print(f"  sslmode     : {redacted.get('sslmode')}")
    print(f"  sslrootcert : {redacted.get('sslrootcert', '(none)')}")
    try:
        conn = psycopg2.connect(**kwargs)
        cur = conn.cursor()
        cur.execute("SELECT current_database(), version()")
        db, ver = cur.fetchone()
        conn.close()
        print(f"  RESULT      : OK — connected to '{db}'")
        print(f"                {ver.split(',')[0]}")
        return True
    except Exception as e:
        print(f"  RESULT      : FAILED — {type(e).__name__}")
        print(f"                {str(e).strip()[:200]}")
        return False


def main() -> int:
    connector = load_connector()
    pools = ConnectionPools(connector)

    print("=" * 72)
    print("Aurora TLS pre-deploy check")
    print("=" * 72)
    print(f"  write host : {connector.DB_WRITE_HOST}")
    print(f"  read host  : {connector.DB_READ_HOST}")
    print(f"  database   : {connector.DB_NAME}")
    print(f"  user       : {connector.DB_USER}")
    print(f"  region     : {connector.AWS_REGION}")

    try:
        strict = pools._connect_kwargs(connector.DB_READ_HOST)
    except Exception as e:
        print(f"\nCould not even build connection settings: {type(e).__name__}: {e}")
        print("Most likely no AWS credentials are available to generate an IAM token.")
        print("In production attach a task/instance role with rds-db:connect.")
        return 1

    bundle = strict.get("sslrootcert")
    if bundle:
        pem = Path(bundle)
        if pem.is_file():
            print(f"  CA bundle  : {bundle} ({pem.read_text().count('BEGIN CERTIFICATE')} certs)")
        else:
            print(f"  CA bundle  : {bundle} -- MISSING")

    if _try(strict, "1) verify-full (what the app will use)"):
        print("\nVerdict: safe to deploy with certificate verification on.\n")
        return 0

    loose = dict(strict)
    loose["sslmode"] = "require"
    loose.pop("sslrootcert", None)
    if _try(loose, "2) require (no certificate validation)"):
        print("\nVerdict: the network and credentials are fine — this is a CERTIFICATE")
        print("problem. Either the CA bundle does not chain to this cluster's")
        print("certificate, or something is intercepting TLS on this path.")
        print("Unblock the deploy by setting DB_SSL_MODE=require, then investigate.\n")
        return 1

    print("\nVerdict: both attempts failed, so this is NOT about certificates.")
    print("Check the security group allows 5432 from here, the hostname is correct,")
    print("and that the IAM token is valid for this DB user.\n")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
