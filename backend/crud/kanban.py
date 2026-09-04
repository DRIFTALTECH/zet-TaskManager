from crud._base import Db, fetch_all, fetch_one, row_to_model, rows_to_models
from database.models import KanbanColumn
from db_wrapper.dialect import use_sqlite

# `color` is added by a migration that is soft-skipped when the app role does not
# own the table (a DBA applies it out of band). Reads cope on their own — a missing
# key just leaves the model default — but writes must not name a column that is not
# there, or renaming a column would start failing on an un-migrated database.
_color_supported: bool | None = None


def supports_color(db: Db) -> bool:
    """Whether kanban_columns.color exists. Probed once, then cached.

    Uses the catalog rather than `SELECT color`: a failed statement aborts the
    surrounding Postgres transaction and would take the caller down with it.
    """
    global _color_supported
    if _color_supported is None:
        if use_sqlite():
            rows = fetch_all(db, "PRAGMA table_info(kanban_columns)")
            _color_supported = any((r.get("name") or "") == "color" for r in rows)
        else:
            _color_supported = bool(
                fetch_all(
                    db,
                    """
                    SELECT 1 AS ok FROM information_schema.columns
                    WHERE table_schema = 'public'
                      AND table_name = 'kanban_columns'
                      AND column_name = 'color'
                    """,
                )
            )
    return _color_supported


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


def create_column(
    db: Db, *, column_id: str, label: str, position: int, color: str
) -> KanbanColumn:
    if supports_color(db):
        db.write(
            "INSERT INTO kanban_columns (id, label, position, color) VALUES (%s, %s, %s, %s)",
            (column_id, label, position, color),
        )
    else:
        db.write(
            "INSERT INTO kanban_columns (id, label, position) VALUES (%s, %s, %s)",
            (column_id, label, position),
        )
    return row_to_model(
        KanbanColumn,
        fetch_one(db, "SELECT * FROM kanban_columns WHERE id = %s", (column_id,)),
    )  # type: ignore[return-value]


def update_column(db: Db, col: KanbanColumn) -> KanbanColumn:
    if supports_color(db):
        db.write(
            "UPDATE kanban_columns SET label = %s, position = %s, color = %s WHERE id = %s",
            (col.label, col.position, col.color or "slate", col.id),
        )
    else:
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
