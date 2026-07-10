from database.models import TaskChecklist

from crud._base import Db, fetch_all, fetch_one, row_to_model, rows_to_models

_SELECT = """SELECT id, task_id, title, priority, is_done, position, created_by, created_at
    FROM task_checklists"""


def get_by_id(db: Db, item_id: str) -> TaskChecklist | None:
    return row_to_model(
        TaskChecklist,
        fetch_one(db, f"{_SELECT} WHERE id = %s", (item_id,)),
    )


def list_for_task(db: Db, task_id: str) -> list[TaskChecklist]:
    rows = fetch_all(
        db,
        f"{_SELECT} WHERE task_id = %s ORDER BY position, created_at",
        (task_id,),
    )
    return rows_to_models(TaskChecklist, rows)


def count_for_task(db: Db, task_id: str) -> int:
    row = fetch_one(
        db,
        "SELECT COUNT(*) AS cnt FROM task_checklists WHERE task_id = %s",
        (task_id,),
    )
    return int(row["cnt"]) if row else 0


def create(db: Db, item: TaskChecklist) -> TaskChecklist:
    db.write(
        """INSERT INTO task_checklists
            (id, task_id, title, priority, is_done, position, created_by, created_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
        (
            item.id,
            item.task_id,
            item.title,
            item.priority,
            item.is_done,
            item.position,
            item.created_by,
            item.created_at,
        ),
    )
    return item


def update(db: Db, item: TaskChecklist) -> TaskChecklist:
    db.write(
        """UPDATE task_checklists SET
            task_id = %s, title = %s, priority = %s, is_done = %s,
            position = %s, created_by = %s, created_at = %s
            WHERE id = %s""",
        (
            item.task_id,
            item.title,
            item.priority,
            item.is_done,
            item.position,
            item.created_by,
            item.created_at,
            item.id,
        ),
    )
    return item


def delete(db: Db, item: TaskChecklist) -> None:
    db.write("DELETE FROM task_checklists WHERE id = %s", (item.id,))
