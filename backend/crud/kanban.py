from crud._base import Db, fetch_all, fetch_one, row_to_model, rows_to_models
from database.models import KanbanColumn


def list_ordered(db: Db) -> list[KanbanColumn]:
    return rows_to_models(
        KanbanColumn,
        fetch_all(db, "SELECT * FROM kanban_columns ORDER BY position, id"),
    )


def get_by_id(db: Db, column_id: str) -> KanbanColumn | None:
    return row_to_model(
        KanbanColumn,
        fetch_one(db, "SELECT * FROM kanban_columns WHERE id = %s", (column_id,)),
    )


def create_column(db: Db, *, column_id: str, label: str, position: int) -> KanbanColumn:
    db.write(
        "INSERT INTO kanban_columns (id, label, position) VALUES (%s, %s, %s)",
        (column_id, label, position),
    )
    return row_to_model(
        KanbanColumn,
        fetch_one(db, "SELECT * FROM kanban_columns WHERE id = %s", (column_id,)),
    )  # type: ignore[return-value]


def update_column(db: Db, col: KanbanColumn) -> KanbanColumn:
    db.write(
        "UPDATE kanban_columns SET label = %s, position = %s WHERE id = %s",
        (col.label, col.position, col.id),
    )
    return row_to_model(
        KanbanColumn,
        fetch_one(db, "SELECT * FROM kanban_columns WHERE id = %s", (col.id,)),
    )  # type: ignore[return-value]


def delete_column(db: Db, column_id: str) -> None:
    db.write("DELETE FROM kanban_columns WHERE id = %s", (column_id,))


def set_positions(db: Db, ordered_ids: list[str]) -> None:
    for pos, cid in enumerate(ordered_ids):
        col = get_by_id(db, cid)
        if col:
            db.write(
                "UPDATE kanban_columns SET position = %s WHERE id = %s",
                (pos, cid),
            )
