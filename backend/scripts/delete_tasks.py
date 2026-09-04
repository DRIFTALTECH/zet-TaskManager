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
#
# Tasks live in work_items alongside stories now, so the last step cannot be a
# plain "DELETE FROM tasks" — it is a delete of the task-typed rows only, and it
# is handled separately below. These are the tables keyed by a task's id.
TASK_CHILD_TABLES = (
    "task_skills",
    "task_attachments",
    "task_checklists",
    "task_feedback",
    "task_time_logs",
    "task_timer_runs",
)

TASK_SQL = "SELECT id FROM work_items WHERE type = 'task'"


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
    for t in TASK_CHILD_TABLES:
        try:
            n = _count(db, t)
        except Exception as e:
            print(f"  {t:28} -- skipped ({type(e).__name__})")
            continue
        present.append(t)
        grand += n
        print(f"  {t:28} {n} row(s)")

    n_tasks = db.read(f"SELECT COUNT(*) AS n FROM ({TASK_SQL}) x")[0]["n"]
    n_assignees = db.read(
        f"SELECT COUNT(*) AS n FROM work_item_assignees WHERE work_item_id IN ({TASK_SQL})"
    )[0]["n"]
    grand += n_tasks + n_assignees
    print(f"  {'work_item_assignees':28} {n_assignees} row(s)")
    print(f"  {'work_items (type=task)':28} {n_tasks} row(s)")

    n_stories = db.read("SELECT COUNT(*) AS n FROM work_items WHERE type = 'story'")[0]["n"]
    print(f"\nKeeping {n_stories} user story(ies) — they share the table but are not touched.")
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
        for t in present:
            db.write(f"DELETE FROM {t} WHERE task_id IN ({TASK_SQL})")
        db.write(f"DELETE FROM work_item_assignees WHERE work_item_id IN ({TASK_SQL})")
        # Break the parent link between tasks before the bulk delete, in case
        # CASCADE is not enabled. A story's parent is always another story, so
        # this cannot orphan one.
        db.write(
            f"UPDATE work_items SET parent_id = NULL "
            f"WHERE type = 'task' AND parent_id IN ({TASK_SQL})"
        )
        # A story keeps its own children; only task rows go.
        db.write("DELETE FROM work_items WHERE type = 'task'")

    print("\nDone. Remaining:")
    for t in present:
        try:
            print(f"  {t:28} {_count(db, t)} row(s)")
        except Exception:
            pass
    print(f"  {'work_items (type=task)':28} "
          f"{db.read(f'SELECT COUNT(*) AS n FROM ({TASK_SQL}) x')[0]['n']} row(s)")
    kept = db.read("SELECT COUNT(*) AS n FROM work_items WHERE type = 'story'")[0]["n"]
    print(f"  {'work_items (type=story)':28} {kept} row(s)  (kept)")
    print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
