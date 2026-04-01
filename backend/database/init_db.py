"""Create tables, run migrations, and ensure default kanban columns only — no demo users or seed data."""

import uuid

from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

from database.database import Base, SessionLocal, engine
from database.models import KanbanColumn, Task, TaskAssignee


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


def init_db() -> None:
    Base.metadata.create_all(bind=engine)
    migrate_timelogs_if_needed()
    db = SessionLocal()
    try:
        backfill_task_assignees(db)
        ensure_default_kanban(db)
    finally:
        db.close()


def new_id(prefix: str) -> str:
    return f"{prefix}{uuid.uuid4().hex[:10]}"
