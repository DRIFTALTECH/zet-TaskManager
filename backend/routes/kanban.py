from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from database.database import get_db
from logic import kanban_logic
from logic.schemas import KanbanColumnCreate, KanbanColumnOut, KanbanColumnRename, KanbanReorderBody
from routes.deps import get_current_user_id

router = APIRouter()


@router.get("/columns", response_model=list[KanbanColumnOut])
def list_columns(user_id: str = Depends(get_current_user_id), db: Session = Depends(get_db)):
    return kanban_logic.list_columns(db)


@router.post("/columns", response_model=list[KanbanColumnOut])
def add_column(
    body: KanbanColumnCreate,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    return kanban_logic.add_column(db, body)


@router.patch("/columns/{column_id}", response_model=list[KanbanColumnOut])
def rename_column(
    column_id: str,
    body: KanbanColumnRename,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    return kanban_logic.rename_column(db, column_id, body)


@router.delete("/columns/{column_id}", response_model=list[KanbanColumnOut])
def delete_column(
    column_id: str,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    return kanban_logic.delete_column(db, column_id)


@router.put("/columns/reorder", response_model=list[KanbanColumnOut])
def reorder_columns(
    body: KanbanReorderBody,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    return kanban_logic.reorder_columns(db, body)
