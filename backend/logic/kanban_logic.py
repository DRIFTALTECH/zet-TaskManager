from fastapi import HTTPException, status
from sqlalchemy.orm import Session

import crud.kanban as kanban_crud
from logic.schemas import KanbanColumnCreate, KanbanColumnOut, KanbanColumnRename, KanbanReorderBody

# Fixed workflow — no add/rename/delete/reorder
FIXED_KANBAN_ORDER: tuple[tuple[str, str], ...] = (
    ("backlog", "Backlog"),
    ("in_progress", "In Progress"),
    ("in_review", "In Review"),
    ("done", "Done"),
)
FIXED_IDS = frozenset(cid for cid, _ in FIXED_KANBAN_ORDER)


def list_columns(db: Session) -> list[KanbanColumnOut]:
    cols = {c.id: c for c in kanban_crud.list_ordered(db)}
    out: list[KanbanColumnOut] = []
    for cid, default_label in FIXED_KANBAN_ORDER:
        c = cols.get(cid)
        label = c.label if c else default_label
        out.append(KanbanColumnOut(id=cid, label=label))
    return out


def add_column(db: Session, body: KanbanColumnCreate) -> list[KanbanColumnOut]:
    raise HTTPException(
        status.HTTP_400_BAD_REQUEST,
        "Kanban columns are fixed: Backlog, In Progress, In Review, Done",
    )


def rename_column(db: Session, column_id: str, body: KanbanColumnRename) -> list[KanbanColumnOut]:
    if column_id in FIXED_IDS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "These columns cannot be renamed",
        )
    raise HTTPException(status.HTTP_404_NOT_FOUND, "Column not found")


def delete_column(db: Session, column_id: str) -> list[KanbanColumnOut]:
    if column_id in FIXED_IDS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "These columns cannot be deleted",
        )
    raise HTTPException(status.HTTP_404_NOT_FOUND, "Column not found")


def reorder_columns(db: Session, body: KanbanReorderBody) -> list[KanbanColumnOut]:
    expected = [cid for cid, _ in FIXED_KANBAN_ORDER]
    if list(body.ids) != expected:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Column order is fixed",
        )
    return list_columns(db)
