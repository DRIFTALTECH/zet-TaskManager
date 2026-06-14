import os

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ai import chains
from ai.schemas import (
    ChatRequest,
    ChatResponse,
    GenerateDescriptionRequest,
    GenerateDescriptionResponse,
    ParseTaskRequest,
    ParseTaskResponse,
    SummarizeTaskResponse,
    TimesheetParseRequest,
    TimesheetParseResponse,
)
from database.database import get_db
from logic import user_logic
from routes.deps import get_current_user_id

router = APIRouter()

_USER_FACING_AI_ERROR = "Something went wrong. Please try again."
_AI_UNAVAILABLE = "AI is temporarily unavailable. Please try again later."


# ── Health ────────────────────────────────────────────────────────────────────

@router.get("/health")
def ai_health():
    """Check AI module config — does NOT make a live API call."""
    key_set = bool(os.getenv("GROQ_API_KEY"))
    return {
        "status": "ok" if key_set else "degraded",
        "provider": "groq",
        "model": "meta-llama/llama-4-scout-17b-16e-instruct",
        "api_key_configured": key_set,
        "features": {
            "chat": key_set,
            "generate_description": key_set,
            "summarize_task": key_set,
            "parse_task": key_set,
            "meeting_ingestion": False,
        },
    }


# ── Chat ──────────────────────────────────────────────────────────────────────

@router.post("/chat", response_model=ChatResponse)
def ai_chat(
    body: ChatRequest,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    """
    Agentic chat endpoint. Zani can now create projects, sections, tasks, and
    add team members using real tool calls against the live database.
    Manager-only tools (create_project, add_member) are enforced at the tool level.
    """
    current_user = user_logic.get_user_or_404(db, user_id)
    try:
        return chains.chat(body, db, current_user)
    except RuntimeError:
        raise HTTPException(status_code=503, detail=_AI_UNAVAILABLE)
    except Exception:
        raise HTTPException(status_code=500, detail=_USER_FACING_AI_ERROR)


# ── Generate description ──────────────────────────────────────────────────────

@router.post("/generate-description", response_model=GenerateDescriptionResponse)
def generate_description(
    body: GenerateDescriptionRequest,
    _user_id: str = Depends(get_current_user_id),
):
    """Given a task title (+ optional project/section), return an AI-generated description."""
    try:
        return chains.generate_description(
            body.title, body.project_name, body.section_name, body.context
        )
    except RuntimeError:
        raise HTTPException(status_code=503, detail=_AI_UNAVAILABLE)
    except Exception:
        raise HTTPException(status_code=500, detail=_USER_FACING_AI_ERROR)


# ── Summarize task thread ─────────────────────────────────────────────────────

@router.post("/summarize-task/{task_id}", response_model=SummarizeTaskResponse)
def summarize_task(
    task_id: str,
    _user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    """Summarize the comment thread for a task into a bullet-point TL;DR."""
    try:
        return chains.summarize_task(db, task_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except RuntimeError:
        raise HTTPException(status_code=503, detail=_AI_UNAVAILABLE)
    except Exception:
        raise HTTPException(status_code=500, detail=_USER_FACING_AI_ERROR)


# ── Parse daily summary into timesheet rows ───────────────────────────────────

@router.post("/parse-timesheet", response_model=TimesheetParseResponse)
def parse_timesheet(
    body: TimesheetParseRequest,
    _user_id: str = Depends(get_current_user_id),
):
    """Convert a natural language day summary into structured timesheet row proposals."""
    try:
        return chains.parse_timesheet(body.summary, body.work_date, body.projects)
    except RuntimeError:
        raise HTTPException(status_code=503, detail=_AI_UNAVAILABLE)
    except Exception:
        raise HTTPException(status_code=500, detail=_USER_FACING_AI_ERROR)


# ── Parse natural language into tasks ─────────────────────────────────────────

@router.post("/parse-task", response_model=ParseTaskResponse)
def parse_task(
    body: ParseTaskRequest,
    _user_id: str = Depends(get_current_user_id),
):
    """Convert natural language into structured task objects, resolving users and projects."""
    try:
        return chains.parse_task(body.text, body.users, body.projects)
    except RuntimeError:
        raise HTTPException(status_code=503, detail=_AI_UNAVAILABLE)
    except Exception:
        raise HTTPException(status_code=500, detail=_USER_FACING_AI_ERROR)
