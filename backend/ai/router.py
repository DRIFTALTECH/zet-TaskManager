import os

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ai import chains
from ai.schemas import (
    GenerateDescriptionRequest,
    GenerateDescriptionResponse,
    ParseTaskRequest,
    ParseTaskResponse,
    SummarizeTaskResponse,
)
from database.database import get_db
from routes.deps import get_current_user_id

router = APIRouter()


# ── Health ────────────────────────────────────────────────────────────────────

@router.get("/health")
def ai_health():
    """
    Check that the AI module is wired up correctly.
    Returns whether the GROQ_API_KEY is configured — does NOT make a live API call.
    """
    key_set = bool(os.getenv("GROQ_API_KEY"))
    return {
        "status": "ok" if key_set else "degraded",
        "provider": "groq",
        "model": "llama-3.3-70b-versatile",
        "api_key_configured": key_set,
        "features": {
            "generate_description": key_set,
            "summarize_task": key_set,
            "parse_task": key_set,
            "meeting_ingestion": False,   # future feature
        },
    }


# ── Generate description ──────────────────────────────────────────────────────

@router.post("/generate-description", response_model=GenerateDescriptionResponse)
def generate_description(
    body: GenerateDescriptionRequest,
    _user_id: str = Depends(get_current_user_id),
):
    """Given a task title, return an AI-generated description."""
    try:
        return chains.generate_description(body.title, body.context)
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI error: {e}")


# ── Summarize task thread ─────────────────────────────────────────────────────

@router.post("/summarize-task/{task_id}", response_model=SummarizeTaskResponse)
def summarize_task(
    task_id: str,
    _user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    """Summarize the comment thread for a task into bullet-point TL;DR."""
    try:
        return chains.summarize_task(db, task_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI error: {e}")


# ── Parse natural language into tasks ─────────────────────────────────────────

@router.post("/parse-task", response_model=ParseTaskResponse)
def parse_task(
    body: ParseTaskRequest,
    _user_id: str = Depends(get_current_user_id),
):
    """
    Convert natural language into one or more structured task objects.
    Example: "Fix login bug for John, high priority, due next Friday"
    """
    try:
        return chains.parse_task(body.text)
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI error: {e}")
