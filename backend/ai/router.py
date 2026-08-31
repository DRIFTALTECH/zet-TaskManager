import logging
import os

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

import ratelimit

from ai import chains, service
from logic import daily_summary_logic, prd_extract_logic, task_extraction_logic
from ai.schemas import (
    ChatRequest,
    ChatResponse,
    DaySummaryResponse,
    GenerateDescriptionRequest,
    GenerateDescriptionResponse,
    ParseTaskRequest,
    ParseTaskResponse,
    SummarizeTaskResponse,
    TimesheetParseRequest,
    TimesheetParseResponse,
)
from database.database import Db, get_db
from logic import user_logic
from routes.deps import get_current_user_id

router = APIRouter()
log = logging.getLogger("zet.ai")

# Every AI call costs money. Cap per user, not per IP — the caller is authenticated.
AI_CALLS_PER_USER = int(os.environ.get("AI_RATE_LIMIT_PER_HOUR", "60"))


def _ai_quota(user_id: str) -> None:
    ratelimit.check("ai", user_id, limit=AI_CALLS_PER_USER, window_seconds=3600)

_USER_FACING_AI_ERROR = "Something went wrong. Please try again."
_AI_UNAVAILABLE = "AI is temporarily unavailable. Please try again later."


# ── Health ────────────────────────────────────────────────────────────────────

@router.get("/health")
def ai_health():
    """Check AI module config — does NOT make a live API call."""
    key_set = bool((os.getenv("DEEPSEEK_API_KEY") or "").strip())
    enabled = key_set
    return {
        "status": "ok" if enabled else "degraded",
        "provider": "deepseek",
        "model": service._DEFAULT_MODEL,
        "api_key_configured": key_set,
        "fallback": {"provider": None, "model": None, "available": False},
        "features": {
            "chat": enabled,
            "generate_description": enabled,
            "summarize_task": enabled,
            "parse_task": enabled,
            "extract_prd": enabled,
            "meeting_ingestion": False,
        },
    }


# ── Chat ──────────────────────────────────────────────────────────────────────

@router.post("/chat", response_model=ChatResponse)
def ai_chat(
    body: ChatRequest,
    user_id: str = Depends(get_current_user_id),
    db: Db = Depends(get_db),
):
    """
    Agentic chat endpoint. Zani can now create projects, sections, tasks, and
    add team members using real tool calls against the live database.
    Manager-only tools (create_project, add_member) are enforced at the tool level.
    """
    _ai_quota(user_id)
    current_user = user_logic.get_user_or_404(db, user_id)
    try:
        return chains.chat(body, db, current_user)
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e) or _AI_UNAVAILABLE)
    except Exception as e:
        log.exception("AI request failed")
        raise HTTPException(status_code=500, detail=f"AI error: {e}")


# ── Generate description ──────────────────────────────────────────────────────

@router.post("/generate-description", response_model=GenerateDescriptionResponse)
def generate_description(
    body: GenerateDescriptionRequest,
    _user_id: str = Depends(get_current_user_id),
):
    """Given a task title (+ optional project/section), return an AI-generated description."""
    _ai_quota(user_id)
    try:
        return chains.generate_description(
            body.title, body.project_name, body.section_name, body.context
        )
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e) or _AI_UNAVAILABLE)
    except Exception as e:
        log.exception("AI request failed")
        raise HTTPException(status_code=500, detail=f"AI error: {e}")


# ── Summarize task thread ─────────────────────────────────────────────────────

@router.post("/summarize-task/{task_id}", response_model=SummarizeTaskResponse)
def summarize_task(
    task_id: str,
    _user_id: str = Depends(get_current_user_id),
    db: Db = Depends(get_db),
):
    """Summarize the comment thread for a task into a bullet-point TL;DR."""
    _ai_quota(user_id)
    try:
        return chains.summarize_task(db, task_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e) or _AI_UNAVAILABLE)
    except Exception as e:
        log.exception("AI request failed")
        raise HTTPException(status_code=500, detail=f"AI error: {e}")


# ── Parse daily summary into timesheet rows ───────────────────────────────────

