"""
High-level AI chains — combine service + prompts + domain logic.
Routes call these; they never call service.py directly.
"""

import json as _json
from datetime import date

from langchain_core.messages import HumanMessage, AIMessage, SystemMessage, ToolMessage
from sqlalchemy.orm import Session

from ai import prompts, service
from ai.schemas import (
    AgentAction,
    AICard,
    AIProposal,
    ChatRequest,
    ChatResponse,
    ExtractedTask,
    GenerateDescriptionResponse,
    MeetingIngestResponse,
    MomParseResult,
    ParseTaskResponse,
    StrictMomParseResult,
    StrictTimesheetParseResponse,
    SummarizeTaskResponse,
    TimesheetParseResponse,
)
from database.models import Task, User


# ── Helpers ───────────────────────────────────────────────────────────────────

def _users_str(users) -> str:
    if not users:
        return "No team members provided."
    lines = []
    for u in users:
        exp = getattr(u, "current_experience_months", 0) or 0
        title = getattr(u, "job_title", "") or ""
        exp_str = f"{exp // 12}y {exp % 12}m" if exp else "No experience listed"
        lines.append(f"- ID: {u.id} | Name: {u.name} | Role: {title or 'Not specified'} | Experience: {exp_str}")
    return "\n".join(lines)


def _projects_str(projects) -> str:
    if not projects:
        return "No projects provided."
    lines = []
    for p in projects:
        sections = getattr(p, "sections", []) or []
        if sections:
            sec_list = ", ".join(f"{s.name} (ID: {s.id})" for s in sections)
            lines.append(f"- ID: {p.id} | Name: {p.name} | Sections: {sec_list}")
        else:
            lines.append(f"- ID: {p.id} | Name: {p.name} | Sections: none")
    return "\n".join(lines)


# ── Chains ────────────────────────────────────────────────────────────────────

def generate_description(
    title: str,
    project_name: str | None,
    section_name: str | None,
    context: str | None,
) -> GenerateDescriptionResponse:
    text = service.complete(
        prompts.GENERATE_DESCRIPTION_PROMPT,
        {
            "title": title,
            "project_name": project_name or "Not specified",
            "section_name": section_name or "Not specified",
            "context": context or "None provided",
        },
    )
    return GenerateDescriptionResponse(description=text)


def summarize_task(db: Session, task_id: str) -> SummarizeTaskResponse:
    from database.models import TaskFeedback, User

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

    thread = "\n".join(
        f"[{db.get(User, c.user_id).name if db.get(User, c.user_id) else 'Unknown'}]: {c.message}"
        for c in comments
    )
    text = service.complete(
        prompts.SUMMARIZE_TASK_PROMPT,
        {"title": task.title, "comments": thread},
    )
    return SummarizeTaskResponse(summary=text)


def parse_task(text: str, users=None, projects=None) -> ParseTaskResponse:
    result = service.complete_structured(
        prompts.PARSE_TASK_PROMPT,
        {
            "text": text,
            "today": date.today().isoformat(),
            "users": _users_str(users or []),
            "projects": _projects_str(projects or []),
        },
        ParseTaskResponse,
    )
    return result


