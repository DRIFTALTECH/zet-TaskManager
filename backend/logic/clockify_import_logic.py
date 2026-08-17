"""Import a Clockify **Detailed** report CSV into timesheet entries.

Expected export: Clockify → Reports → Detailed → Export → CSV. Header:

    Project,Client,Description,Task,User,Group,Email,Tags,Billable,
    Start Date,Start Time,End Date,End Time,Duration (h),Duration (decimal)

Column mapping into `timesheet_entries`:

    Email       -> the user the row is logged against (looked up by address)
    Start Date  -> work_date            (DD/MM/YYYY, day first)
    Start Time  -> time_from            (HH:MM:SS, seconds dropped)
    End Time    -> time_to              (HH:MM:SS, seconds dropped)
    Description -> description
    Project     -> project_id           (matched by name; unmatched rows skipped)
    Task        -> section_id           (matched by name; blank -> "General")
    Billable    -> billable             (Yes/No)

`seconds` is derived from the time span rather than trusted from the file, so a
row whose Duration disagrees with its own start/end cannot smuggle in bad totals.

Rows are validated individually and a failure never aborts the file: the caller
gets a per-row report. Every row goes through `timesheet_logic.create_entry`, so
imports obey exactly the same rules as manual entry — no future dates, no writing
into a submitted or approved week, and the user must belong to the project.
"""

import csv
import io
import logging
import re
from datetime import date

from fastapi import HTTPException, status

from database.database import Db

import crud.projects as projects_crud
import crud.sections as sections_crud
import crud.timesheet_entries as te_crud
import crud.users as users_crud
from database.init_db import new_id
from logic import project_logic, timesheet_logic
from logic.audit import log_audit
from logic.schemas import (
    ClockifyImportReport,
    ClockifyImportSkip,
    TimesheetEntryCreate,
)

log = logging.getLogger("zet.clockify_import")

MAX_CSV_BYTES = 10 * 1024 * 1024
MAX_ROWS = 20_000

# Section used when a row has no Task. Created per project on first use.
DEFAULT_SECTION_NAME = "General"

REQUIRED_COLUMNS = (
    "Description",
    "Project",
    "Task",
    "Email",
    "Billable",
    "Start Date",
    "Start Time",
    "End Time",
)

_DATE_RE = re.compile(r"^\s*(\d{1,2})[/-](\d{1,2})[/-](\d{4})\s*$")


def _decode(content: bytes) -> str:
    if len(content) > MAX_CSV_BYTES:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            f"CSV exceeds the {MAX_CSV_BYTES // (1024 * 1024)} MB limit",
        )
    # Clockify writes UTF-8, sometimes with a BOM; utf-8-sig strips it.
    for encoding in ("utf-8-sig", "utf-16", "latin-1"):
        try:
            return content.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise HTTPException(status.HTTP_400_BAD_REQUEST, "Could not read the file as text")


def _hhmm(raw: str) -> str:
    """`16:45:00` -> `16:45`. The timesheet stores wall-clock HH:MM only."""
    parts = (raw or "").strip().split(":")
    if len(parts) < 2:
        raise ValueError(f"invalid time {raw!r}")
    return f"{int(parts[0]):02d}:{int(parts[1]):02d}"


def _detect_day_first(rows: list[dict]) -> bool:
    """Clockify writes dates in the exporting account's locale, so `03/04/2025` is
    genuinely ambiguous — day-first in most of the world, month-first in the US.
    Guessing wrong silently files time under the wrong date, so we only accept a
    file that proves its own order: some value must have a first component above 12
    (day-first) or a second component above 12 (month-first).
    """
    first_over_12 = False
    second_over_12 = False
    for r in rows:
        m = _DATE_RE.match(r.get("Start Date") or "")
        if not m:
            continue
        a, b = int(m.group(1)), int(m.group(2))
        if a > 12:
            first_over_12 = True
        if b > 12:
            second_over_12 = True
    if first_over_12 and second_over_12:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "The Start Date column mixes day-first and month-first dates. "
            "Re-export the report with a single date format.",
        )
    if second_over_12:
        return False
    if first_over_12:
        return True
    raise HTTPException(
        status.HTTP_400_BAD_REQUEST,
        "Could not tell whether Start Date is DD/MM/YYYY or MM/DD/YYYY — every date "
        "in the file is ambiguous (no day above 12). Re-export a range that includes "
        "a date after the 12th of a month so the order is unmistakable.",
    )


def _parse_date(raw: str, day_first: bool) -> str:
    m = _DATE_RE.match(raw or "")
    if not m:
        raise ValueError(f"invalid date {raw!r}")
    a, b, year = int(m.group(1)), int(m.group(2)), int(m.group(3))
    day, month = (a, b) if day_first else (b, a)
    return date(year, month, day).isoformat()


def _resolve_section_id(db: Db, project_id: str, task_name: str) -> str:
    """Task column -> section. Blank Task lands in DEFAULT_SECTION_NAME, created
    once per project (the Clockify export leaves Task empty on most rows)."""
    name = (task_name or "").strip() or DEFAULT_SECTION_NAME
    existing = sections_crud.find_by_name(db, project_id, name)
    if existing:
        return existing.id
    created = sections_crud.create_section(
        db, section_id=new_id("sc"), name=name, project_id=project_id
    )
    return created.id


