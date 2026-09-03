import realtime
from crud._base import Db, fetch_all, fetch_one, row_to_model, rows_to_models
from database.models import TaskTimeLog


def get_row(db: Db, task_id: str, log_date: str, user_id: str) -> TaskTimeLog | None:
    return row_to_model(
        TaskTimeLog,
        fetch_one(
            db,
            """
            SELECT * FROM task_time_logs
            WHERE task_id = %s AND log_date = %s AND user_id = %s
            """,
            (task_id, log_date, user_id),
        ),
    )


def sum_seconds_for_task(db: Db, task_id: str) -> int:
    row = fetch_one(
        db,
        "SELECT COALESCE(SUM(seconds), 0) AS total FROM task_time_logs WHERE task_id = %s",
        (task_id,),
    )
    return int(row["total"]) if row else 0


def add_seconds(db: Db, task_id: str, log_date: str, seconds: int, user_id: str) -> TaskTimeLog:
    row = get_row(db, task_id, log_date, user_id)
    if row:
        db.write(
            """
            UPDATE task_time_logs SET seconds = seconds + %s
            WHERE task_id = %s AND log_date = %s AND user_id = %s
            """,
            (seconds, task_id, log_date, user_id),
        )
    else:
        db.write(
            """
            INSERT INTO task_time_logs (task_id, user_id, log_date, seconds)
            VALUES (%s, %s, %s, %s)
            """,
            (task_id, user_id, log_date, seconds),
        )
    total = sum_seconds_for_task(db, task_id)
    db.write("UPDATE tasks SET time_tracked = %s WHERE id = %s", (total, task_id))
    realtime.bump("tasks")
    return row_to_model(
        TaskTimeLog,
        fetch_one(
            db,
            """
            SELECT * FROM task_time_logs
            WHERE task_id = %s AND log_date = %s AND user_id = %s
            """,
            (task_id, log_date, user_id),
        ),
    )  # type: ignore[return-value]


def list_for_task(db: Db, task_id: str) -> list[TaskTimeLog]:
    return rows_to_models(
        TaskTimeLog,
        fetch_all(db, "SELECT * FROM task_time_logs WHERE task_id = %s", (task_id,)),
    )


def list_for_user_date(db: Db, user_id: str, log_date: str) -> list[TaskTimeLog]:
    """Every time-log row a user recorded on a single date (across all tasks)."""
    return rows_to_models(
        TaskTimeLog,
        fetch_all(
            db,
            "SELECT * FROM task_time_logs WHERE user_id = %s AND log_date = %s",
            (user_id, log_date),
        ),
    )


def time_log_map_for_user(db: Db, task_id: str, user_id: str) -> dict[str, int]:
    rows = fetch_all(
        db,
        "SELECT log_date, seconds FROM task_time_logs WHERE task_id = %s AND user_id = %s",
        (task_id, user_id),
    )
    return {r["log_date"]: r["seconds"] for r in rows}


def time_log_maps_for_user(
    db: Db, task_ids: list[str], user_id: str
) -> dict[str, dict[str, int]]:
    """Per-task {date: seconds} maps for one viewer across many tasks in one query."""
    if not task_ids:
        return {}
    rows = fetch_all(
        db,
        """
        SELECT task_id, log_date, seconds FROM task_time_logs
        WHERE task_id = ANY(%s) AND user_id = %s
        """,
        (task_ids, user_id),
    )
    out: dict[str, dict[str, int]] = {}
    for r in rows:
        out.setdefault(r["task_id"], {})[r["log_date"]] = r["seconds"]
    return out


def recompute_task_total(db: Db, task_id: str) -> int:
    total = sum_seconds_for_task(db, task_id)
    task_exists = fetch_one(db, "SELECT id FROM tasks WHERE id = %s", (task_id,))
    if task_exists:
        db.write("UPDATE tasks SET time_tracked = %s WHERE id = %s", (total, task_id))
    return total


def replace_task_seconds(db: Db, task_id: str, user_id: str, log_date: str, seconds: int) -> int:
    """Set the task's actual time to exactly `seconds` (one log row for this user/day)."""
    seconds = max(0, int(seconds))
    db.write("DELETE FROM task_time_logs WHERE task_id = %s", (task_id,))
    if seconds > 0:
        db.write(
            """
            INSERT INTO task_time_logs (task_id, user_id, log_date, seconds)
            VALUES (%s, %s, %s, %s)
            """,
            (task_id, user_id, log_date, seconds),
        )
    total = recompute_task_total(db, task_id)
    realtime.bump("tasks")
    return total