def chat(req: ChatRequest, db: Session, current_user: User) -> ChatResponse:
    """
    Agentic chat via manual LCEL tool-calling loop.
    Supports: create_project, create_section, create_task,
    add_member_to_project, list_projects, list_users.
    Manager-only tools are enforced at the tool level.
    """
    from ai.tools import build_tools

    tools = build_tools(db, current_user)
    tools_by_name = {t.name: t for t in tools}
    llm = service.bind_agent(tools)  # Groq primary + Ollama fallback

    # Build system message with injected context
    system_content = prompts.AGENT_SYSTEM.format(
        user_name=current_user.name,
        user_role=current_user.role,
        today=date.today().isoformat(),
        users=_users_str(req.users),
        projects=_projects_str(req.projects),
    )

    # Build full message list: system + history + current user message
    messages: list = [SystemMessage(content=system_content)]
    for msg in req.messages[:-1]:
        if msg.role == "user":
            messages.append(HumanMessage(content=msg.content))
        else:
            messages.append(AIMessage(content=msg.content))
    messages.append(HumanMessage(content=req.messages[-1].content))

    actions: list[AgentAction] = []
    proposals: list[AIProposal] = []
    cards: list[AICard] = []
    response = None

    # Agentic loop — capped at 8; lower = less runaway tool chaining
    for _ in range(8):
        response = llm.invoke(messages)
        messages.append(response)

        # No tool calls → done
        if not getattr(response, "tool_calls", None):
            break

        # Execute each tool call and append ToolMessage results
        for tc in response.tool_calls:
            tool_name = tc["name"]
            tool_args = tc["args"]
            tool = tools_by_name.get(tool_name)

            if tool is None:
                raw = f"ERROR: Unknown tool '{tool_name}'"
            else:
                try:
                    raw = tool.invoke(tool_args)
                except Exception as exc:
                    raw = f"ERROR: {exc}"

            raw = str(raw)

            # Parse status prefix
            if raw.startswith("PROPOSED:"):
                status = "proposed"
                json_str = raw[len("PROPOSED:"):].strip()
                try:
                    data = _json.loads(json_str)
                    proposals.append(AIProposal(**data))
                    summary = (
                        data.get("title")
                        or data.get("name")
                        or data.get("section_name")
                        or data.get("user_name")
                        or "pending"
                    )
                except Exception:
                    summary = json_str[:120]
            elif raw.startswith("CARDS:"):
                status = "data"
                json_str = raw[len("CARDS:"):].strip()
                try:
                    items = _json.loads(json_str)
                    for item in items:
                        card_type = item.get("type", "unknown")
                        card_data = {k: v for k, v in item.items() if k != "type"}
                        cards.append(AICard(type=card_type, data=card_data))
                    summary = f"Fetched {len(items)} result(s)"
                except Exception:
                    summary = "Data retrieved"
            elif raw.startswith("ALREADY_EXISTS:"):
                status = "already_exists"
                summary = raw[len("ALREADY_EXISTS:"):].strip()
            elif raw.startswith("SUCCESS:"):
                status = "success"
                summary = raw[len("SUCCESS:"):].strip()
            elif raw.startswith("ACCESS DENIED:"):
                status = "denied"
                summary = raw[len("ACCESS DENIED:"):].strip()
            else:
                status = "error"
                summary = raw[len("ERROR:"):].strip() if raw.startswith("ERROR:") else raw

            if status != "error":
                actions.append(AgentAction(tool=tool_name, status=status, summary=summary))
            messages.append(ToolMessage(content=raw, tool_call_id=tc["id"]))

    final_text = getattr(response, "content", "") if response is not None else ""

    return ChatResponse(
        message=final_text,
        tasks=[],
        actions=actions,
        proposals=proposals,
        cards=cards,
    )


# ── Timesheet parser ──────────────────────────────────────────────────────────

def parse_timesheet(summary: str, work_date: str, projects=None) -> TimesheetParseResponse:
    """Convert a natural language day summary into structured timesheet rows.

    Primary path uses constrained decoding (strict json_schema) so the model
    cannot emit stringified scalars or extra keys — this is what previously
    triggered Groq 400 tool_use_failed errors. If the strict path fails for any
    reason (model/provider hiccup), fall back to the lenient tool-calling path,
    whose coercers tolerate stringified scalars.
    """
    variables = {
        "summary": summary,
        "work_date": work_date,
        "projects": _projects_str(projects or []),
    }
    try:
        strict = service.complete_structured_strict(
            prompts.TIMESHEET_PARSE_PROMPT,
            variables,
            StrictTimesheetParseResponse,
        )
        return TimesheetParseResponse.model_validate(strict.model_dump())
    except Exception:
        return service.complete_structured(
            prompts.TIMESHEET_PARSE_PROMPT,
            variables,
            TimesheetParseResponse,
        )


# ── End-of-day standup recap ──────────────────────────────────────────────────

def summarize_day(work_date: str, work_log: str) -> str:
    """Turn a structured day-of-work log into a short, friendly recap (markdown).

    `work_log` is assembled by logic/daily_summary_logic from the user's tasks,
    time logs and timesheet rows — this chain only does the natural-language pass.
    """
    return service.complete(
        prompts.DAY_SUMMARY_PROMPT,
        {"work_date": work_date, "work_log": work_log},
    )


# ── Future: meeting ingestion ─────────────────────────────────────────────────

def extract_tasks_from_transcript(transcript: str, users=None, projects=None) -> MeetingIngestResponse:
    result = service.complete_structured(
        prompts.MEETING_EXTRACT_PROMPT,
        {
            "transcript": transcript,
            "today": date.today().isoformat(),
            "users": _users_str(users or []),
            "projects": _projects_str(projects or []),
        },
        MeetingIngestResponse,
    )
    result.transcript = transcript
    return result


def extract_tasks_from_audio(audio_bytes: bytes, filename: str, users=None, projects=None) -> MeetingIngestResponse:
    transcript = service.transcribe(audio_bytes, filename)
    return extract_tasks_from_transcript(transcript, users, projects)


# ── Minutes-of-Meeting per-person parser ──────────────────────────────────────

def parse_meeting_notes(notes: str) -> MomParseResult:
    """Turn raw scrum/MOM text into a clean per-person breakdown.

    Tries constrained decoding first (guaranteed-valid JSON); falls back to the
    lenient structured path if the strict model/provider hiccups.
    """
    variables = {"notes": notes}
    try:
        strict = service.complete_structured_strict(
            prompts.MOM_PARSE_PROMPT,
            variables,
            StrictMomParseResult,
        )
        return MomParseResult.model_validate(strict.model_dump())
    except Exception:
        return service.complete_structured(
            prompts.MOM_PARSE_PROMPT,
            variables,
            MomParseResult,
        )
