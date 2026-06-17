"""Checklist sub-resource: /tasks/{task_id}/checklists — thin endpoints."""

from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from database.database import get_db
from logic import checklist_logic
from logic.schemas import TaskChecklistCreate, TaskChecklistOut, TaskChecklistPatch
from routes.deps import get_current_user_id

router = APIRouter()


@router.get("", response_model=list[TaskChecklistOut])
def list_checklists(
    task_id: str,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    return checklist_logic.list_for_task(db, task_id)


@router.post("", response_model=TaskChecklistOut, status_code=201)
def create_checklist(
    task_id: str,
    body: TaskChecklistCreate,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    return checklist_logic.create(db, task_id, body, user_id)


@router.patch("/{item_id}", response_model=TaskChecklistOut)
def patch_checklist(
    task_id: str,
    item_id: str,
    body: TaskChecklistPatch,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    return checklist_logic.patch(db, task_id, item_id, body, user_id)


@router.delete("/{item_id}", status_code=204)
def delete_checklist(
    task_id: str,
    item_id: str,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    checklist_logic.delete(db, task_id, item_id, user_id)
    return Response(status_code=204)
