"""DESTRUCTIVE: delete every task and user story, keeping everything around them.

For starting a test run from an empty board. Projects, sections, clients,
accounts, kanban columns and settings all survive — only the work items and what
hangs off them go:

    tasks, subtasks, their assignees, time logs, running timers, comments,
    checklists and attachments; user stories, their assignees, comments and
    attachments; and the timesheet rows those tasks created.

Manually written timesheet entries (task_id IS NULL) are kept — they are someone's
recorded hours, not board state. Pass --timesheets to clear those too.

    python scripts/clear_work_items.py                 # dry run: counts only
    python scripts/clear_work_items.py --apply         # asks for a typed confirmation
    python scripts/clear_work_items.py --apply --yes   # no prompt
    python scripts/clear_work_items.py --project p123 --apply

There is ONE Aurora cluster for this project: no dev copy. Take a snapshot first:

    aws rds create-db-cluster-snapshot \\
      --db-cluster-identifier database-1 \\
      --db-cluster-snapshot-identifier zet-before-clear-$(date +%Y%m%d-%H%M)
"""
from __future__ import annotations

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database.database import get_database  # noqa: E402

# Child-to-parent, so a foreign key is never violated mid-run.
# Every one of these is keyed by the work item's id, which is what a task id
# now is. Child-to-parent order, so a foreign key is never violated mid-run.
TASK_CHILD_TABLES = (
    "task_attachments",
    "task_checklists",
    "task_feedback",
    "task_time_logs",
    "task_timer_runs",
    "task_assignees",
    "task_skills",
)
STORY_CHILD_TABLES = (
    "user_story_attachments",
    "user_story_feedback",
)

# Shared by both kinds, since both are rows in work_items.
WORK_ITEM_CHILD_TABLES = (
    "work_item_attachments",
    "work_item_feedback",
    "work_item_assignees",
)


def _count(db, sql: str, params: tuple = ()) -> int:
    rows = db.read(sql, params)
    return int(rows[0]["n"]) if rows else 0


def _table_exists(db, table: str) -> bool:
    try:
        db.read(f"SELECT 1 AS ok FROM {table} LIMIT 1")
        return True
    except Exception:
        return False


def main() -> int:
    ap = argparse.ArgumentParser(description="Delete every task and user story.")
    ap.add_argument("--apply", action="store_true", help="actually delete (otherwise dry run)")
    ap.add_argument("--yes", action="store_true", help="skip the typed confirmation")
    ap.add_argument("--project", help="only this project id")
    ap.add_argument("--timesheets", action="store_true",
                    help="also delete hand-written timesheet entries")
    args = ap.parse_args()

    db = get_database()
    db.enter_request_scope()

    where, params = ("", ())
    and_where = ""
    if args.project:
        where, params = " WHERE project_id = %s", (args.project,)
        and_where = " AND project_id = %s"
        print(f"scoped to project {args.project}")

    tasks = _count(db, f"SELECT COUNT(*) AS n FROM work_items WHERE type = 'task'{and_where}", params)
    stories = _count(db, f"SELECT COUNT(*) AS n FROM work_items WHERE type = 'story'{and_where}", params)
    ts_from_tasks = _count(
        db, f"SELECT COUNT(*) AS n FROM timesheet_entries WHERE task_id IS NOT NULL", ()
    ) if _table_exists(db, "timesheet_entries") else 0
    ts_manual = _count(db, "SELECT COUNT(*) AS n FROM timesheet_entries WHERE task_id IS NULL", ())

    print("\nWould delete:")
    print(f"  tasks (incl. subtasks)   {tasks}")
    print(f"  user stories             {stories}")
    print(f"  timesheet rows from tasks {ts_from_tasks}")
    if args.timesheets:
        print(f"  hand-written timesheet rows {ts_manual}")
    else:
        print(f"  (keeping {ts_manual} hand-written timesheet row(s) — pass --timesheets to clear)")
    print("\nKept: projects, sections, clients, accounts, kanban columns, settings.")

    if not args.apply:
        print("\nDry run — nothing was written. Re-run with --apply.")
        return 0
    if tasks == 0 and stories == 0:
        print("\nNothing to do.")
        return 0

    if not args.yes:
        want = "DELETE"
        got = input(f"\nType {want} to erase {tasks} task(s) and {stories} story(ies): ").strip()
        if got != want:
            print("Cancelled.")
            return 1

    item_ids_sql = f"SELECT id FROM work_items{where}"

    for table in (*TASK_CHILD_TABLES, "timesheet_entries"):
        if _table_exists(db, table):
            db.write(f"DELETE FROM {table} WHERE task_id IN ({item_ids_sql})", params)
    for table in STORY_CHILD_TABLES:
        if _table_exists(db, table):
            db.write(f"DELETE FROM {table} WHERE user_story_id IN ({item_ids_sql})", params)
    for table in WORK_ITEM_CHILD_TABLES:
        if _table_exists(db, table):
            db.write(f"DELETE FROM {table} WHERE work_item_id IN ({item_ids_sql})", params)

    if _table_exists(db, "timesheet_entries") and args.timesheets:
        db.write(
            "DELETE FROM timesheet_entries WHERE task_id IS NULL" + (
                " AND project_id = %s" if args.project else ""
            ),
            params,
        )

    # Deepest first, so the self-referencing parent_id never dangles: subtasks,
    # then tasks and sub-stories, then what is left at the top.
    for _ in range(3):
        db.write(
            f"""DELETE FROM work_items{where}{' AND' if where else ' WHERE'}
                id NOT IN (SELECT parent_id FROM work_items WHERE parent_id IS NOT NULL)""",
            params,
        )
    db.commit()

    print(f"\nDeleted {tasks} task(s) and {stories} story(ies). The board is empty.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
