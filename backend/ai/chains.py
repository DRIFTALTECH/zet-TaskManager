"""
High-level AI chains — combine service + prompts + domain logic.
Routes call these; they never call service.py directly.
"""

from datetime import date

from sqlalchemy.orm import Session

from ai import prompts, service
from ai.schemas import (
    ExtractedTask,
    GenerateDescriptionResponse,
    MeetingIngestResponse,
    ParseTaskResponse,
    SummarizeTaskResponse,
)
from database.models import Task
import crud.task_assignees as assignees_crud


def generate_description(title: str, context: str | None) -> GenerateDescriptionResponse:
    """Given a task title, return an AI-generated description."""
    text = service.complete(
        prompts.GENERATE_DESCRIPTION_PROMPT,
        {"title": title, "context": context or "None provided"},
    )
    return GenerateDescriptionResponse(description=text)


def summarize_task(db: Session, task_id: str) -> SummarizeTaskResponse:
    """Summarize the comment thread for a task."""
    from database.models import TaskFeedback

    task = db.get(Task, task_id)
    if not task:
        raise ValueError(f"Task {task_id} not found")

    comments = (
        db.query(TaskFeedback)
        .filter(TaskFeedback.task_id == task_id)
        .order_by(TaskFeedback.id.asc())
        .all()
    )

    if not comments:
        return SummarizeTaskResponse(summary="No comments yet.")

    from database.models import User
    thread = "\n".join(
        f"[{db.get(User, c.user_id).name if db.get(User, c.user_id) else 'Unknown'}]: {c.message}"
        for c in comments
    )

    text = service.complete(
        prompts.SUMMARIZE_TASK_PROMPT,
        {"title": task.title, "comments": thread},
    )
    return SummarizeTaskResponse(summary=text)


def parse_task(text: str) -> ParseTaskResponse:
    """Parse natural language into one or more structured ExtractedTask objects."""
    result = service.complete_structured(
        prompts.PARSE_TASK_PROMPT,
        {"text": text, "today": date.today().isoformat()},
        ParseTaskResponse,
    )
    return result


# ── Future: meeting ingestion ─────────────────────────────────────────────────

def extract_tasks_from_transcript(transcript: str) -> MeetingIngestResponse:
    """
    Extract tasks from a meeting transcript.
    Called by the meeting ingestion route (future feature).
    """
    result = service.complete_structured(
        prompts.MEETING_EXTRACT_PROMPT,
        {"transcript": transcript, "today": date.today().isoformat()},
        MeetingIngestResponse,
    )
    result.transcript = transcript
    return result


def extract_tasks_from_audio(audio_bytes: bytes, filename: str) -> MeetingIngestResponse:
    """
    Transcribe audio then extract tasks.
    Called by the meeting ingestion route (future feature).
    """
    transcript = service.transcribe(audio_bytes, filename)
    return extract_tasks_from_transcript(transcript)
