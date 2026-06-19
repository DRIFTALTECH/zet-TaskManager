"""Create tables, run migrations, and ensure default kanban columns only — no demo users or seed data."""

import uuid

from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

from database.database import Base, SessionLocal, engine
from database.models import KanbanColumn, Task, TaskAssignee, User


def migrate_timelogs_if_needed() -> None:
    """Add per-user time logs: (task_id, log_date, user_id) unique; legacy rows use task assignee."""
    insp = inspect(engine)
    if not insp.has_table("task_time_logs"):
        return
    cols = {c["name"] for c in insp.get_columns("task_time_logs")}
    if "user_id" in cols:
        return
    with engine.begin() as conn:
        conn.execute(text("PRAGMA foreign_keys=OFF"))
        conn.execute(
            text(
                """
                CREATE TABLE task_time_logs_new (
                    id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
                    task_id VARCHAR NOT NULL,
                    user_id VARCHAR NOT NULL,
                    log_date VARCHAR NOT NULL,
                    seconds INTEGER NOT NULL DEFAULT 0,
                    FOREIGN KEY(task_id) REFERENCES tasks (id) ON DELETE CASCADE,
                    FOREIGN KEY(user_id) REFERENCES users (id),
                    CONSTRAINT uq_task_time_user_date UNIQUE (task_id, log_date, user_id)
                )
                """
            )
        )
        conn.execute(
            text(
                """
                INSERT INTO task_time_logs_new (id, task_id, user_id, log_date, seconds)
                SELECT tl.id, tl.task_id, t.assigned_to, tl.log_date, tl.seconds
                FROM task_time_logs tl
                INNER JOIN tasks t ON t.id = tl.task_id
                """
            )
        )
        conn.execute(text("DROP TABLE task_time_logs"))
        conn.execute(text("ALTER TABLE task_time_logs_new RENAME TO task_time_logs"))
        conn.execute(text("PRAGMA foreign_keys=ON"))


def backfill_task_assignees(db: Session) -> None:
    """Populate task_assignees from tasks.assigned_to for existing databases."""
    insp = inspect(engine)
    if not insp.has_table("task_assignees"):
        return
    if db.query(TaskAssignee).first() is not None:
        return
    tasks = db.query(Task).all()
    if not tasks:
        return
    for t in tasks:
        db.add(TaskAssignee(task_id=t.id, user_id=t.assigned_to, position=0))
    db.commit()


def ensure_default_kanban(db: Session) -> None:
    if db.query(KanbanColumn).first() is not None:
        return
    default_kanban = [
        ("backlog", "Backlog", 0),
        ("in_progress", "In Progress", 1),
        ("in_review", "In Review", 2),
        ("done", "Done", 3),
    ]
    for kid, label, pos in default_kanban:
        db.add(KanbanColumn(id=kid, label=label, position=pos))
    db.commit()


def migrate_user_experience_if_needed() -> None:
    """Add job_title, experience_months, joined_at to users table for pre-existing DBs."""
    insp = inspect(engine)
    if not insp.has_table("users"):
        return
    cols = {c["name"] for c in insp.get_columns("users")}
    with engine.begin() as conn:
        if "job_title" not in cols:
            conn.execute(text("ALTER TABLE users ADD COLUMN job_title VARCHAR NOT NULL DEFAULT ''"))
        if "experience_months" not in cols:
            conn.execute(text("ALTER TABLE users ADD COLUMN experience_months INTEGER NOT NULL DEFAULT 0"))
        if "joined_at" not in cols:
            conn.execute(text("ALTER TABLE users ADD COLUMN joined_at VARCHAR NOT NULL DEFAULT ''"))


