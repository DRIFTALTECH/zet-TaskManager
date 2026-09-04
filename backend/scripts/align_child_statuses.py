"""Bring every subtask's status in line with the task it belongs to.

The cascade only fires when something is moved, so work that drifted apart
before it existed stays that way — a task in Testing with a subtask still
showing In Review.

Deliberately only subtasks. A story's task is board-level work that may sit in
its own column on purpose, so pushing the story's status onto it would undo a
real decision; a subtask has no independent place on the board and always
belongs with its task.

Only `status` changes. Nothing is created, deleted or re-parented.

    python scripts/align_child_statuses.py            # dry run: lists the drift
    python scripts/align_child_statuses.py --apply
    python scripts/align_child_statuses.py --project p123 --apply
"""
from __future__ import annotations

import argparse
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database.database import get_database  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="write the changes (default: dry run)")
    ap.add_argument("--project", help="only this project id")
    args = ap.parse_args()

    db = get_database()
    db.enter_request_scope()

    scope, params = ("", [])
    if args.project:
        scope, params = " WHERE project_id = %s", [args.project]

    tasks = db.read(f"SELECT id, parent_task_id, status, title FROM tasks{scope}", tuple(params))

    children_of: dict[str, list[dict]] = {}
    for t in tasks:
        if t.get("parent_task_id"):
            children_of.setdefault(t["parent_task_id"], []).append(t)

    task_fixes: list[tuple[str, str, str, str]] = []   # id, title, from, to

    def walk(task: dict, want: str, seen: set[str]) -> None:
        if task["id"] in seen:
            return
        seen.add(task["id"])
        for child in children_of.get(task["id"], []):
            if (child.get("status") or "") != want:
                task_fixes.append((child["id"], child["title"], child.get("status") or "", want))
            walk(child, want, seen)

    for t in tasks:
        if t.get("parent_task_id"):
            continue  # reached through its own parent instead
        walk(t, t.get("status") or "backlog", set())

    print(f"\nSubtasks out of step with their task: {len(task_fixes)}")
    for _tid, title, was, want in task_fixes[:40]:
        print(f"  {title[:56]:<58} {was or '(empty)':<14} -> {want}")
    if len(task_fixes) > 40:
        print(f"  … and {len(task_fixes) - 40} more")

    if not args.apply:
        print("\nDry run — nothing was written. Re-run with --apply.")
        return
    if not task_fixes:
        print("\nNothing to do.")
        return

    for tid, _title, _was, want in task_fixes:
        db.write("UPDATE tasks SET status = %s WHERE id = %s", (want, tid))
    db.commit()
    print(f"\nAligned {len(task_fixes)} subtask(s).")


if __name__ == "__main__":
    main()