def import_detailed_csv(db: Db, actor_id: str, filename: str | None, content: bytes) -> ClockifyImportReport:
    """Parse and import a Clockify Detailed CSV. Caller must be a superadmin —
    rows are written to whichever user each row's Email names, not to the uploader."""
    project_logic_actor = users_crud.get_by_id(db, actor_id)
    if not project_logic_actor:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Account no longer exists")

    text = _decode(content)
    try:
        reader = csv.DictReader(io.StringIO(text))
        rows = list(reader)
    except csv.Error as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Could not parse the CSV: {e}")

    if not rows:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The file has no data rows")
    if len(rows) > MAX_ROWS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"The file has {len(rows)} rows; the limit is {MAX_ROWS}. Export a shorter date range.",
        )

    missing = [c for c in REQUIRED_COLUMNS if c not in (reader.fieldnames or [])]
    if missing:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"This does not look like a Clockify Detailed export — missing column(s): "
            f"{', '.join(missing)}. Use Reports → Detailed → Export → CSV.",
        )

    day_first = _detect_day_first(rows)

    # Caches so a 20k-row file does not re-query per row.
    users_by_email: dict[str, str | None] = {}
    projects_by_name: dict[str, str | None] = {}
    sections_by_key: dict[tuple[str, str], str] = {}

    imported = 0
    duplicates = 0
    skipped: list[ClockifyImportSkip] = []

    def skip(line: int, reason: str, detail: str = "") -> None:
        skipped.append(ClockifyImportSkip(line=line, reason=reason, detail=detail))

    for i, row in enumerate(rows):
        line = i + 2  # +1 for the header, +1 to make it 1-based like a spreadsheet

        email = (row.get("Email") or "").strip().lower()
        if not email:
            skip(line, "no_email", "The row has no Email, so there is no user to log it against")
            continue
        if email not in users_by_email:
            u = users_crud.get_by_email(db, email)
            users_by_email[email] = u.id if u else None
        user_id = users_by_email[email]
        if not user_id:
            skip(line, "unknown_user", f"No ZET account with the email {email}")
            continue

        project_name = (row.get("Project") or "").strip()
        if not project_name:
            skip(line, "no_project", "The row has no Project")
            continue
        if project_name not in projects_by_name:
            p = projects_crud.get_by_name(db, project_name)
            projects_by_name[project_name] = p.id if p else None
        project_id = projects_by_name[project_name]
        if not project_id:
            skip(line, "unknown_project", f'No ZET project named "{project_name}"')
            continue

        try:
            work_date = _parse_date(row.get("Start Date") or "", day_first)
            time_from = _hhmm(row.get("Start Time") or "")
            time_to = _hhmm(row.get("End Time") or "")
        except (ValueError, TypeError) as e:
            skip(line, "bad_date_or_time", str(e))
            continue

        description = (row.get("Description") or "").strip()
        billable = (row.get("Billable") or "").strip().lower() in ("yes", "true", "1")

        # Re-uploading the same export must not double the time.
        if te_crud.exists_matching(
            db,
            user_id=user_id,
            work_date=work_date,
            time_from=time_from,
            time_to=time_to,
            description=description,
        ):
            duplicates += 1
            continue

        section_key = (project_id, (row.get("Task") or "").strip().lower())
        if section_key not in sections_by_key:
            sections_by_key[section_key] = _resolve_section_id(db, project_id, row.get("Task") or "")
        section_id = sections_by_key[section_key]

        # One validation path with manual entry: future dates, locked weeks and
        # project membership are all enforced here.
        try:
            timesheet_logic.create_entry(
                db,
                user_id,
                TimesheetEntryCreate(
                    workDate=work_date,
                    projectId=project_id,
                    sectionId=section_id,
                    description=description,
                    timeFrom=time_from,
                    timeTo=time_to,
                    billable=billable,
                ),
            )
            imported += 1
        except HTTPException as e:
            reason = "rejected"
            detail = str(e.detail)
            lowered = detail.lower()
            if "future" in lowered:
                reason = "future_date"
            elif "submitted" in lowered or "approved" in lowered or "locked" in lowered:
                reason = "locked_week"
            elif "member" in lowered:
                reason = "not_project_member"
            skip(line, reason, detail)

    log_audit(
        db,
        actor_id,
        "timesheet.clockify_imported",
        "timesheet",
        actor_id,
        filename or "clockify.csv",
        {
            "rows": len(rows),
            "imported": imported,
            "duplicates": duplicates,
            "skipped": len(skipped),
            "dateOrder": "DD/MM/YYYY" if day_first else "MM/DD/YYYY",
        },
    )

    return ClockifyImportReport(
        filename=filename or "clockify.csv",
        totalRows=len(rows),
        imported=imported,
        duplicates=duplicates,
        skippedCount=len(skipped),
        dateOrder="DD/MM/YYYY" if day_first else "MM/DD/YYYY",
        # Cap what travels to the browser; the audit entry holds the totals.
        skipped=skipped[:200],
    )