@router.post("/parse-timesheet", response_model=TimesheetParseResponse)
def parse_timesheet(
    body: TimesheetParseRequest,
    _user_id: str = Depends(get_current_user_id),
):
    """Convert a natural language day summary into structured timesheet row proposals."""
    _ai_quota(user_id)
    try:
        return chains.parse_timesheet(body.summary, body.work_date, body.projects)
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e) or _AI_UNAVAILABLE)
    except Exception as e:
        log.exception("AI request failed")
        raise HTTPException(status_code=500, detail=f"AI error: {e}")


# ── End-of-day standup recap ──────────────────────────────────────────────────

@router.get("/summarize-day", response_model=DaySummaryResponse)
def summarize_day(
    date: str | None = None,
    user_id: str = Depends(get_current_user_id),
    db: Db = Depends(get_db),
):
    """Generate a short AI recap of the current user's work for a day (default: today)."""
    _ai_quota(user_id)
    try:
        return daily_summary_logic.summarize_day(db, user_id, date)
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e) or _AI_UNAVAILABLE)
    except Exception as e:
        log.exception("AI request failed")
        raise HTTPException(status_code=500, detail=f"AI error: {e}")


# ── Parse natural language into tasks ─────────────────────────────────────────

@router.post("/extract-tasks")
async def extract_tasks(
    text: str | None = Form(None),
    file: UploadFile | None = File(None),
    user_id: str = Depends(get_current_user_id),
    db: Db = Depends(get_db),
):
    """Task-creation chain: typed text, an uploaded document, or recorded/uploaded
    audio → structured tasks with suggested assignees/projects."""
    _ai_quota(user_id)
    file_bytes = await file.read() if file is not None else None
    filename = file.filename if file is not None else None
    try:
        source, result = task_extraction_logic.extract_tasks(
            db, user_id, text=text, file_bytes=file_bytes, filename=filename
        )
    except HTTPException:
        raise
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e) or _AI_UNAVAILABLE)
    except Exception as e:
        log.exception("AI request failed")
        raise HTTPException(status_code=500, detail=f"AI error: {e}")
    return {"sourceText": source, "tasks": [t.model_dump() for t in result.tasks]}


@router.post("/extract-prd")
async def extract_prd(
    text: str | None = Form(None),
    file: UploadFile | None = File(None),
    user_id: str = Depends(get_current_user_id),
    db: Db = Depends(get_db),
):
    """PRD / pasted spec → user stories + tasks. Preview only; no assignees."""
    _ai_quota(user_id)
    file_bytes = await file.read() if file is not None else None
    filename = file.filename if file is not None else None
    try:
        source, result = prd_extract_logic.extract_prd(
            db, user_id, text=text, file_bytes=file_bytes, filename=filename
        )
    except HTTPException:
        raise
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e) or _AI_UNAVAILABLE)
    except Exception as e:
        log.exception("AI request failed")
        raise HTTPException(status_code=500, detail=f"AI error: {e}")
    return {
        "sourceText": source,
        "stories": [s.model_dump() for s in result.stories],
    }


# ── Resolve a document / audio to text for review (before extraction) ──────────

@router.post("/parse-source")
async def parse_source(
    text: str | None = Form(None),
    file: UploadFile | None = File(None),
    user_id: str = Depends(get_current_user_id),
    db: Db = Depends(get_db),
):
    """Resolve an uploaded document or audio clip to plain text so the user can
    review/edit it before tasks are extracted. Returns {sourceText}."""
    _ai_quota(user_id)
    file_bytes = await file.read() if file is not None else None
    filename = file.filename if file is not None else None
    try:
        source = task_extraction_logic.resolve_source(
            db, user_id, text=text, file_bytes=file_bytes, filename=filename
        )
    except HTTPException:
        raise
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e) or _AI_UNAVAILABLE)
    except Exception as e:
        log.exception("AI parse-source failed")
        raise HTTPException(status_code=500, detail=f"AI error: {e}")
    return {"sourceText": source}


@router.post("/parse-task", response_model=ParseTaskResponse)
def parse_task(
    body: ParseTaskRequest,
    _user_id: str = Depends(get_current_user_id),
):
    """Convert natural language into structured task objects, resolving users and projects."""
    _ai_quota(user_id)
    try:
        return chains.parse_task(body.text, body.users, body.projects)
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e) or _AI_UNAVAILABLE)
    except Exception as e:
        log.exception("AI request failed")
        raise HTTPException(status_code=500, detail=f"AI error: {e}")
