"""Apply the additive column migrations that init_db() soft-skips.

kanban_columns, user_stories and temp_tasks are owned by `postgres`, so when the
app boots as the IAM role `app_user` the ADD COLUMN calls are denied and logged
rather than raised — the app keeps running against the older shape. This script
runs the same helpers with a role that owns the tables.

It calls init_db()'s own helpers instead of re-typing the DDL, so the column
types and defaults cannot drift from what the app expects. Every helper is
idempotent (ADD COLUMN IF NOT EXISTS behind a catalog check), so re-running is a
no-op.

Deliberately NOT the whole of init_db(): that also creates foreign keys, drops a
NOT NULL on user_stories.section_id, and purges old audit rows. Those are not
column additions and should be decided on separately.

    DB_USER=postgres python scripts/apply_pending_column_migrations.py
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database.database import get_database  # noqa: E402
from database.init_db import (  # noqa: E402
    _migrate_kanban_color,
    _migrate_temp_task_assignees,
    _migrate_user_story_board_fields,
)

CHECKS = [
    ("kanban_columns", "color"),
    ("user_stories", "sprint"),
    ("user_stories", "tags_json"),
    ("user_stories", "approved_by_manager"),
    ("temp_tasks", "assignee_ids"),
    ("temp_tasks", "extra_json"),
]


def report(db, when: str) -> None:
    print(f"\n{when}:")
    for table, column in CHECKS:
        rows = db.read(
            """
            SELECT 1 AS ok FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = %s AND column_name = %s
            """,
            (table, column),
            primary=True,
        )
        print(f"  {table}.{column}: {'present' if rows else 'MISSING'}")


def main() -> None:
    db = get_database()
    print("connected as:", db.read("SELECT current_user AS u")[0]["u"])
    report(db, "Before")

    _migrate_user_story_board_fields()
    _migrate_temp_task_assignees()
    _migrate_kanban_color()

    report(db, "After")


if __name__ == "__main__":
    main()
