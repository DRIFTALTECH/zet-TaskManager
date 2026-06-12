from pydantic import BaseModel, Field


# ── Requests ──────────────────────────────────────────────────────────────────

class GenerateDescriptionRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    context: str | None = Field(None, max_length=500,
                                description="Optional extra context, e.g. project name or goal")


class SummarizeTaskRequest(BaseModel):
    task_id: str


class ParseTaskRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=2000,
                      description="Natural language like: 'fix login bug for John, high priority, due Friday'")


# ── Responses ─────────────────────────────────────────────────────────────────

class GenerateDescriptionResponse(BaseModel):
    description: str


class SummarizeTaskResponse(BaseModel):
    summary: str


# ── Structured output: single extracted task (used by parse + meeting feature) ─

class ExtractedTask(BaseModel):
    """
    One task extracted from natural language or a meeting transcript.
    All fields except title are optional — the user fills in what's missing.
    """
    title: str = Field(..., description="Short, actionable task title")
    description: str | None = Field(None, description="Detailed task description")
    priority: str | None = Field(
        None, description="One of: Urgent, High, Medium, Low"
    )
    due_date: str | None = Field(
        None, description="ISO 8601 date string, e.g. 2026-06-20"
    )
    estimated_hours: float | None = Field(
        None, description="Rough estimate of effort in hours"
    )
    suggested_assignee_name: str | None = Field(
        None, description="Name of person mentioned in context as responsible"
    )
    tags: list[str] = Field(default_factory=list, description="Relevant tags")


class ParseTaskResponse(BaseModel):
    tasks: list[ExtractedTask]


# ── Future: meeting / document ingestion ──────────────────────────────────────

class MeetingIngestResponse(BaseModel):
    """Returned after processing a meeting recording or document."""
    transcript: str | None = Field(None, description="Raw transcript (if audio was provided)")
    tasks: list[ExtractedTask]