def create_notifications_if_missing() -> None:
    """Create the notifications table on databases that predate the feature."""
    insp = inspect(engine)
    if insp.has_table("notifications"):
        return
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS notifications (
                    id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
                    user_id VARCHAR NOT NULL REFERENCES users (id),
                    type VARCHAR NOT NULL,
                    title VARCHAR NOT NULL DEFAULT '',
                    message VARCHAR NOT NULL DEFAULT '',
                    entity_type VARCHAR NOT NULL DEFAULT 'task',
                    entity_id VARCHAR NOT NULL DEFAULT '',
                    is_read BOOLEAN NOT NULL DEFAULT 0,
                    triggered_by VARCHAR NOT NULL REFERENCES users (id),
                    created_at VARCHAR NOT NULL
                )
                """
            )
        )
        conn.execute(
            text("CREATE INDEX IF NOT EXISTS ix_notifications_user_id ON notifications (user_id)")
        )


def migrate_user_is_active_if_needed() -> None:
    """Add is_active to users for pre-existing DBs (defaults everyone to active)."""
    insp = inspect(engine)
    if not insp.has_table("users"):
        return
    cols = {c["name"] for c in insp.get_columns("users")}
    if "is_active" in cols:
        return
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE users ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT 1"))


def migrate_timesheet_billable_if_needed() -> None:
    """Add the billable flag to timesheet_entries for pre-existing DBs (defaults to billable)."""
    insp = inspect(engine)
    if not insp.has_table("timesheet_entries"):
        return
    cols = {c["name"] for c in insp.get_columns("timesheet_entries")}
    if "billable" in cols:
        return
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE timesheet_entries ADD COLUMN billable BOOLEAN NOT NULL DEFAULT 1"))


def migrate_project_appearance_if_needed() -> None:
    """Add background_image + accent_color to projects for pre-existing DBs."""
    insp = inspect(engine)
    if not insp.has_table("projects"):
        return
    cols = {c["name"] for c in insp.get_columns("projects")}
    with engine.begin() as conn:
        if "background_image" not in cols:
            conn.execute(text("ALTER TABLE projects ADD COLUMN background_image TEXT NOT NULL DEFAULT ''"))
        if "accent_color" not in cols:
            conn.execute(text("ALTER TABLE projects ADD COLUMN accent_color VARCHAR NOT NULL DEFAULT ''"))
        if "project_image" not in cols:
            conn.execute(text("ALTER TABLE projects ADD COLUMN project_image TEXT NOT NULL DEFAULT ''"))


def create_perf_indexes() -> None:
    """Indexes on hot foreign-key columns not already covered by a PK/unique index.

    task_assignees (PK task_id,user_id), task_time_logs (uniq task_id,log_date,user_id)
    and timesheet_entries (user_id, work_date) are already indexed; these fill the gaps
    that the task-list and visibility queries hit on every load.
    """
    stmts = [
        "CREATE INDEX IF NOT EXISTS ix_tasks_project_id ON tasks (project_id)",
        "CREATE INDEX IF NOT EXISTS ix_project_members_user_id ON project_members (user_id)",
        "CREATE INDEX IF NOT EXISTS ix_task_time_logs_user_id ON task_time_logs (user_id)",
        "CREATE INDEX IF NOT EXISTS ix_sections_project_id ON sections (project_id)",
    ]
    with engine.begin() as conn:
        for s in stmts:
            conn.execute(text(s))


def migrate_meeting_notes_to_scrums() -> None:
    """Carry forward the original one-note-per-day rows into the multi-scrum table."""
    insp = inspect(engine)
    if not insp.has_table("meeting_notes") or not insp.has_table("scrums"):
        return
    with engine.begin() as conn:
        already = conn.execute(text("SELECT COUNT(*) FROM scrums")).scalar() or 0
        if already:
            return
        rows = conn.execute(text(
            "SELECT id, work_date, raw_text, parsed_json, parse_status, updated_by, updated_at, created_at "
            "FROM meeting_notes"
        )).fetchall()
        for r in rows:
            conn.execute(text(
                "INSERT INTO scrums (id, work_date, title, position, raw_text, parsed_json, "
                "parse_status, updated_by, updated_at, created_at) VALUES "
                "(:id, :wd, 'Scrum', 0, :raw, :pj, :ps, :ub, :ua, :ca)"
            ), {
                "id": r[0], "wd": r[1], "raw": r[2], "pj": r[3],
                "ps": r[4], "ub": r[5], "ua": r[6], "ca": r[7],
            })


def init_db() -> None:
    Base.metadata.create_all(bind=engine)
    migrate_timelogs_if_needed()
    migrate_user_experience_if_needed()
    migrate_user_is_active_if_needed()
    migrate_timesheet_billable_if_needed()
    migrate_project_appearance_if_needed()
    create_notifications_if_missing()
    migrate_meeting_notes_to_scrums()
    create_perf_indexes()
    db = SessionLocal()
    try:
        backfill_task_assignees(db)
        ensure_default_kanban(db)
        # Purge audit logs older than 7 days on startup
        from logic.audit import purge_old_audit_logs
        purge_old_audit_logs(db)
    finally:
        db.close()


def new_id(prefix: str) -> str:
    return f"{prefix}{uuid.uuid4().hex[:10]}"
