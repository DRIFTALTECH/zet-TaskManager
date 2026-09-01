"""PRD import — manager/superadmin only. Staging lives in temp_tasks."""
import logging
import os

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

import ratelimit
from database.database import Db, get_db
from logic import prd_import_logic
from logic.schemas import PrdCommitOut, PrdDraftOut, TempTaskCreateBody, TempTaskPatch
from routes.deps import get_current_user_id

router = APIRouter()
log = logging.getLogger("zet.prd")

AI_CALLS_PER_USER = int(os.environ.get("AI_RATE_LIMIT_PER_HOUR", "60"))
_AI_UNAVAILABLE = "AI is temporarily unavailable. Please try again later."


@router.get("/prd-imports/draft", response_model=PrdDraftOut)
def get_draft(user_id: str = Depends(get_current_user_id), db: Db = Depends(get_db)):
    return prd_import_logic.get_draft(db, user_id)


@router.post("/prd-imports/analyze", response_model=PrdDraftOut)
async def analyze(
    text: str | None = Form(None),
    file: UploadFile | None = File(None),
    project_id: str | None = Form(None),
    user_id: str = Depends(get_current_user_id),
    db: Db = Depends(get_db),
):
    ratelimit.check("ai", user_id, limit=AI_CALLS_PER_USER, window_seconds=3600)
    file_bytes = await file.read() if file is not None else None
    filename = file.filename if file is not None else None
    try:
        return prd_import_logic.analyze(
            db, user_id, text=text, file_bytes=file_bytes, filename=filename, project_id=project_id
        )
    except HTTPException:
        raise
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e) or _AI_UNAVAILABLE)
    except Exception as e:
        log.exception("PRD analyze failed")
        raise HTTPException(status_code=500, detail=f"AI error: {e}")


@router.patch("/prd-imports/items/{row_id}", response_model=PrdDraftOut)
def patch_item(
    row_id: str,
    body: TempTaskPatch,
    user_id: str = Depends(get_current_user_id),
    db: Db = Depends(get_db),
):
    return prd_import_logic.patch_row(db, user_id, row_id, body)


@router.post("/prd-imports/stories", response_model=PrdDraftOut)
def add_story(
    body: TempTaskCreateBody,
    user_id: str = Depends(get_current_user_id),
    db: Db = Depends(get_db),
):
    return prd_import_logic.add_story(db, user_id, body)


@router.post("/prd-imports/tasks", response_model=PrdDraftOut)
def add_task(
    body: TempTaskCreateBody,
    user_id: str = Depends(get_current_user_id),
    db: Db = Depends(get_db),
):
    return prd_import_logic.add_task(db, user_id, body)


@router.delete("/prd-imports/items/{row_id}", response_model=PrdDraftOut)
def delete_item(
    row_id: str,
    user_id: str = Depends(get_current_user_id),
    db: Db = Depends(get_db),
):
    return prd_import_logic.delete_row(db, user_id, row_id)


@router.delete("/prd-imports/draft", response_model=PrdDraftOut)
def discard_draft(user_id: str = Depends(get_current_user_id), db: Db = Depends(get_db)):
    return prd_import_logic.discard(db, user_id)


@router.post("/prd-imports/commit", response_model=PrdCommitOut)
def commit_draft(user_id: str = Depends(get_current_user_id), db: Db = Depends(get_db)):
    return prd_import_logic.commit(db, user_id)
