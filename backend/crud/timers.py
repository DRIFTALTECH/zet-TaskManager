from crud._base import Db, fetch_all, fetch_one, row_to_model, rows_to_models
from database.models import TaskTimerRun


def get(db: Db, user_id: str, task_id: str) -> TaskTimerRun | None:
    return row_to_model(
        TaskTimerRun,
        fetch_one(
            db,
            """
            SELECT * FROM task_timer_runs
            WHERE user_id = %s AND task_id = %s
            """,
            (user_id, task_id),
        ),
    )


def list_for_user(db: Db, user_id: str) -> list[TaskTimerRun]:
    return rows_to_models(
        TaskTimerRun,
        fetch_all(db, "SELECT * FROM task_timer_runs WHERE user_id = %s", (user_id,)),
    )


def start(db: Db, user_id: str, task_id: str, started_at: str) -> TaskTimerRun:
    """Begin a run, or return the existing one (idempotent — keeps the original start)."""
    row = get(db, user_id, task_id)
    if row:
        return row
    db.write(
        "INSERT INTO task_timer_runs (user_id, task_id, started_at) VALUES (%s, %s, %s)",
        (user_id, task_id, started_at),
    )
    return row_to_model(
        TaskTimerRun,
        fetch_one(
            db,
            "SELECT * FROM task_timer_runs WHERE user_id = %s AND task_id = %s",
            (user_id, task_id),
        ),
    )  # type: ignore[return-value]


def delete(db: Db, user_id: str, task_id: str) -> None:
    db.write(
        "DELETE FROM task_timer_runs WHERE user_id = %s AND task_id = %s",
        (user_id, task_id),
    )
