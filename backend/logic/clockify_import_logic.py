"""Import a Clockify **Detailed** report CSV into timesheet entries.

Expected export: Clockify → Reports → Detailed → Export → CSV. Header:

    Project,Client,Description,Task,User,Group,Email,Tags,Billable,
    Start Date,Start Time,End Date,End Time,Duration (h),Duration (decimal)

Column mapping into `timesheet_entries`:

    Email       -> the user the row is logged against (looked up by address)
    Start Date  -> work_date            (see _parse_date: dashes, slashes, dots,
                                         2-digit years, month names or ISO)
    Start Time  -> time_from            (HH:MM:SS, seconds dropped)
    End Time    -> time_to              (HH:MM:SS, seconds dropped)
    Description -> description
    Project     -> project_id           (matched by name; CREATED if missing)
    Client      -> the new project's client (CREATED if missing)
    User        -> display name for a CREATED user
    Task        -> section_id           (matched by name; blank -> "General")
    Billable    -> billable             (Yes/No)

`seconds` is derived from the time span rather than trusted from the file, so a
row whose Duration disagrees with its own start/end cannot smuggle in bad totals.

Missing records are CREATED, not skipped: Clockify is the source of truth for what
work happened, and dropping every row whose project or person ZET has not seen made
the import near-useless (2020 of 2193 rows on a real export). Projects, clients,
users and project memberships are all created on first sight and listed in the
report. Imported users are created INACTIVE — importing someone's timesheet must
not hand them a working login; a superadmin approves them at /superadmin.

Rows are still validated individually and a failure never aborts the file. Every
row goes through `timesheet_logic.create_entry`, so imports obey the same rules as
manual entry — no future dates, and no writing into a week pending review.
"""

import csv
import io
import logging
import re
import uuid
from datetime import date, datetime, timezone

from fastapi import HTTPException, status

from database.database import Db

import crud.clients as clients_crud
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

# Numeric dates: D/M/Y, D-M-Y or D.M.Y, with 2- or 4-digit years. Which of the
# first two parts is the day is decided per-file by _detect_day_first.
_DATE_RE = re.compile(r"^\s*(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|\d{4})\s*$")

# Unambiguous shapes, parsed directly and excluded from day-first detection.
_ISO_RE = re.compile(r"^\s*(\d{4})-(\d{1,2})-(\d{1,2})\s*$")
_NAMED_RE = re.compile(r"^\s*(\d{1,2})[\s/.\-]([A-Za-z]{3,9})[\s/.\-](\d{2}|\d{4})\s*$")

_MONTHS = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "sept": 9, "oct": 10, "nov": 11, "dec": 12,
}


def _expand_year(raw: int) -> int:
    """Two-digit years: 26 -> 2026. Anything past 70 is treated as 19xx."""
    if raw >= 100:
        return raw
    return 2000 + raw if raw < 70 else 1900 + raw


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
    numeric_rows = 0
    for r in rows:
        text = (r.get("Start Date") or "").strip()
        # ISO and month-name dates state their own order, so they neither need nor
        # inform the day-first decision.
        if _ISO_RE.match(text) or _NAMED_RE.match(text):
            continue
        m = _DATE_RE.match(text)
        if not m:
            continue
        numeric_rows += 1
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
    # No numeric dates at all: every row was ISO or month-named, so the order is
    # already known and the answer here is irrelevant.
    if numeric_rows == 0:
        return True
    raise HTTPException(
        status.HTTP_400_BAD_REQUEST,
        "Could not tell whether Start Date is DD/MM/YYYY or MM/DD/YYYY — every date "
        "in the file is ambiguous (no day above 12). Re-export a range that includes "
        "a date after the 12th of a month so the order is unmistakable.",
    )


def _parse_date(raw: str, day_first: bool) -> str:
    """Parse the date shapes exports actually contain, into YYYY-MM-DD.

    Accepts 13/08/2026, 13-08-2026, 13.08.2026, 13-08-26, 13-Aug-2026 and
    2026-08-13. Only the all-numeric forms depend on `day_first`; the ISO and
    month-name forms carry their own order.
    """
    text = (raw or "").strip()

    iso = _ISO_RE.match(text)
    if iso:
        return date(int(iso.group(1)), int(iso.group(2)), int(iso.group(3))).isoformat()

    named = _NAMED_RE.match(text)
    if named:
        month = _MONTHS.get(named.group(2).lower()[:4]) or _MONTHS.get(named.group(2).lower()[:3])
        if not month:
            raise ValueError(f"unknown month name in {raw!r}")
        return date(_expand_year(int(named.group(3))), month, int(named.group(1))).isoformat()

    m = _DATE_RE.match(text)
    if not m:
        raise ValueError(f"unrecognised date {raw!r}")
    a, b, year = int(m.group(1)), int(m.group(2)), _expand_year(int(m.group(3)))
    day, month = (a, b) if day_first else (b, a)
    return date(year, month, day).isoformat()


