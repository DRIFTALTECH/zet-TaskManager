"""Read-only: are the tasks gone, or just not being shown?

Counts what is actually in the database and prints the recent delete/convert
history from the audit log, so a "my tasks vanished" report can be answered with
evidence instead of a guess. Writes nothing.

    python scripts/where_did_my_tasks_go.py
    python scripts/where_did_my_tasks_go.py --email someone@example.com
"""
from __future__ import annotations

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database.database import get_database  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--email", help="only this person's created work")
    ap.add_argument("--days", type=int, default=7, help="how far back to read the audit log")
    args = ap.parse_args()

    db = get_database()
    db.enter_request_scope()
    try:  # Postgres only; the local SQLite build has no current_user.
        print("connected as:", db.read("SELECT current_user AS u")[0]["u"])
    except Exception:
        pass

    who = None
    if args.email:
        rows = db.read("SELECT id, name FROM users WHERE email = %s", (args.email,))
        if not rows:
            print(f"No user with email {args.email}")
            return
        who = rows[0]["id"]
        print(f"user: {rows[0]['name']} ({who})")

    print("\nRows still in the database:")
    for label, sql, params in (
        ("tasks", "SELECT COUNT(*) AS n FROM tasks", ()),
        ("  top-level", "SELECT COUNT(*) AS n FROM tasks WHERE parent_task_id IS NULL", ()),
        ("  subtasks", "SELECT COUNT(*) AS n FROM tasks WHERE parent_task_id IS NOT NULL", ()),
        ("  in a story", "SELECT COUNT(*) AS n FROM tasks WHERE user_story_id IS NOT NULL", ()),
        ("user_stories", "SELECT COUNT(*) AS n FROM user_stories", ()),
        ("projects", "SELECT COUNT(*) AS n FROM projects", ()),
    ):
        print(f"  {label:<14} {db.read(sql, params)[0]['n']}")

    if who:
        n = db.read("SELECT COUNT(*) AS n FROM tasks WHERE created_by = %s", (who,))[0]["n"]
        print(f"  created by them  {n}")

    print(f"\nDeletes and conversions in the audit log (last {args.days} days):")
    rows = db.read(
        """
        SELECT a.created_at, a.action, a.entity_name, u.email
        FROM audit_logs a
        LEFT JOIN users u ON u.id = a.user_id
        WHERE a.action IN (
            'task.deleted', 'user_story.deleted',
            'task.converted_to_story', 'user_story.converted_to_task'
        )
        ORDER BY a.created_at DESC
        LIMIT 100
        """
    )
    if not rows:
        print("  nothing — no task or story was deleted or converted")
    for r in rows:
        print(f"  {r['created_at']}  {r['action']:<28} {r['email'] or '?':<28} {r['entity_name']}")


if __name__ == "__main__":
    main()
