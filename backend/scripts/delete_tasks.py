"""Delete every task (and task-owned child rows). Leaves projects, users,
timesheets, user stories, and everything else untouched.

    python scripts/delete_tasks.py              # dry run: counts only
    python scripts/delete_tasks.py --apply      # asks for a typed confirmation
    python scripts/delete_tasks.py --apply --yes
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from database.database import get_db  # noqa: E402

# Child tables first so FKs are never violated. CASCADE would cover most of
# these; we still delete them explicitly so a missing ON DELETE CASCADE cannot
# block the wipe. task_skills is additive and may be absent on older DBs.
TASK_TABLES_CHILD_FIRST = (
    "task_skills",
    "task_attachments",
    "task_checklists",
    "task_feedback",
    "task_time_logs",
    "task_timer_runs",
    "task_assignees",
    "tasks",
)


def _count(db, table: str) -> int:
    rows = db.read(f"SELECT count(*) AS n FROM {table}")
    return int(rows[0]["n"]) if rows else 0


def main() -> int:
    ap = argparse.ArgumentParser(description="Delete all tasks. Leaves projects and users alone.")
    ap.add_argument("--apply", action="store_true", help="actually delete (otherwise dry run)")
    ap.add_argument("--yes", action="store_true", help="skip the typed confirmation")
    args = ap.parse_args()

    db = next(get_db())

    print("\nWILL DELETE")
    grand = 0
    present: list[str] = []
    for t in TASK_TABLES_CHILD_FIRST:
        try:
            n = _count(db, t)
        except Exception as e:
            print(f"  {t:28} -- skipped ({type(e).__name__})")
            continue
        present.append(t)
        grand += n
        print(f"  {t:28} {n} row(s)")
    print(f"\nTotal rows to delete: {grand}")

    if not args.apply:
        print("\nDry run. Nothing was written. Re-run with --apply to delete.\n")
        return 0

    if not args.yes:
        print("\nThis permanently deletes every task (and task-owned rows) above.")
        typed = input('\nType "delete tasks" to proceed: ').strip()
        if typed != "delete tasks":
            print("Aborted — nothing was written.")
            return 1

    with db.transaction():
        # Break the self-FK on subtasks before the bulk delete, in case CASCADE
        # is not enabled on this database.
        if "tasks" in present:
            db.write("UPDATE tasks SET parent_task_id = NULL WHERE parent_task_id IS NOT NULL")
        for t in present:
            db.write(f"DELETE FROM {t}")

    print("\nDone. Remaining:")
    for t in present:
        try:
            print(f"  {t:28} {_count(db, t)} row(s)")
        except Exception:
            pass
    print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
