import re
from datetime import datetime
from typing import Any

def parse_clockify_dt(iso: str) -> datetime:
    """Parses Clockify ISO timestamp string to datetime object."""
    return datetime.fromisoformat(iso.replace("Z", "+00:00"))

def format_work_date(iso: str) -> str:
    """Formats Clockify ISO timestamp string to 'YYYY-MM-DD'."""
    try:
        return parse_clockify_dt(iso).date().isoformat()
    except Exception:
        return ""

def format_time(iso: str) -> str:
    """Formats Clockify ISO timestamp string to 'HH:MM'."""
    try:
        dt = parse_clockify_dt(iso)
        return f"{dt.hour:02d}:{dt.minute:02d}"
    except Exception:
        return ""

def hm_from_iso(iso: str) -> str:
    """Backward compatible wrapper for formatting time."""
    return format_time(iso)

def calculate_seconds(start_iso: str, end_iso: str) -> int:
    """Computes duration in seconds from start and end ISO timestamps."""
    try:
        dt_start = parse_clockify_dt(start_iso)
        dt_end = parse_clockify_dt(end_iso)
        return max(0, int((dt_end - dt_start).total_seconds()))
    except Exception:
        return 0

def entry_seconds(entry: dict[str, Any], start_iso: str, end_iso: str) -> int:
    """Backward compatible wrapper for entry seconds, always computing from timestamps."""
    return calculate_seconds(start_iso, end_iso)

def entry_clockify_id(entry: dict[str, Any]) -> str | None:
    """Extracts and sanitizes the Clockify ID from a time entry."""
    raw = entry.get("id") or entry.get("_id")
    if not raw:
        return None
    safe = re.sub(r"[^a-zA-Z0-9_-]", "", str(raw))
    return safe or None

def safe_clockify_id(raw: Any) -> str | None:
    """Extracts and sanitizes any raw Clockify ID string."""
    if not raw:
        return None
    safe = re.sub(r"[^a-zA-Z0-9_-]", "", str(raw))
    return safe or None

def parse_clockify_due(ck_task: dict[str, Any]) -> str:
    """Clockify task due date if present; otherwise empty (no due date)."""
    raw = ck_task.get("dueDate") or ck_task.get("due_date")
    if not raw:
        return ""
    try:
        return str(raw)[:10]
    except (TypeError, ValueError):
        return ""

def ck_task_status(raw: str) -> str:
    """Maps Clockify task status to ZET task status."""
    return {"DONE": "completed", "ACTIVE": "in_progress"}.get((raw or "").upper(), "backlog")

def map_time_entry(
    entry: dict[str, Any],
    user_id: str,
    project_id: str,
    section_id: str,
    now: str
) -> dict[str, Any]:
    """
    Maps a raw Clockify time entry to the exact dictionary format expected by ZET.
    """
    raw_id = entry_clockify_id(entry)
    zet_id = f"clk_{raw_id}" if raw_id else None

    interval = entry.get("timeInterval") or {}
    start_iso = interval.get("start")
    end_iso = interval.get("end")

    work_date = format_work_date(start_iso) if start_iso else ""
    time_from = format_time(start_iso) if start_iso else ""
    time_to = format_time(end_iso) if end_iso else ""
    seconds = calculate_seconds(start_iso, end_iso) if (start_iso and end_iso) else 0

    return {
        "id": zet_id,
        "user_id": user_id,
        "work_date": work_date,
        "project_id": project_id,
        "section_id": section_id,
        "description": entry.get("description") or "",
        "time_from": time_from,
        "time_to": time_to,
        "seconds": seconds,
        "billable": bool(entry.get("billable", True)),
        "created_at": now,
    }

