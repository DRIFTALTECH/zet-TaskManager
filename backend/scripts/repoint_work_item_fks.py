"""Point the child tables' foreign keys at work_items. Run as the OWNER.

WHY THIS EXISTS
    Tasks and stories moved into work_items, but a table keeps the constraints
    it was created with — editing the schema files does nothing to a database
    that already exists. So task_timer_runs.task_id still referenced tasks(id),
    and starting a timer inserted an id that lives in work_items and not in
    tasks. Postgres rejected it, FastAPI returned 500, and the browser reported
    a CORS error because a crashed response never reaches the CORS middleware.

TWO THINGS THIS SCRIPT IS CAREFUL ABOUT
    1. It does every read FIRST and then drops the read connection. Holding a
       read transaction open while asking for the ACCESS EXCLUSIVE lock that
       DROP CONSTRAINT needs makes the script block on itself, forever.
    2. It sets lock_timeout. Anything still holding those tables — the API, a
       psql window — makes the ALTER wait, and without a timeout it waits for
       hours while queueing every other query behind it. Now it gives up in
       seconds and tells you which process to deal with.

    STOP THE API FIRST. These are exclusive locks; the tables are small, so the
    whole thing takes under a second once nothing else is holding them.

ORPHANS
    A child row whose parent is not in work_items would break the new
    constraint. Those rows are KEPT by default and the constraint is added
    NOT VALID: new rows are checked, existing ones are left alone, so a schema
    fix never deletes recorded hours. Pass --drop-orphans to remove them and get
    a fully validated constraint instead.

    cd backend
    python scripts/repoint_work_item_fks.py                  # report only
    python scripts/repoint_work_item_fks.py --apply
    python scripts/repoint_work_item_fks.py --apply --drop-orphans
"""
from __future__ import annotations

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database.database import get_database  # noqa: E402

# task_assignees and user_story_assignees are deliberately left alone: nothing
# reads or writes them any more, work_item_assignees replaced them.
CHILDREN = [
    ("task_attachments", "task_id"),
    ("task_checklists", "task_id"),
    ("task_feedback", "task_id"),
    ("task_skills", "task_id"),
    ("task_time_logs", "task_id"),
    ("task_timer_runs", "task_id"),
    ("user_story_attachments", "user_story_id"),
    ("user_story_feedback", "user_story_id"),
]

LOCK_TIMEOUT = "10s"


def _survey(db) -> tuple[str, str, list[dict]]:
    """Everything the write phase needs, gathered before any lock is taken."""
    me = db.read("SELECT current_user AS u")[0]["u"]
    owner_rows = db.read("SELECT tableowner FROM pg_tables WHERE tablename = 'work_items'")
    owner = owner_rows[0]["tableowner"] if owner_rows else ""

    present = {
        r["table_name"]
        for r in db.read(
            "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"
        )
    }
    cons = db.read(
        """
        SELECT tc.table_name AS child, kcu.column_name AS col,
               tc.constraint_name AS con, ccu.table_name AS points_at
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON kcu.constraint_name = tc.constraint_name
        JOIN information_schema.constraint_column_usage ccu
          ON ccu.constraint_name = tc.constraint_name
        WHERE tc.constraint_type = 'FOREIGN KEY'
        """
    )
    by_child = {(r["child"], r["col"]): r for r in cons}

    plan = []
    for table, column in CHILDREN:
        if table not in present:
            continue
        row = by_child.get((table, column))
        orphans = db.read(
            f"SELECT COUNT(*) AS n FROM {table} c "
            f"WHERE NOT EXISTS (SELECT 1 FROM work_items w WHERE w.id = c.{column})"
        )[0]["n"]
        plan.append({
            "table": table, "column": column,
            "con": row["con"] if row else None,
            "points_at": row["points_at"] if row else None,
            "orphans": int(orphans),
        })
    return me, owner, plan


def _blockers(db) -> list[dict]:
    return db.read(
        """
        SELECT pid, usename, state,
               ROUND(EXTRACT(EPOCH FROM (now() - COALESCE(xact_start, query_start))))::int AS age_s,
               LEFT(COALESCE(query, ''), 70) AS q
        FROM pg_stat_activity
        WHERE datname = current_database() AND pid <> pg_backend_pid()
          AND state IN ('idle in transaction', 'active')
        ORDER BY age_s DESC NULLS LAST
        """
    )