def _resolve_client_id(db: Db, name: str, created: list[str]) -> str | None:
    """Client column -> clients row, created on first sight. Blank means no client."""
    trimmed = (name or "").strip()
    if not trimmed:
        return None
    existing = clients_crud.get_by_name_ci(db, trimmed)
    if existing:
        return existing.id
    row = clients_crud.create(
        db, client_id=new_id("c"), name=trimmed,
        created_at=datetime.now(timezone.utc).isoformat(),
    )
    created.append(trimmed)
    return row.id


def _resolve_project_id(
    db: Db, name: str, client_name: str, actor_id: str,
    created_projects: list[str], created_clients: list[str],
) -> str:
    """Project column -> projects row, created on first sight.

    Clockify is the source of truth for what work exists, so a project the export
    names but ZET does not have is created rather than dropping every row for it.
    """
    existing = projects_crud.get_by_name(db, name)
    if existing:
        return existing.id
    project = projects_crud.create_project(
        db,
        project_id=new_id("p"),
        name=name.strip(),
        description="Created by Clockify import",
        client_id=_resolve_client_id(db, client_name, created_clients),
        created_by=actor_id,
        created_at=datetime.now(timezone.utc).isoformat(),
    )
    created_projects.append(name.strip())
    return project.id


def _resolve_user_id(db: Db, email: str, display_name: str, created: list[str]) -> str:
    """Email column -> users row, created on first sight.

    New accounts are INACTIVE, exactly like self-registration: importing someone's
    timesheet must not hand them a working login. A superadmin approves them at
    /superadmin, and until then the rows exist but the person cannot sign in.
    """
    existing = users_crud.get_by_email(db, email)
    if existing:
        return existing.id
    import secrets

    from logic import auth_logic

    user = users_crud.create_user(
        db,
        user_id=str(uuid.uuid4()),
        name=(display_name or "").strip() or email.split("@", 1)[0],
        email=email,
        password_hash=auth_logic.hash_password(secrets.token_urlsafe(48)),
        role="employee",
        is_active=False,
    )
    created.append(email)
    return user.id


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
    users_by_email: dict[str, str] = {}
    projects_by_name: dict[str, str] = {}
    sections_by_key: dict[tuple[str, str], str] = {}
    members_added: set[tuple[str, str]] = set()

    created_projects: list[str] = []
    created_clients: list[str] = []
    created_users: list[str] = []

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
            users_by_email[email] = _resolve_user_id(
                db, email, row.get("User") or "", created_users
            )
        user_id = users_by_email[email]

        project_name = (row.get("Project") or "").strip()
        if not project_name:
            skip(line, "no_project", "The row has no Project")
            continue
        if project_name not in projects_by_name:
            projects_by_name[project_name] = _resolve_project_id(
                db, project_name, row.get("Client") or "", actor_id,
                created_projects, created_clients,
            )
        project_id = projects_by_name[project_name]

        # The importer writes on this person's behalf, so they must be a member of
        # the project — create_entry enforces that. Add the membership rather than
        # dropping the row; Clockify already treats them as working on it.
        if (project_id, user_id) not in members_added:
            projects_crud.add_member(db, project_id, user_id)
            members_added.add((project_id, user_id))

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
            "createdProjects": created_projects,
            "createdClients": created_clients,
            "createdUsers": created_users,
            "membershipsAdded": len(members_added),
        },
    )

    return ClockifyImportReport(
        filename=filename or "clockify.csv",
        totalRows=len(rows),
        imported=imported,
        duplicates=duplicates,
        skippedCount=len(skipped),
        dateOrder="DD/MM/YYYY" if day_first else "MM/DD/YYYY",
        createdProjects=created_projects,
        createdClients=created_clients,
        createdUsers=created_users,
        membershipsAdded=len(members_added),
        # Cap what travels to the browser; the audit entry holds the totals.
        skipped=skipped[:200],
    )
