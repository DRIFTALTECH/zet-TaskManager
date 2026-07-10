"""End-of-day standup recap — gather a user's activity for a day and let the AI
chain turn it into a short, friendly summary.

Strict layering: this logic gathers data via crud/, formats a plain-text work log,
and delegates the natural-language pass to ai.chains.summarize_day. No SQL here.
"""

import logging
from datetime import date

from database.database import Db

import crud.tasks as tasks_crud
import crud.timelog as timelog_crud
import crud.timesheet_entries as ts_crud
from ai import chains
from ai.response_parser import extract_final_answer
from ai.schemas import DaySummaryResponse
from database.models import Task
from logic import insight_logic

log = logging.getLogger("zet.daily_summary")

_RECAP_LEAK_MARKERS = ("let's see", "let us see")
_FALLBACK_RECAP = (
    "We couldn't generate your recap just now. "
    "Your tasks and time entries are still saved — check Tasks or Timesheet for today."
)


def _fmt_hm(seconds: int) -> str:
    h, m = divmod(max(0, seconds) // 60, 60)
    if h and m:
        return f"{h}h {m}m"
    if h:
        return f"{h}h"
    return f"{m}m"


def _build_work_log(
    tasks: list[Task],
    timelog_rows,
    timesheet_rows,
    task_titles: dict[str, str],
) -> str:
    """Assemble a compact plain-text log the LLM can summarise."""
    lines: list[str] = []

    if tasks:
        lines.append("Tasks worked on today:")
        for t in tasks:
            state = "completed" if t.completed_at else ("in progress" if t.is_started else t.status)
            desc = f" — {t.description.strip()}" if (t.description or "").strip() else ""
            lines.append(f"  - [{state}] {t.title}{desc}")
    else:
        lines.append("Tasks worked on today: none recorded.")

    if timelog_rows:
        lines.append("\nTime tracked on tasks:")
        for r in timelog_rows:
            title = task_titles.get(r.task_id, "a task")
            lines.append(f"  - {title}: {_fmt_hm(r.seconds)}")

    if timesheet_rows:
        lines.append("\nManual timesheet entries:")
        for e in timesheet_rows:
            label = (e.description or "").strip() or "(no description)"
            billable = "billable" if e.billable else "non-billable"
            lines.append(f"  - {label}: {_fmt_hm(e.seconds)} ({billable}, {e.time_from}-{e.time_to})")

    return "\n".join(lines)


def _line_looks_like_leak(line: str) -> bool:
    lower = extract_final_answer(line).lower().strip()
    if not lower:
        return True
    if insight_logic._looks_like_leak(line):
        return True
    return any(marker in lower for marker in _RECAP_LEAK_MARKERS)


def _sanitize_recap(text: str) -> str:
    """Same pipeline as analytics insights (_sanitize_text), preserving markdown newlines."""
    cleaned = extract_final_answer(text)
    parts = [ln.strip() for ln in cleaned.splitlines() if ln.strip() and not _line_looks_like_leak(ln)]
    if parts:
        return "\n".join(parts).strip()
    single = cleaned.strip()
    return "" if _line_looks_like_leak(single) else single


def _is_valid_recap(text: str) -> bool:
    return bool(text.strip()) and not _line_looks_like_leak(text)


def _generate_recap(work_date: str, work_log: str) -> str:
    """Prompt → complete() → _sanitize_recap. Retry once; fallback if still no recap."""
    for attempt in range(2):
        try:
            recap = _sanitize_recap(chains.summarize_day(work_date, work_log))
            if _is_valid_recap(recap):
                return recap
            log.warning("Day recap invalid/leaked attempt=%s", attempt + 1)
        except Exception as exc:
            log.warning("Day recap failed attempt=%s: %s", attempt + 1, exc)
    log.error("Day recap generation failed after retries; using fallback")
    return _FALLBACK_RECAP


def summarize_day(db: Db, user_id: str, work_date: str | None = None) -> DaySummaryResponse:
    """Gather the user's activity for `work_date` (default: today) and return an
    AI-generated recap plus the underlying tallies."""
    day = work_date or date.today().isoformat()

    tasks = tasks_crud.list_touched_on_for_user(db, user_id, day)
    timelog_rows = timelog_crud.list_for_user_date(db, user_id, day)
    timesheet_rows = ts_crud.list_for_user_range(db, user_id, day, day)

    tracked_seconds = sum(r.seconds for r in timelog_rows)
    timesheet_seconds = sum(e.seconds for e in timesheet_rows)
    billable_seconds = sum(e.seconds for e in timesheet_rows if e.billable)
    has_data = bool(tasks or timelog_rows or timesheet_rows)

    # Resolve task titles for time-log rows (titles for tasks not in `tasks`).
    title_ids = {r.task_id for r in timelog_rows} - {t.id for t in tasks}
    task_titles: dict[str, str] = {t.id: t.title for t in tasks}
    for tid in title_ids:
        t = tasks_crud.get_by_id(db, tid)
        if t:
            task_titles[tid] = t.title

    work_log = _build_work_log(tasks, timelog_rows, timesheet_rows, task_titles)
    summary = _generate_recap(day, work_log)

    return DaySummaryResponse(
        date=day,
        summary=summary,
        taskCount=len(tasks),
        trackedSeconds=tracked_seconds,
        timesheetSeconds=timesheet_seconds,
        billableSeconds=billable_seconds,
        hasData=has_data,
    )