def main() -> int:
    ap = argparse.ArgumentParser(description="Repoint child foreign keys at work_items.")
    ap.add_argument("--apply", action="store_true", help="actually change them")
    ap.add_argument("--drop-orphans", action="store_true",
                    help="delete rows with no parent instead of keeping them")
    args = ap.parse_args()

    db = get_database()

    # ---- read phase, then let the read connection go -----------------------
    db.enter_request_scope()
    try:
        me, owner, plan = _survey(db)
        busy = _blockers(db) if args.apply else []
    finally:
        db.exit_request_scope()

    if not owner:
        print("work_items does not exist here. Nothing to repoint.")
        return 1
    print(f"connected as {me}; work_items owned by {owner}")
    if me != owner:
        print(f"\nRefusing: only {owner} can alter these constraints.")
        return 1

    print(f"\n{'table':<26}{'points at':<14}{'orphans':>9}")
    for p in plan:
        print(f"  {p['table']:<24}{p['points_at'] or '(none)':<14}{p['orphans']:>9}")

    todo = [p for p in plan if p["points_at"] != "work_items"]
    if not todo:
        print("\nEvery foreign key already points at work_items. Nothing to do.")
        return 0

    if not args.apply:
        total = sum(p["orphans"] for p in todo)
        print(f"\n{len(todo)} constraint(s) to repoint, {total} orphaned row(s).")
        if total:
            print("Orphans are KEPT (constraint added NOT VALID). "
                  "Pass --drop-orphans to delete them instead.")
        print("\nStop the API before applying — these need exclusive table locks.")
        print("Re-run with --apply.")
        return 0

    if busy:
        print("\nOther sessions are on this database right now:")
        for b in busy:
            print(f"  pid={b['pid']} {b['usename']} {b['state']} {b['age_s']}s  {b['q']}")
        print("An ALTER waits behind these. If it times out below, stop the API "
              "(or terminate the pid) and re-run.")

    # ---- write phase --------------------------------------------------------
    db.enter_request_scope()
    failed = []
    try:
        # Give up quickly instead of queueing every other query behind us.
        db.write(f"SET lock_timeout = '{LOCK_TIMEOUT}'")
        for p in todo:
            table, column, con, orphans = p["table"], p["column"], p["con"], p["orphans"]
            try:
                if orphans and args.drop_orphans:
                    db.write(
                        f"DELETE FROM {table} c WHERE NOT EXISTS "
                        f"(SELECT 1 FROM work_items w WHERE w.id = c.{column})"
                    )
                    print(f"  deleted {orphans} orphaned row(s) from {table}")
                    orphans = 0
                if con:
                    db.write(f"ALTER TABLE {table} DROP CONSTRAINT {con}")
                suffix = " NOT VALID" if orphans else ""
                db.write(
                    f"ALTER TABLE {table} ADD CONSTRAINT {table}_{column}_work_items_fkey "
                    f"FOREIGN KEY ({column}) REFERENCES work_items (id) "
                    f"ON DELETE CASCADE{suffix}"
                )
                print(f"  OK  {table}.{column} -> work_items{suffix}")
            except Exception as e:
                failed.append(table)
                name = type(e).__name__
                if "LockNotAvailable" in name or "lock timeout" in str(e).lower():
                    print(f"  LOCKED  {table}: something else holds this table. "
                          f"Stop the API and re-run.")
                else:
                    print(f"  FAILED  {table}: {name}: {e}")
        db.commit()
    finally:
        db.exit_request_scope()

    db.enter_request_scope()
    try:
        _, _, after = _survey(db)
    finally:
        db.exit_request_scope()

    print("\nVerifying:")
    ok = True
    for p in after:
        good = p["points_at"] == "work_items"
        ok &= good
        print(f"  {'OK ' if good else 'STILL STALE'}  {p['table']}.{p['column']} -> {p['points_at']}")

    print("\nDone — restart the API." if ok else "\nSome constraints are still stale.")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
