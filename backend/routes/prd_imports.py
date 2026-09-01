"""PRD import — manager/superadmin only. Staging lives in temp_tasks."""
import json
import logging
import os

from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse

import ratelimit
from database.database import Db, get_db
from logic import prd_import_logic
from logic.schemas import PrdCommitBody, PrdCommitOut, PrdDraftOut, TempTaskCreateBody, TempTaskPatch
from offloop import offloop
from routes.deps import get_current_user_id

router = APIRouter()
log = logging.getLogger("zet.prd")

AI_CALLS_PER_USER = int(os.environ.get("AI_RATE_LIMIT_PER_HOUR", "60"))
_AI_UNAVAILABLE = "AI is temporarily unavailable. Please try again later."
_MAX_DOCS = 8


async def _read_docs(file: UploadFile | None, files: list[UploadFile] | None) -> list[tuple[bytes, str]]:
    out: list[tuple[bytes, str]] = []
    seen: set[tuple[str, int]] = set()
    for f in ([file] if file is not None else []) + list(files or []):
        if f is None:
            continue
        data = await f.read()
        name = f.filename or "upload"
        key = (name, len(data))
        if not data or key in seen:
            continue
        seen.add(key)
        out.append((data, name))
        if len(out) >= _MAX_DOCS:
            break
    return out


@router.get("/prd-imports/draft", response_model=PrdDraftOut)
def get_draft(user_id: str = Depends(get_current_user_id), db: Db = Depends(get_db)):
    return prd_import_logic.get_draft(db, user_id)


@router.post("/prd-imports/analyze", response_model=PrdDraftOut)
async def analyze(
    text: str | None = Form(None),
    file: UploadFile | None = File(None),
    files: list[UploadFile] | None = File(None),
    project_id: str | None = Form(None),
    user_id: str = Depends(get_current_user_id),
    db: Db = Depends(get_db),
):
    ratelimit.check("ai", user_id, limit=AI_CALLS_PER_USER, window_seconds=3600)
    docs = await _read_docs(file, files)
    try:
        return await offloop(
            prd_import_logic.analyze,
            db, user_id, text=text, files=docs, project_id=project_id,
        )
    except HTTPException:
        raise
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e) or _AI_UNAVAILABLE)
    except Exception as e:
        log.exception("PRD analyze failed")
        raise HTTPException(status_code=500, detail=f"AI error: {e}")


@router.post("/prd-imports/analyze/stream")
async def analyze_stream(
    text: str | None = Form(None),
    file: UploadFile | None = File(None),
    files: list[UploadFile] | None = File(None),
    project_id: str | None = Form(None),
    user_id: str = Depends(get_current_user_id),
    db: Db = Depends(get_db),
):
    """SSE: story shells first, then per-story tasks as parallel expands finish."""
    ratelimit.check("ai", user_id, limit=AI_CALLS_PER_USER, window_seconds=3600)
    docs = await _read_docs(file, files)

    def events():
        try:
            for ev in prd_import_logic.analyze_stream(
                db, user_id, text=text, files=docs, project_id=project_id
            ):
                yield f"data: {json.dumps(ev, default=str)}\n\n"
        except HTTPException as e:
            detail = e.detail if isinstance(e.detail, str) else str(e.detail)
            yield f"data: {json.dumps({'type': 'error', 'message': detail})}\n\n"
        except Exception as e:
            log.exception("PRD analyze stream failed")
            yield f"data: {json.dumps({'type': 'error', 'message': str(e) or _AI_UNAVAILABLE})}\n\n"

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )


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
def commit_draft(
    body: PrdCommitBody = Body(default_factory=PrdCommitBody),
    user_id: str = Depends(get_current_user_id),
    db: Db = Depends(get_db),
):
    return prd_import_logic.commit(db, user_id, story_ids=body.storyIds, task_ids=body.taskIds)
