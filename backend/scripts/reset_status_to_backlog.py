"""Put work back in Backlog.

Sets the status of tasks (and optionally stories) to `backlog`, for when a
board's statuses have been shuffled and the quickest way out is to start from
one column again. Nothing is created or deleted — only `status` changes, so the
work itself, its comments, time logs and timesheet rows are untouched.

Completed work is left alone by default: `completed` means approved-and-closed,
not "somewhere on the board". Pass --include-completed to reopen those too.

    python scripts/reset_status_to_backlog.py                     # dry run
    python scripts/reset_status_to_backlog.py --apply
    python scripts/reset_status_to_backlog.py --email me@x.com --apply
    python scripts/reset_status_to_backlog.py --project p123 --apply
    python scripts/reset_status_to_backlog.py --apply --stories   # stories too
"""
from __future__ import annotations

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database.database import get_database  # noqa: E402

TARGET = "backlog"


def _where(args, user_id: str | None) -> tuple[str, list]:
    clauses = ["status <> %s"]
    params: list = [TARGET]
    if not args.include_completed:
        clauses.append("status <> 'completed'")
    if args.project:
        clauses.append("project_id = %s")
        params.append(args.project)
    if user_id:
        clauses.append("created_by = %s")
        params.append(user_id)
    return " AND ".join(clauses), params


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="write the change (default: dry run)")
    ap.add_argument("--email", help="only work created by this person")
    ap.add_argument("--project", help="only this project id")
    ap.add_argument("--stories", action="store_true", help="reset user stories as well")
    ap.add_argument("--include-completed", action="store_true", help="reopen completed work too")
    args = ap.parse_args()

    db = get_database()
    db.enter_request_scope()

    user_id = None
    if args.email:
        rows = db.read("SELECT id, name FROM users WHERE email = %s", (args.email,))
        if not rows:
            print(f"No user with email {args.email}")
            return
        user_id = rows[0]["id"]
        print(f"scoped to work created by {rows[0]['name']}")

    # Always show the whole picture first: "nothing to move" reads very
    # differently depending on whether everything is already in backlog or the
    # table is empty.
    scope, scope_params = ("", [])
    if args.project:
        scope, scope_params = " AND project_id = %s", [args.project]
    total = db.read(f"SELECT COUNT(*) AS n FROM work_items WHERE type = 'task'{scope}", tuple(scope_params))[0]["n"]
    print(f"\nTasks in scope: {total}")
    for r in sorted(
        db.read(f"SELECT status, COUNT(*) AS n FROM work_items WHERE type = 'task'{scope} GROUP BY status", tuple(scope_params)),
        key=lambda r: -r["n"],
    ):
        print(f"  {r['status'] or '(empty)':<16} {r['n']}")
    if total == 0:
        print("  (no tasks at all — this is a data question, not a status one:")
        print("   run scripts/where_did_my_tasks_go.py)")

    where, params = _where(args, user_id)

    task_rows = db.read(f"SELECT status, COUNT(*) AS n FROM work_items WHERE type = 'task' AND {where} GROUP BY status", tuple(params))
    print("\nTasks that would move to backlog:")
    for r in sorted(task_rows, key=lambda r: -r["n"]):
        print(f"  {r['status'] or '(empty)':<16} {r['n']}")
    total_tasks = sum(r["n"] for r in task_rows)
    print(f"  {'total':<16} {total_tasks}")

    total_stories = 0
    if args.stories:
        # Stories carry no created_by; scope them by project only.
        s_where, s_params = _where(argparse.Namespace(**{**vars(args)}), None)
        story_rows = db.read(
            f"SELECT status, COUNT(*) AS n FROM work_items WHERE type = 'story' AND {s_where} GROUP BY status",
            tuple(s_params),
        )
        print("\nStories that would move to backlog:")
        for r in sorted(story_rows, key=lambda r: -r["n"]):
            print(f"  {r['status'] or '(empty)':<16} {r['n']}")
        total_stories = sum(r["n"] for r in story_rows)
        print(f"  {'total':<16} {total_stories}")

    if not args.apply:
        print("\nDry run — nothing was written. Re-run with --apply.")
        return
    if total_tasks == 0 and total_stories == 0:
        print("\nNothing to do.")
        return

    db.write(f"UPDATE work_items SET status = %s WHERE type = 'task' AND {where}", tuple([TARGET, *params]))
    if args.stories:
        s_where, s_params = _where(argparse.Namespace(**{**vars(args)}), None)
        db.write(f"UPDATE work_items SET status = %s WHERE type = 'story' AND {s_where}", tuple([TARGET, *s_params]))
    db.commit()
    print(f"\nMoved {total_tasks} task(s)" + (f" and {total_stories} story(ies)" if args.stories else "") + " to backlog.")


if __name__ == "__main__":
    main()
