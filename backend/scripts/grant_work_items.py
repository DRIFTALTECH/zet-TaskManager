"""Give the API's role access to the work_item tables. Run as the OWNER.

WHY THIS EXISTS
    A new table is created with no privileges for anyone but its owner, and
    ALTER DEFAULT PRIVILEGES only covers tables created after it was set, by the
    role that set it. work_items and its three child tables were created by
    `postgres` and granted to nobody, so the API — which connects as a
    least-privilege role — fails every request with:

        psycopg2.errors.InsufficientPrivilege: permission denied for table work_items

    The browser then reports it as a CORS error, because a crashed response
    never reaches the CORS middleware. The CORS config is not the problem.

SAFE TO RE-RUN
    Additive only. No data is read, written, moved or dropped; GRANT never
    removes a privilege. Running it twice does nothing the second time.

    cd backend
    python scripts/grant_work_items.py            # show what is missing
    python scripts/grant_work_items.py --apply    # grant it

Uses backend/.env, so it must point at an owner connection (DB_USER=postgres).
"""
from __future__ import annotations

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database.database import get_database  # noqa: E402

TABLES = ("work_items", "work_item_assignees", "work_item_feedback", "work_item_attachments")
NEEDED = {"SELECT", "INSERT", "UPDATE", "DELETE"}


def _grants_for(db, role: str) -> dict[str, set[str]]:
    # A literal % must be doubled: the driver reads a single % as a placeholder.
    rows = db.read(
        """
        SELECT table_name, privilege_type
        FROM information_schema.role_table_grants
        WHERE grantee = %s AND table_name LIKE 'work_item%%'
        """,
        (role,),
    )
    out: dict[str, set[str]] = {}
    for r in rows:
        out.setdefault(r["table_name"], set()).add(r["privilege_type"])
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description="Grant the API role access to work_item tables.")
    ap.add_argument("--role", default="app_user", help="role the API connects as (default app_user)")
    ap.add_argument("--apply", action="store_true", help="actually grant (otherwise report only)")
    args = ap.parse_args()

    db = get_database()
    db.enter_request_scope()

    me = db.read("SELECT current_user AS u")[0]["u"]
    print(f"connected as: {me}")
    owners = db.read("SELECT tableowner FROM pg_tables WHERE tablename = 'work_items'")
    if not owners:
        print("work_items does not exist here. Run scripts/bootstrap_aurora.sql first.")
        return 1
    owner = owners[0]["tableowner"]
    print(f"work_items owner: {owner}")
    if me != owner:
        print(f"\nRefusing: only {owner} can grant on its own tables, and this is {me}.")
        print("Point backend/.env at the owner connection, or run the SQL in the AWS console.")
        return 1

    roles = {r["rolname"] for r in db.read("SELECT rolname FROM pg_roles WHERE rolcanlogin")}
    if args.role not in roles:
        print(f"\nRefusing: role {args.role!r} does not exist. Logins here: {', '.join(sorted(roles))}")
        print("Re-run with --role <name> for whatever the API's .env uses as DB_USER.")
        return 1

    before = _grants_for(db, args.role)
    print(f"\n{args.role} currently has:")
    missing = []
    for t in TABLES:
        got = before.get(t, set())
        ok = NEEDED.issubset(got)
        if not ok:
            missing.append(t)
        print(f"  {'OK ' if ok else 'MISSING'}  {t:<24} {','.join(sorted(got)) or '(none)'}")

    if not missing:
        print("\nNothing to do — already granted.")
        return 0
    if not args.apply:
        print(f"\n{len(missing)} table(s) need granting. Re-run with --apply.")
        return 0

    stmts = [f"GRANT USAGE ON SCHEMA public TO {args.role}"]
    stmts += [f"GRANT SELECT, INSERT, UPDATE, DELETE ON {t} TO {args.role}" for t in TABLES]
    # Catch anything else added since the last bootstrap, and cover future tables
    # so this cannot happen again the next time a table is added.
    stmts.append(f"GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO {args.role}")
    stmts.append(
        f"ALTER DEFAULT PRIVILEGES IN SCHEMA public "
        f"GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO {args.role}"
    )

    print()
    for s in stmts:
        try:
            db.write(s)
            print("  OK    ", s)
        except Exception as e:
            print("  FAILED", s, "->", f"{type(e).__name__}: {e}")
    db.commit()

    after = _grants_for(db, args.role)
    print(f"\n{args.role} now has:")
    all_ok = True
    for t in TABLES:
        got = after.get(t, set())
        ok = NEEDED.issubset(got)
        all_ok &= ok
        print(f"  {'OK ' if ok else 'STILL MISSING'}  {t:<24} {','.join(sorted(got)) or '(none)'}")

    print("\nDone — restart the API." if all_ok else "\nSomething is still missing.")
    return 0 if all_ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
