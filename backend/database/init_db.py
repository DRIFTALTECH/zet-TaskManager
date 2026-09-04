"""Bootstrap schema and default seeds via db_wrapper."""
from __future__ import annotations

import json
import logging
import uuid
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from db_wrapper import get_database
from db_wrapper.dialect import use_sqlite

log = logging.getLogger("zet")

_BOOTSTRAP_AURORA = (Path(__file__).resolve().parent.parent / "scripts" / "bootstrap_aurora.sql").read_text(
    encoding="utf-8"
)
_BOOTSTRAP_SQLITE = (Path(__file__).resolve().parent.parent / "scripts" / "bootstrap_sqlite.sql").read_text(
    encoding="utf-8"
)

_DEFAULT_KANBAN = [
    ("backlog", "Backlog", 0, "slate"),
    ("in_progress", "In Progress", 1, "violet"),
    ("testing", "Testing", 2, "amber"),
    ("in_review", "In Review", 3, "sky"),
    ("done", "Done", 4, "emerald"),
]


def _run_bootstrap() -> None:
    """Apply CREATE TABLE IF NOT EXISTS + safe indexes.

    On existing DBs, CREATE TABLE IF NOT EXISTS is a no-op (old column set remains).
    Column upgrades belong in _migrate_* helpers. Soft-skip index/constraint errors
    that mean a column is not present yet so later migrations can add it.
    """
    db = get_database()
    # CREATE TABLE IF NOT EXISTS still needs CREATE on schema public. Skip the
    # whole script when the cluster is already bootstrapped so a DML-only IAM
    # role can start the process.
    if not use_sqlite() and _table_exists(db, "users"):
        return
    sql = _BOOTSTRAP_SQLITE if use_sqlite() else _BOOTSTRAP_AURORA
    for stmt in sql.split(";"):
        s = stmt.strip()
        if not s:
            continue
        try:
            db.write(s)
        except Exception as e:
            msg = str(e).lower()
            if (
                "does not exist" in msg
                or "undefinedcolumn" in msg
                or "no such column" in msg
                or "already exists" in msg
            ):
                continue
            raise


