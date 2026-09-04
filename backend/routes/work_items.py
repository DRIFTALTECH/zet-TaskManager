"""HTTP surface for the unified work item.

One set of endpoints for both kinds of work, where there used to be two that
drifted apart. Every handler parses its input, calls one logic function and
returns the result.

These run alongside /tasks and /user-stories rather than replacing them: the
old endpoints stay authoritative until the data is backfilled and the client
has moved over.
"""
from fastapi import APIRouter, Depends

from database.database import Db, get_db
from logic import work_item_logic
from logic.schemas import WorkItemCreate, WorkItemOut, WorkItemPatch
from routes.deps import get_current_user_id

router = APIRouter()


@router.get("", response_model=list[WorkItemOut])
def list_work_items(user_id: str = Depends(get_current_user_id), db: Db = Depends(get_db)):
    return work_item_logic.list_visible(db, user_id)


@router.post("", response_model=WorkItemOut)
def create_work_item(
    body: WorkItemCreate,
    user_id: str = Depends(get_current_user_id),
    db: Db = Depends(get_db),
):
    return work_item_logic.create_item(db, user_id, body)


@router.get("/{item_id}", response_model=WorkItemOut)
def get_work_item(
    item_id: str, user_id: str = Depends(get_current_user_id), db: Db = Depends(get_db)
):
    return work_item_logic.get_item(db, user_id, item_id)


@router.patch("/{item_id}", response_model=WorkItemOut)
def patch_work_item(
    item_id: str,
    body: WorkItemPatch,
    user_id: str = Depends(get_current_user_id),
    db: Db = Depends(get_db),
):
    return work_item_logic.patch_item(db, user_id, item_id, body)


@router.delete("/{item_id}", status_code=204)
def delete_work_item(
    item_id: str, user_id: str = Depends(get_current_user_id), db: Db = Depends(get_db)
):
    work_item_logic.delete_item(db, user_id, item_id)


@router.get("/{item_id}/children", response_model=list[WorkItemOut])
def list_children(
    item_id: str, user_id: str = Depends(get_current_user_id), db: Db = Depends(get_db)
):
    return work_item_logic.list_children(db, user_id, item_id)


@router.get("/{item_id}/descendants", response_model=list[WorkItemOut])
def list_descendants(
    item_id: str, user_id: str = Depends(get_current_user_id), db: Db = Depends(get_db)
):
    return work_item_logic.list_descendants(db, user_id, item_id)
