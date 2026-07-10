from database.models import TaskFeedback

from crud._base import Db, fetch_all, fetch_one, row_to_model, rows_to_models

_SELECT = """SELECT id, task_id, user_id, message, created_at, updated_at
    FROM task_feedback"""


def list_for_task(db: Db, task_id: str) -> list[TaskFeedback]:
    rows = fetch_all(
        db,
        f"{_SELECT} WHERE task_id = %s ORDER BY created_at ASC",
        (task_id,),
    )
    return rows_to_models(TaskFeedback, rows)


def get_by_id(db: Db, feedback_id: str) -> TaskFeedback | None:
    return row_to_model(
        TaskFeedback,
        fetch_one(db, f"{_SELECT} WHERE id = %s", (feedback_id,)),
    )


def create_row(db: Db, row: TaskFeedback) -> TaskFeedback:
    db.write(
        """INSERT INTO task_feedback
            (id, task_id, user_id, message, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s)""",
        (row.id, row.task_id, row.user_id, row.message, row.created_at, row.updated_at),
    )
    return row


def update_row(db: Db, row: TaskFeedback) -> TaskFeedback:
    db.write(
        """UPDATE task_feedback SET
            task_id = %s, user_id = %s, message = %s, created_at = %s, updated_at = %s
            WHERE id = %s""",
        (row.task_id, row.user_id, row.message, row.created_at, row.updated_at, row.id),
    )
    return row


def delete_row(db: Db, row: TaskFeedback) -> None:
    db.write("DELETE FROM task_feedback WHERE id = %s", (row.id,))
