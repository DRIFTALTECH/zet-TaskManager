"""Bootstrap schema and default seeds via db_wrapper."""
from __future__ import annotations

import json
import uuid
from datetime import date, timedelta
from pathlib import Path

from db_wrapper import get_database
from db_wrapper.dialect import use_sqlite

_BOOTSTRAP_AURORA = (Path(__file__).resolve().parent.parent / "scripts" / "bootstrap_aurora.sql").read_text(
    encoding="utf-8"
)
_BOOTSTRAP_SQLITE = (Path(__file__).resolve().parent.parent / "scripts" / "bootstrap_sqlite.sql").read_text(
    encoding="utf-8"
)

_DEFAULT_KANBAN = [
    ("backlog", "Backlog", 0),
    ("in_progress", "In Progress", 1),
    ("testing", "Testing", 2),
    ("in_review", "In Review", 3),
    ("done", "Done", 4),
]


def _run_bootstrap() -> None:
    db = get_database()
    sql = _BOOTSTRAP_SQLITE if use_sqlite() else _BOOTSTRAP_AURORA
    for stmt in sql.split(";"):
        s = stmt.strip()
        if s:
            db.write(s)


def _seed_kanban() -> None:
    db = get_database()
    rows = db.read("SELECT id FROM kanban_columns LIMIT 1")
    if rows:
        return
    for kid, label, pos in _DEFAULT_KANBAN:
        db.write(
            "INSERT INTO kanban_columns (id, label, position) VALUES (%s, %s, %s)",
            (kid, label, pos),
        )


def _migrate_submitted_dates() -> None:
    """Add submitted_dates column and backfill legacy full-week rows."""
    db = get_database()
    try:
        db.write(
            "ALTER TABLE timesheet_submissions ADD COLUMN submitted_dates TEXT NOT NULL DEFAULT '[]'"
        )
    except Exception:
        pass  # ponytail: column already exists
    rows = db.read(
        "SELECT id, week_start, status, submitted_dates FROM timesheet_submissions"
    )
    for row in rows:
        raw = row.get("submitted_dates") or "[]"
        if raw not in ("", "[]"):
            continue
        if row.get("status") not in ("submitted", "approved", "rejected"):
            continue
        ws = row["week_start"]
        encoded = json.dumps([(date.fromisoformat(ws) + timedelta(days=i)).isoformat() for i in range(7)])
        db.write(
            "UPDATE timesheet_submissions SET submitted_dates = %s WHERE id = %s",
            (encoded, row["id"]),
        )


def _migrate_task_min_log_minutes() -> None:
    db = get_database()
    try:
        db.write(
            "ALTER TABLE tasks ADD COLUMN min_log_minutes INTEGER NOT NULL DEFAULT 1"
        )
    except Exception:
        pass  # ponytail: column already exists


def _migrate_clients() -> None:
    db = get_database()
    db.write(
        """
        CREATE TABLE IF NOT EXISTS clients (
            id VARCHAR PRIMARY KEY,
            name VARCHAR NOT NULL,
            created_at VARCHAR NOT NULL
        )
        """
    )
    try:
        db.write("ALTER TABLE projects ADD COLUMN client_id VARCHAR REFERENCES clients (id)")
    except Exception:
        pass  # ponytail: column already exists


def _migrate_skills() -> None:
    db = get_database()
    db.write(
        """
        CREATE TABLE IF NOT EXISTS skills (
            id VARCHAR PRIMARY KEY,
            name VARCHAR NOT NULL,
            created_at VARCHAR NOT NULL
        )
        """
    )
    db.write(
        """
        CREATE TABLE IF NOT EXISTS user_skills (
            user_id VARCHAR NOT NULL REFERENCES users (id) ON DELETE CASCADE,
            skill_id VARCHAR NOT NULL REFERENCES skills (id) ON DELETE CASCADE,
            PRIMARY KEY (user_id, skill_id)
        )
        """
    )
    db.write(
        """
        CREATE TABLE IF NOT EXISTS task_skills (
            task_id VARCHAR NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
            skill_id VARCHAR NOT NULL REFERENCES skills (id) ON DELETE CASCADE,
            PRIMARY KEY (task_id, skill_id)
        )
        """
    )


def init_db() -> None:
    _run_bootstrap()
    _migrate_submitted_dates()
    _migrate_task_min_log_minutes()
    _migrate_clients()
    _migrate_skills()
    _seed_kanban()
    from logic.audit import purge_old_audit_logs

    purge_old_audit_logs(get_database())


def new_id(prefix: str) -> str:
    return f"{prefix}{uuid.uuid4().hex[:10]}"