def _seed_kanban() -> None:
    db = get_database()
    rows = db.read("SELECT id FROM kanban_columns LIMIT 1")
    if rows:
        return
    for kid, label, pos, color in _DEFAULT_KANBAN:
        db.write(
            "INSERT INTO kanban_columns (id, label, position, color) VALUES (%s, %s, %s, %s)",
            (kid, label, pos, color),
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


def _migrate_task_sprint() -> None:
    """Free-text sprint on every task. Existing rows get ''."""
    db = get_database()
    _add_column_if_missing(db, "tasks", "sprint", "VARCHAR NOT NULL DEFAULT ''")


def _migrate_task_estimated_hours() -> None:
    """Optional estimate on every task. Null = not set (not the 1-minute timer floor)."""
    db = get_database()
    _add_column_if_missing(db, "tasks", "estimated_hours", "VARCHAR")


def _migrate_timesheet_entry_task_link() -> None:
    """Timesheet rows that came from a task remember which one.

    Without the link a task's hours cannot be revised: closing a task that was
    also timed would append a second row instead of replacing the timer's.
    """
    db = get_database()
    _add_column_if_missing(db, "timesheet_entries", "task_id", "VARCHAR")
    try:
        db.write(
            "CREATE INDEX IF NOT EXISTS ix_timesheet_entries_task "
            "ON timesheet_entries (task_id)"
        )
    except Exception:
        pass


def _migrate_user_story_parent() -> None:
    """Nullable parent on a story, so one can sit under another.

    Best effort: on a database where the app role cannot ALTER `user_stories`
    the column simply never appears, and the CRUD layer packs the link into the
    same field it already uses for the other columns it cannot add.
    """
    db = get_database()
    if not _table_exists(db, "user_stories"):
        return
    _add_column_if_missing(db, "user_stories", "parent_story_id", "VARCHAR")
    try:
        db.write(
            "CREATE INDEX IF NOT EXISTS ix_user_stories_parent "
            "ON user_stories (parent_story_id)"
        )
    except Exception:
        pass


def _migrate_story_status_from_tasks() -> None:
    """One-off: lift stories that were left in Backlog while their tasks moved on.

    Stories only started following their tasks when that rule was added, so every
    story created before it still sits wherever it was last put by hand. Runs
    once — a story deliberately pushed back to Backlog must stay there, so this
    cannot be allowed to re-run on every boot.
    """
    db = get_database()
    if not (_table_exists(db, "user_stories") and _table_exists(db, "tasks")):
        return
    import crud.settings as settings_crud

    flag = "story_status_backfill_v1"
    try:
        if settings_crud.get(db, flag):
            return
    except Exception:
        return  # app_settings not ready yet; try again next boot

    working = "('backlog', 'done', 'completed')"
    try:
        rows = db.read(
            f"""
            SELECT s.id AS story_id,
                   (SELECT t.status FROM tasks t
                     WHERE t.user_story_id = s.id AND t.status NOT IN {working}
                     LIMIT 1) AS task_status
            FROM user_stories s
            WHERE s.status = 'backlog'
            """
        )
        now = datetime.now(timezone.utc).isoformat()
        moved = 0
        for row in rows:
            status = (row.get("task_status") or "").strip()
            if not status:
                continue
            db.write(
                "UPDATE user_stories SET status = %s, updated_at = %s WHERE id = %s",
                (status, now, row["story_id"]),
            )
            moved += 1
        settings_crud.set(db, flag, "done")
        if moved:
            log.info("Backfilled %s user story statuses from their tasks", moved)
    except Exception:
        log.warning("Story status backfill skipped", exc_info=True)


def _migrate_clients() -> None:
    db = get_database()
    _create_table_if_missing(
        db,
        "clients",
        """
        CREATE TABLE IF NOT EXISTS clients (
            id VARCHAR PRIMARY KEY,
            name VARCHAR NOT NULL,
            created_at VARCHAR NOT NULL
        )
        """,
    )
    try:
        db.write("ALTER TABLE projects ADD COLUMN client_id VARCHAR REFERENCES clients (id)")
    except Exception:
        pass  # ponytail: column already exists


def _migrate_skills() -> None:
    db = get_database()
    _create_table_if_missing(
        db,
        "skills",
        """
        CREATE TABLE IF NOT EXISTS skills (
            id VARCHAR PRIMARY KEY,
            name VARCHAR NOT NULL,
            created_at VARCHAR NOT NULL
        )
        """,
    )
    _create_table_if_missing(
        db,
        "user_skills",
        """
        CREATE TABLE IF NOT EXISTS user_skills (
            user_id VARCHAR NOT NULL REFERENCES users (id) ON DELETE CASCADE,
            skill_id VARCHAR NOT NULL REFERENCES skills (id) ON DELETE CASCADE,
            PRIMARY KEY (user_id, skill_id)
        )
        """,
    )
    _create_table_if_missing(
        db,
        "task_skills",
        """
        CREATE TABLE IF NOT EXISTS task_skills (
            task_id VARCHAR NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
            skill_id VARCHAR NOT NULL REFERENCES skills (id) ON DELETE CASCADE,
            PRIMARY KEY (task_id, skill_id)
        )
        """,
    )


def _create_table_if_missing(db, table: str, ddl: str) -> None:
    """Skip CREATE TABLE when the relation already exists.

    Postgres still demands CREATE on schema public for IF NOT EXISTS, which a
    least-privilege IAM role (app_user) will not have on a live cluster.
    """
    if _table_exists(db, table):
        return
    db.write(ddl)


def _table_exists(db, table: str) -> bool:
    if use_sqlite():
        rows = db.read(
            "SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = %s",
            (table,),
        )
        return bool(rows)
    rows = db.read(
        """
        SELECT 1 AS ok FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = %s
        """,
        (table,),
    )
    return bool(rows)


def _column_exists(db, table: str, column: str) -> bool:
    """True when `table.column` is present (works on Aurora and SQLite)."""
    if use_sqlite():
        # PRAGMA cannot be parameterized; table names are internal constants only.
        rows = db.read(f"PRAGMA table_info({table})")
        return any((r.get("name") or "") == column for r in rows)
    rows = db.read(
        """
        SELECT 1 AS ok FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = %s AND column_name = %s
        """,
        (table, column),
    )
    return bool(rows)


def _add_column_if_missing(db, table: str, column: str, ddl_type: str) -> None:
    """Idempotent ADD COLUMN — never drops/recreates the table."""
    if not _table_exists(db, table) or _column_exists(db, table, column):
        return
    # Prefer IF NOT EXISTS when the engine supports it; fall back to plain ADD.
    sql = f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {column} {ddl_type}"
    try:
        db.write(sql)
        return
    except Exception as e1:
        try:
            db.write(f"ALTER TABLE {table} ADD COLUMN {column} {ddl_type}")
        except Exception as e2:
            log.warning("Could not add %s.%s: %s / %s", table, column, e1, e2)


def _ensure_fk(db, table: str, constraint: str, ddl: str) -> None:
    """Add a foreign key if missing (Postgres). SQLite ignores named FK adds on existing tables."""
    if use_sqlite():
        return
    rows = db.read(
        """
        SELECT 1 AS ok FROM information_schema.table_constraints
        WHERE table_schema = 'public' AND table_name = %s AND constraint_name = %s
        """,
        (table, constraint),
    )
    if rows:
        return
    try:
        db.write(ddl)
    except Exception:
        pass  # constraint may already exist under another name


def _migrate_user_story_section_optional() -> None:
    """Stories are project-scoped; section_id is leftover and optional."""
    db = get_database()
    if use_sqlite():
        info = db.read("PRAGMA table_info(user_stories)")
        col = next((r for r in info if (r.get("name") or "") == "section_id"), None)
        if not col or not col.get("notnull"):
            return
        db.write("PRAGMA foreign_keys = OFF")
        db.write(
            """
            CREATE TABLE user_stories__new (
                id VARCHAR PRIMARY KEY,
                project_id VARCHAR NOT NULL REFERENCES projects (id),
                section_id VARCHAR REFERENCES sections (id),
                title VARCHAR NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                acceptance_criteria TEXT NOT NULL DEFAULT '',
                priority VARCHAR NOT NULL DEFAULT 'Medium',
                status VARCHAR NOT NULL DEFAULT 'backlog',
                assignee_id VARCHAR REFERENCES users (id),
                reporter_id VARCHAR NOT NULL REFERENCES users (id),
                estimated_hours VARCHAR,
                story_points VARCHAR,
                start_date VARCHAR,
                due_date VARCHAR,
                created_at VARCHAR NOT NULL,
                updated_at VARCHAR NOT NULL
            )
            """
        )
        db.write("INSERT INTO user_stories__new SELECT * FROM user_stories")
        db.write("DROP TABLE user_stories")
        db.write("ALTER TABLE user_stories__new RENAME TO user_stories")
        db.write("CREATE INDEX IF NOT EXISTS ix_user_stories_project_id ON user_stories (project_id)")
        db.write("CREATE INDEX IF NOT EXISTS ix_user_stories_section_id ON user_stories (section_id)")
        db.write("PRAGMA foreign_keys = ON")
        return
    try:
        db.write("ALTER TABLE user_stories ALTER COLUMN section_id DROP NOT NULL")
    except Exception:
        pass


def _migrate_user_stories() -> None:
    """Additive upgrade for existing Aurora/SQLite DBs (idempotent, non-destructive).

    Fresh installs already get columns from CREATE TABLE IF NOT EXISTS in bootstrap.
    Existing production DBs keep the old `tasks` table shape until this runs — so
    bootstrap must NOT create indexes on user_story_id/parent_task_id (those live here).
    """
    db = get_database()

    # 1) user_stories table (no-op if present)
    _create_table_if_missing(
        db,
        "user_stories",
        """
        CREATE TABLE IF NOT EXISTS user_stories (
            id VARCHAR PRIMARY KEY,
            project_id VARCHAR NOT NULL REFERENCES projects (id),
            section_id VARCHAR REFERENCES sections (id),
            title VARCHAR NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            acceptance_criteria TEXT NOT NULL DEFAULT '',
            priority VARCHAR NOT NULL DEFAULT 'Medium',
            status VARCHAR NOT NULL DEFAULT 'backlog',
            assignee_id VARCHAR REFERENCES users (id),
            reporter_id VARCHAR NOT NULL REFERENCES users (id),
            estimated_hours VARCHAR,
            story_points VARCHAR,
            start_date VARCHAR,
            due_date VARCHAR,
            created_at VARCHAR NOT NULL,
            updated_at VARCHAR NOT NULL
        )
        """,
    )

    # 2) Nullable hierarchy columns on existing tasks (NULL = legacy standalone tasks)
    if _table_exists(db, "tasks"):
        _add_column_if_missing(db, "tasks", "user_story_id", "VARCHAR")
        _add_column_if_missing(db, "tasks", "parent_task_id", "VARCHAR")
        _ensure_fk(
            db,
            "tasks",
            "fk_tasks_user_story_id",
            "ALTER TABLE tasks ADD CONSTRAINT fk_tasks_user_story_id "
            "FOREIGN KEY (user_story_id) REFERENCES user_stories (id) ON DELETE SET NULL",
        )
        _ensure_fk(
            db,
            "tasks",
            "fk_tasks_parent_task_id",
            "ALTER TABLE tasks ADD CONSTRAINT fk_tasks_parent_task_id "
            "FOREIGN KEY (parent_task_id) REFERENCES tasks (id) ON DELETE CASCADE",
        )

    # 3) Multi-assignee + attachments (mirror task_assignees / task_attachments)
    _create_table_if_missing(
        db,
        "user_story_assignees",
        """
        CREATE TABLE IF NOT EXISTS user_story_assignees (
            user_story_id VARCHAR NOT NULL REFERENCES user_stories (id) ON DELETE CASCADE,
            user_id VARCHAR NOT NULL REFERENCES users (id) ON DELETE CASCADE,
            position INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (user_story_id, user_id)
        )
        """,
    )
    _create_table_if_missing(
        db,
        "user_story_attachments",
        """
        CREATE TABLE IF NOT EXISTS user_story_attachments (
            id VARCHAR PRIMARY KEY,
            user_story_id VARCHAR NOT NULL REFERENCES user_stories (id) ON DELETE CASCADE,
            filename VARCHAR NOT NULL,
            stored_name VARCHAR NOT NULL,
            content_type VARCHAR NOT NULL DEFAULT 'application/octet-stream',
            size_bytes INTEGER NOT NULL DEFAULT 0,
            uploaded_by VARCHAR NOT NULL REFERENCES users (id),
            created_at VARCHAR NOT NULL
        )
        """,
    )

    _create_table_if_missing(
        db,
        "user_story_feedback",
        """
        CREATE TABLE IF NOT EXISTS user_story_feedback (
            id VARCHAR PRIMARY KEY,
            user_story_id VARCHAR NOT NULL REFERENCES user_stories (id) ON DELETE CASCADE,
            user_id VARCHAR NOT NULL REFERENCES users (id),
            message TEXT NOT NULL,
            created_at VARCHAR NOT NULL,
            updated_at VARCHAR NOT NULL
        )
        """,
    )

    # Backfill assignees from legacy single assignee_id
    try:
        rows = db.read(
            """
            SELECT id, assignee_id FROM user_stories
            WHERE assignee_id IS NOT NULL AND assignee_id != ''
            """
        )
        for row in rows:
            existing = db.read(
                "SELECT 1 AS ok FROM user_story_assignees WHERE user_story_id = %s LIMIT 1",
                (row["id"],),
            )
            if existing:
                continue
            db.write(
                """
                INSERT INTO user_story_assignees (user_story_id, user_id, position)
                VALUES (%s, %s, 0)
                """,
                (row["id"], row["assignee_id"]),
            )
    except Exception:
        pass

    # 4) Indexes only after columns exist
    for stmt in (
        "CREATE INDEX IF NOT EXISTS ix_user_stories_project_id ON user_stories (project_id)",
        "CREATE INDEX IF NOT EXISTS ix_user_stories_section_id ON user_stories (section_id)",
        "CREATE INDEX IF NOT EXISTS ix_tasks_user_story_id ON tasks (user_story_id)",
        "CREATE INDEX IF NOT EXISTS ix_tasks_parent_task_id ON tasks (parent_task_id)",
        "CREATE INDEX IF NOT EXISTS ix_user_story_attachments_story ON user_story_attachments (user_story_id)",
        "CREATE INDEX IF NOT EXISTS ix_user_story_feedback_story ON user_story_feedback (user_story_id)",
    ):
        try:
            # Skip task indexes until the column is present (defensive)
            if "ix_tasks_user_story_id" in stmt and not _column_exists(db, "tasks", "user_story_id"):
                continue
            if "ix_tasks_parent_task_id" in stmt and not _column_exists(db, "tasks", "parent_task_id"):
                continue
            db.write(stmt)
        except Exception:
            pass


def _migrate_pat_expiry() -> None:
    """Add expires_at to personal access tokens. Existing rows keep '' (never
    expires) so nobody's working MCP connection breaks on deploy; every newly
    issued token gets a real expiry."""
    db = get_database()
    try:
        db.write(
            "ALTER TABLE personal_access_tokens ADD COLUMN expires_at VARCHAR NOT NULL DEFAULT ''"
        )
    except Exception:
        pass  # ponytail: column already exists


def _migrate_forecast_visibility() -> None:
    db = get_database()
    _create_table_if_missing(
        db,
        "forecast_visibility",
        """
        CREATE TABLE IF NOT EXISTS forecast_visibility (
            id VARCHAR PRIMARY KEY,
            entity_type VARCHAR NOT NULL,
            entity_id VARCHAR NOT NULL,
            user_id VARCHAR NOT NULL REFERENCES users (id) ON DELETE CASCADE,
            hidden BOOLEAN NOT NULL DEFAULT FALSE,
            hidden_at VARCHAR,
            restored_at VARCHAR
        )
        """,
    )
    try:
        db.write(
            "CREATE INDEX IF NOT EXISTS ix_forecast_visibility_user_entity ON forecast_visibility (user_id, entity_type, entity_id)"
        )
    except Exception:
        pass


def _migrate_temp_task_assignees() -> None:
    db = get_database()
    _add_column_if_missing(db, "temp_tasks", "assignee_ids", "TEXT NOT NULL DEFAULT '[]'")
    _add_column_if_missing(db, "temp_tasks", "extra_json", "TEXT NOT NULL DEFAULT '{}'")


def _migrate_user_story_board_fields() -> None:
    """Stories carry the same board fields as tasks: sprint, tags, manager approval."""
    db = get_database()
    _add_column_if_missing(db, "user_stories", "sprint", "VARCHAR NOT NULL DEFAULT ''")
    _add_column_if_missing(db, "user_stories", "tags_json", "TEXT NOT NULL DEFAULT '[]'")
    _add_column_if_missing(
        db, "user_stories", "approved_by_manager", "BOOLEAN NOT NULL DEFAULT FALSE"
    )


def _migrate_kanban_color() -> None:
    """Per-column colour. Existing rows get slate; the base columns keep their
    long-standing hardcoded hues so boards look unchanged after the upgrade."""
    db = get_database()
    if not _table_exists(db, "kanban_columns") or _column_exists(db, "kanban_columns", "color"):
        return
    _add_column_if_missing(db, "kanban_columns", "color", "VARCHAR NOT NULL DEFAULT 'slate'")
    # The ADD is soft-failed when the role does not own the table (a DBA applies
    # it out of band). Never backfill against a column that is still missing.
    if not _column_exists(db, "kanban_columns", "color"):
        return
    for kid, _label, _pos, color in _DEFAULT_KANBAN:
        db.write("UPDATE kanban_columns SET color = %s WHERE id = %s", (color, kid))


def init_db() -> None:
    # Bootstrap creates base tables. On existing DBs, CREATE TABLE IF NOT EXISTS is a
    # no-op — new columns are NOT added there. Hierarchy columns/indexes come next.
    _run_bootstrap()
    _migrate_submitted_dates()
    _migrate_task_min_log_minutes()
    _migrate_task_sprint()
    _migrate_task_estimated_hours()
    _migrate_timesheet_entry_task_link()
    _migrate_clients()
    _migrate_skills()
    _migrate_user_stories()
    _migrate_user_story_section_optional()
    _migrate_user_story_board_fields()
    _migrate_forecast_visibility()
    _migrate_pat_expiry()
    _migrate_temp_task_assignees()
    _migrate_kanban_color()
    _migrate_user_story_parent()
    _migrate_story_status_from_tasks()
    _seed_kanban()
    from logic.audit import purge_old_audit_logs

    purge_old_audit_logs(get_database())


def new_id(prefix: str) -> str:
    return f"{prefix}{uuid.uuid4().hex[:10]}"
