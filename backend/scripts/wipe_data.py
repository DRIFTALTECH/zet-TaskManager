"""DESTRUCTIVE: delete all application data, keeping named accounts.

Wipes every row from every application table — projects, tasks, timesheets,
Clockify imports, notifications, audit history, MCP tokens — and leaves only the
accounts listed with --keep (defaults to KEEP_EMAILS below).

    python scripts/wipe_data.py                    # dry run: counts only, writes nothing
    python scripts/wipe_data.py --apply            # asks for a typed confirmation
    python scripts/wipe_data.py --apply --yes       # no prompt (CI / scripted use)
    python scripts/wipe_data.py --keep a@x.com --keep b@x.com --apply

There is ONE Aurora cluster for this project: no dev copy. Whatever this deletes
is deleted for everyone. Take a snapshot first:

    aws rds create-db-cluster-snapshot \\
      --db-cluster-identifier database-1 \\
      --db-cluster-snapshot-identifier zet-before-wipe-$(date +%Y%m%d-%H%M)

Everything runs in a single transaction, so a failure part-way leaves the database
untouched rather than half-erased.
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from database.database import get_db  # noqa: E402
from logic.auth_logic import SUPERADMIN_ROLE  # noqa: E402

# Accounts that survive the wipe. Kept active and left at whatever role they hold.
KEEP_EMAILS = ("swamy@driftal.tech",)

# Child-to-parent order so foreign keys are never violated mid-run.
TABLES_CHILD_FIRST = (
    "teams_transcript_imports",
    "scrums",
    "personal_access_tokens",
    "oauth_grants",
    "oauth_clients",
    "notifications",
    "audit_logs",
    "forecast_visibility",
    "task_attachments",
    "task_checklists",
    "task_feedback",
    "task_time_logs",
    "task_timer_runs",
    "task_assignees",
    "timesheet_entries",
    "timesheet_submissions",
    "user_story_attachments",
    "user_story_assignees",
    "user_stories",
    "tasks",
    "sections",
    "project_members",
    "projects",
    "clients",
)

# Global defaults, not user data. Left alone: the app re-seeds kanban_columns only
# when the table is empty, so clearing it would silently change everyone's board.
PRESERVED_TABLES = ("kanban_columns", "app_settings")


def _count(db, table: str) -> int:
    rows = db.read(f"SELECT count(*) AS n FROM {table}")
    return int(rows[0]["n"]) if rows else 0


def main() -> int:
    ap = argparse.ArgumentParser(description="Delete all application data except named accounts.")
    ap.add_argument("--keep", action="append", default=None,
                    help="Email to preserve (repeatable). Defaults to %s" % ", ".join(KEEP_EMAILS))
    ap.add_argument("--apply", action="store_true", help="actually delete (otherwise dry run)")
    ap.add_argument("--yes", action="store_true", help="skip the typed confirmation")
    args = ap.parse_args()

    keep = tuple(e.strip().lower() for e in (args.keep or KEEP_EMAILS) if e.strip())
    if not keep:
        print("error: refusing to run with an empty --keep list; that would delete every account.")
        return 1

    db = next(get_db())

    # Resolve the keep list to real accounts before touching anything.
    placeholders = ", ".join(["%s"] * len(keep))
    kept_rows = db.read(
        f"SELECT id, email, role, is_active FROM users WHERE LOWER(email) IN ({placeholders})",
        tuple(keep),
    )
    kept_emails = {str(r["email"]).lower() for r in kept_rows}
    missing = [e for e in keep if e not in kept_emails]

    print("\nKEEP")
    for r in kept_rows:
        print(f"  {r['email']}  role={r['role']}  active={r['is_active']}")
    for e in missing:
        print(f"  {e}  -- NOT FOUND in users")
    if not kept_rows:
        print("\nerror: none of the --keep emails exist. Refusing to wipe every account.")
        print("       Check the address, or create it first with scripts/seed_superadmin.py.")
        return 1

    total_users = _count(db, "users")
    users_to_delete = total_users - len(kept_rows)

    print("\nWILL DELETE")
    grand = 0
    for t in TABLES_CHILD_FIRST:
        try:
            n = _count(db, t)
        except Exception as e:
            print(f"  {t:28} -- skipped ({type(e).__name__})")
            continue
        grand += n
        if n:
            print(f"  {t:28} {n} row(s)")
    print(f"  {'users':28} {users_to_delete} of {total_users} row(s)")
    grand += users_to_delete

    print("\nWILL KEEP")
    for t in PRESERVED_TABLES:
        try:
            print(f"  {t:28} {_count(db, t)} row(s) (global defaults, not user data)")
        except Exception:
            print(f"  {t:28} -- not present")

    print(f"\nTotal rows to delete: {grand}")

    if not any(str(r["role"]) == SUPERADMIN_ROLE for r in kept_rows):
        print(f"\nROLE FIX: none of the kept accounts is a superadmin "
              f"(found: {', '.join(sorted({str(r['role']) for r in kept_rows}))}).")
        print(f"          {kept_rows[0]['email']} will be promoted to superadmin, otherwise")
        print("          nobody could approve the accounts that sign in after the wipe.")

    if not args.apply:
        print("\nDry run. Nothing was written. Re-run with --apply to delete.\n")
        return 0

    if not args.yes:
        print("\n" + "!" * 70)
        print("  This permanently deletes the data above from the LIVE database.")
        print("  There is no dev copy. Take an RDS snapshot first if you have not.")
        print("!" * 70)
        typed = input('\nType "erase all data" to proceed: ').strip()
        if typed != "erase all data":
            print("Aborted — nothing was written.")
            return 1

    # One transaction: a mid-run failure rolls the whole thing back.
    with db.transaction():
        for t in TABLES_CHILD_FIRST:
            try:
                db.write(f"DELETE FROM {t}")
            except Exception as e:
                print(f"  warning: {t} -- {type(e).__name__}: {e}")
                raise
        db.write(
            f"DELETE FROM users WHERE LOWER(email) NOT IN ({placeholders})",
            tuple(keep),
        )
        # The surviving accounts must still be able to sign in.
        db.write(
            f"UPDATE users SET is_active = TRUE WHERE LOWER(email) IN ({placeholders})",
            tuple(keep),
        )
        # And at least one of them MUST be a superadmin, or the wipe leaves nobody
        # who can approve the accounts that sign in afterwards. This matters because
        # legacy rows can still hold role='admin', which the current code recognises
        # nowhere: such a user would land with employee-level access and no way back.
        if not any(str(r["role"]) == SUPERADMIN_ROLE for r in kept_rows):
            promote = kept_rows[0]["email"]
            db.write(
                "UPDATE users SET role = %s WHERE LOWER(email) = %s",
                (SUPERADMIN_ROLE, str(promote).lower()),
            )
            print(f"\n  promoted {promote} to superadmin "
                  f"(was '{kept_rows[0]['role']}', which this version does not recognise)")

    print("\nDone. Remaining:")
    for t in ("users",) + PRESERVED_TABLES:
        try:
            print(f"  {t:28} {_count(db, t)} row(s)")
        except Exception:
            pass
    for r in db.read(
        f"SELECT email, role, is_active FROM users WHERE LOWER(email) IN ({placeholders})",
        tuple(keep),
    ):
        print(f"  kept: {r['email']}  role={r['role']}  active={r['is_active']}")
    print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
