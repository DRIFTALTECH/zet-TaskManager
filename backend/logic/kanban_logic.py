import re

from fastapi import HTTPException, status
from database.database import Db

import crud.kanban as kanban_crud
import crud.tasks as tasks_crud
from logic.schemas import KanbanColumnCreate, KanbanColumnOut, KanbanColumnRename, KanbanReorderBody

# These base IDs are permanent — they cannot be deleted (tasks use them as status values)
PROTECTED_IDS: frozenset[str] = frozenset(["backlog", "in_progress", "testing", "in_review", "done"])

# Palette keys, not hex — the frontend maps each to a light/dark token pair so
# columns stay legible in both themes. Order doubles as the auto-assign cycle.
COLUMN_COLORS: tuple[str, ...] = (
    "slate",
    "violet",
    "amber",
    "sky",
    "emerald",
    "rose",
    "orange",
    "teal",
    "indigo",
    "pink",
)
DEFAULT_COLUMN_COLOR = "slate"


def _clean_color(raw: str | None) -> str | None:
    """None when unset; validated palette key otherwise."""
    if raw is None:
        return None
    value = raw.strip().lower()
    if value not in COLUMN_COLORS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Unknown colour '{raw}'. Pick one of: {', '.join(COLUMN_COLORS)}",
        )
    return value


def list_columns(db: Db) -> list[KanbanColumnOut]:
    cols = kanban_crud.list_ordered(db)
    return [
        KanbanColumnOut(
            id=c.id,
            label=c.label,
            color=getattr(c, "color", None) or DEFAULT_COLUMN_COLOR,
        )
        for c in cols
    ]


def _make_slug(label: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", label.strip().lower()).strip("_")


def add_column(db: Db, body: KanbanColumnCreate) -> list[KanbanColumnOut]:
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
    # No colour picked at creation time: walk the palette so consecutive new
    # columns do not all come out the same grey.
    color = _clean_color(body.color) or COLUMN_COLORS[position % len(COLUMN_COLORS)]
    kanban_crud.create_column(
        db, column_id=col_id, label=label, position=position, color=color
    )
    return list_columns(db)


def rename_column(db: Db, column_id: str, body: KanbanColumnRename) -> list[KanbanColumnOut]:
    """Update a column's label, colour, or both. Omitted fields are left alone."""
    col = kanban_crud.get_by_id(db, column_id)
    if not col:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Column not found")
    if body.label is not None:
        label = body.label.strip()
        if not label:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Column name cannot be empty")
        col.label = label
    color = _clean_color(body.color)
    if color is not None:
        if not kanban_crud.supports_color(db):
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "Column colours are not enabled on this database yet — "
                "the kanban_columns.color migration still has to be applied.",
            )
        col.color = color
    kanban_crud.update_column(db, col)
    return list_columns(db)


def delete_column(db: Db, column_id: str) -> list[KanbanColumnOut]:
    if column_id in PROTECTED_IDS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "The 4 base columns (Backlog, In Progress, In Review, Done) cannot be deleted",
        )
    col = kanban_crud.get_by_id(db, column_id)
    if not col:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Column not found")
    # Move any tasks in this column back to backlog before deleting
    tasks_crud.reassign_status(db, column_id, "backlog")
    kanban_crud.delete_column(db, column_id)
    return list_columns(db)


def reorder_columns(db: Db, body: KanbanReorderBody) -> list[KanbanColumnOut]:
    existing = {c.id for c in kanban_crud.list_ordered(db)}
    incoming = list(body.ids)
    if set(incoming) != existing:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Reorder list must include every column exactly once")
    kanban_crud.set_positions(db, incoming)
    return list_columns(db)
