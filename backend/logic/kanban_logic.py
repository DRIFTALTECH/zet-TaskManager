import re

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

import crud.kanban as kanban_crud
from logic.schemas import KanbanColumnCreate, KanbanColumnOut, KanbanColumnRename, KanbanReorderBody

# These 4 IDs are permanent — they cannot be deleted (tasks use them as status values)
PROTECTED_IDS: frozenset[str] = frozenset(["backlog", "in_progress", "in_review", "done"])


def list_columns(db: Session) -> list[KanbanColumnOut]:
    cols = kanban_crud.list_ordered(db)
    return [KanbanColumnOut(id=c.id, label=c.label) for c in cols]


def _make_slug(label: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", label.strip().lower()).strip("_")


def add_column(db: Session, body: KanbanColumnCreate) -> list[KanbanColumnOut]:
    label = body.label.strip()
    if not label:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Column name cannot be empty")
    base = _make_slug(label)
    if not base:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Column name must contain at least one letter or digit")
    col_id = base
    counter = 2
    while kanban_crud.get_by_id(db, col_id):
        col_id = f"{base}_{counter}"
        counter += 1
    position = len(kanban_crud.list_ordered(db))
    kanban_crud.create_column(db, column_id=col_id, label=label, position=position)
    return list_columns(db)


def rename_column(db: Session, column_id: str, body: KanbanColumnRename) -> list[KanbanColumnOut]:
    col = kanban_crud.get_by_id(db, column_id)
    if not col:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Column not found")
    label = body.label.strip()
    if not label:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Column name cannot be empty")
    col.label = label
    kanban_crud.update_column(db, col)
    return list_columns(db)


def delete_column(db: Session, column_id: str) -> list[KanbanColumnOut]:
    if column_id in PROTECTED_IDS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "The 4 base columns (Backlog, In Progress, In Review, Done) cannot be deleted",
        )
    col = kanban_crud.get_by_id(db, column_id)
    if not col:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Column not found")
    # Move any tasks in this column back to backlog before deleting
    from database.models import Task
    db.query(Task).filter(Task.status == column_id).update({"status": "backlog"})
    db.commit()
    kanban_crud.delete_column(db, column_id)
    return list_columns(db)


def reorder_columns(db: Session, body: KanbanReorderBody) -> list[KanbanColumnOut]:
    existing = {c.id for c in kanban_crud.list_ordered(db)}
    incoming = list(body.ids)
    if set(incoming) != existing:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Reorder list must include every column exactly once")
    kanban_crud.set_positions(db, incoming)
    return list_columns(db)
