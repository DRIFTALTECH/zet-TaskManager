"""Kill database sessions that are stuck holding locks. Run as the OWNER.

A session left 'idle in transaction' holds its locks forever. Anything that
needs an exclusive lock queues behind it, and because Postgres lock queues are
FIFO, every later reader of that table queues too — so one dead session makes a
table completely unusable and each retry adds to the pile.

This terminates only sessions that are stuck: idle in transaction, or waiting on
a lock. It never touches a healthy connection, and it changes no data.

    cd backend
    python scripts/unstick_db.py            # show what is stuck
    python scripts/unstick_db.py --apply    # kill it
"""
from __future__ import annotations

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database.database import get_database  # noqa: E402


def _stuck(db):
    # pg_stat_activity only: this query can never itself block on a table lock.
    return db.read(
        """
        SELECT pid, usename, state,
               ROUND(EXTRACT(EPOCH FROM (now() - COALESCE(xact_start, query_start))))::int AS age_s,
               pg_blocking_pids(pid) AS blockers,
               LEFT(COALESCE(query, ''), 70) AS q
        FROM pg_stat_activity
        WHERE datname = current_database()
          AND pid <> pg_backend_pid()
          AND (state = 'idle in transaction'
               OR (state = 'active' AND wait_event_type = 'Lock'))
        ORDER BY age_s DESC NULLS LAST
        """
    )


def main() -> int:
    ap = argparse.ArgumentParser(description="Terminate stuck database sessions.")
    ap.add_argument("--apply", action="store_true", help="actually terminate them")
    ap.add_argument("--min-age", type=int, default=30,
                    help="only sessions stuck longer than this many seconds (default 30)")
    args = ap.parse_args()

    db = get_database()
    db.enter_request_scope()

    rows = [r for r in _stuck(db) if (r["age_s"] or 0) >= args.min_age]
    if not rows:
        print("Nothing is stuck. The database is clear.")
        return 0

    print(f"{'pid':<9}{'state':<24}{'age':>7}  blocked by")
    for r in rows:
        print(f"  {r['pid']:<7}{r['state']:<24}{r['age_s']:>5}s  {r['blockers'] or '-'}")
        print(f"      {r['q']}")

    if not args.apply:
        print(f"\n{len(rows)} stuck session(s). Re-run with --apply to terminate them.")
        return 0

    # Kill the ones blocking others first, so the queue drains cleanly.
    order = sorted(rows, key=lambda r: (len(r["blockers"] or []), -(r["age_s"] or 0)))
    for r in order:
        killed = db.read("SELECT pg_terminate_backend(%s) AS ok", (r["pid"],))
        print(f"  terminated pid={r['pid']}  ({killed[0]['ok'] if killed else '?'})")

    left = [r for r in _stuck(db) if (r["age_s"] or 0) >= args.min_age]
    if left:
        print(f"\n{len(left)} still stuck:")
        for r in left:
            print(f"  pid={r['pid']} {r['state']} {r['age_s']}s")
        return 1
    print("\nDatabase is clear. Now: stop the API, then run "
          "scripts/repoint_work_item_fks.py --apply")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
