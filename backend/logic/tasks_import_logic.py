"""Import a delivery-sheet CSV into ZET tasks (superadmin only).

Expected header (single row — no merged title row required):

    Application, Week, Priority, Capability, Feature, Description, Added On,
    Phase, Status, Complexity, in Hours, Developer, Start Date, Completed Date,
    Dependency, Comments

Dates are typically day-first (e.g. 10/8/2026 = 10 Aug 2026). Mapping:

    Application     -> project (matched by name; CREATED if missing)
    Feature         -> section (blank -> Capability -> "General")
    Description     -> task title
    Priority (P1…)  -> Urgent / High / Medium / Low
    Status          -> completed / in_progress / in_review / backlog
    Developer       -> assignee (optional; blank = unassigned, assign later)
    Description     -> task title (falls back to Feature / Capability)
    Start Date      -> started_at when present
    in Hours        -> time_tracked (seconds)
    other columns   -> tags / custom_fields / description body
"""

from __future__ import annotations

import csv
import io
import logging
import re
import secrets
import uuid
from datetime import date, datetime, timezone

from fastapi import HTTPException, status

from database.database import Db
from database.init_db import new_id

import crud.projects as projects_crud
import crud.sections as sections_crud
import crud.task_assignees as assignees_crud
import crud.tasks as tasks_crud
import crud.users as users_crud
from logic import auth_logic
from logic.audit import log_audit
from logic.schemas import TasksImportReport, TasksImportSkip
import realtime

log = logging.getLogger("zet.tasks_import")

MAX_CSV_BYTES = 10 * 1024 * 1024
MAX_ROWS = 10_000
DEFAULT_SECTION_NAME = "General"

REQUIRED_COLUMNS = ("Application",)

_DATE_RE = re.compile(r"^\s*(\d{1,2})[/-](\d{1,2})[/-](\d{4})\s*$")


def _decode(content: bytes) -> str:
    if len(content) > MAX_CSV_BYTES:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            f"CSV exceeds the {MAX_CSV_BYTES // (1024 * 1024)} MB limit",
        )
    for encoding in ("utf-8-sig", "utf-16", "latin-1"):
        try:
            return content.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise HTTPException(status.HTTP_400_BAD_REQUEST, "Could not read the file as text")


def _sniff_dialect(sample: str) -> csv.Dialect:
    try:
        return csv.Sniffer().sniff(sample[:4096], delimiters=",\t;")
    except csv.Error:
        class _Comma(csv.Dialect):
            delimiter = ","
            quotechar = '"'
            doublequote = True
            skipinitialspace = True
            lineterminator = "\n"
            quoting = csv.QUOTE_MINIMAL
        return _Comma()


def _parse_rows(text: str) -> tuple[list[dict[str, str]], int]:
    """Find the header row with Application + Description, then parse data rows.

    Returns (rows, header_line_number_1based).
    """
    dialect = _sniff_dialect(text)
    raw = list(csv.reader(io.StringIO(text), dialect))
    if not raw:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The file has no data rows")

    header_idx = None
    for i, row in enumerate(raw):
        cells = {(c or "").strip() for c in row}
        if "Application" in cells:
            header_idx = i
            break
    if header_idx is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Could not find a header row with an Application column.",
        )

    headers = [(c or "").strip() for c in raw[header_idx]]
    seen: dict[str, int] = {}
    unique_headers: list[str] = []
    for h in headers:
        key = h or f"_col{len(unique_headers)}"
        if key in seen:
            seen[key] += 1
            key = f"{key}_{seen[key]}"
        else:
            seen[key] = 0
        unique_headers.append(key)

    missing = [c for c in REQUIRED_COLUMNS if c not in unique_headers]
    if missing:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Missing required column(s): {', '.join(missing)}",
        )

    rows: list[dict[str, str]] = []
    for data in raw[header_idx + 1 :]:
        if not any((c or "").strip() for c in data):
            continue
        padded = list(data) + [""] * max(0, len(unique_headers) - len(data))
        rows.append({unique_headers[i]: (padded[i] or "").strip() for i in range(len(unique_headers))})

    return rows, header_idx + 1


def _detect_day_first(rows: list[dict[str, str]]) -> bool:
    """Delivery sheets use day-first (10/8/2026 = 10 Aug). Flip only when month-first is proven."""
    first_over_12 = False
    second_over_12 = False
    for r in rows:
        for col in ("Start Date", "Completed Date", "Added On"):
            m = _DATE_RE.match(r.get(col) or "")
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
            "Date columns mix day-first and month-first values. Re-export with one format.",
        )
    if second_over_12:
        return False
    return True  # proven day-first, or ambiguous → DD/MM


def _parse_date(raw: str, day_first: bool) -> str | None:
    trimmed = (raw or "").strip()
    if not trimmed:
        return None
    m = _DATE_RE.match(trimmed)
    if not m:
        raise ValueError(f"invalid date {raw!r}")
    a, b, year = int(m.group(1)), int(m.group(2)), int(m.group(3))
    day, month = (a, b) if day_first else (b, a)
    return date(year, month, day).isoformat()


def _map_priority(raw: str) -> str:
    p = (raw or "").strip().upper()
    if p in ("P1", "URGENT", "CRITICAL"):
        return "Urgent"
    if p in ("P2", "HIGH"):
        return "High"
    if p in ("P3", "MEDIUM", "MED", "NORMAL"):
        return "Medium"
    if p in ("P4", "LOW"):
        return "Low"
    return "Medium"


def _map_status(raw: str) -> str:
    s = (raw or "").strip().lower()
    if s in ("completed", "complete", "done", "closed", "finished"):
        return "done"
    if s in ("in progress", "in_progress", "development", "dev", "doing", "active"):
        return "in_progress"
    if s in ("in review", "in_review", "review", "qa"):
        return "in_review"
    return "backlog"


def _hours_to_seconds(raw: str) -> int:
    trimmed = (raw or "").strip().replace(",", "")
    if not trimmed:
        return 0
    try:
        hours = float(trimmed)
    except ValueError:
        return 0
    if hours < 0:
        return 0
    return int(round(hours * 3600))


def _resolve_project_id(db: Db, name: str, actor_id: str, created: list[str]) -> str:
    existing = projects_crud.get_by_name(db, name)
    if existing:
        return existing.id
    project = projects_crud.create_project(
        db,
        project_id=new_id("p"),
        name=name.strip(),
        description="Created by tasks CSV import",
        client_id=None,
        created_by=actor_id,
        created_at=datetime.now(timezone.utc).isoformat(),
    )
    created.append(name.strip())
    return project.id


def _synthetic_email(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", ".", name.strip().lower()).strip(".") or "user"
    return f"import.{slug}@zet.imported"


def _resolve_user_id(db: Db, display_name: str, created: list[str]) -> str:
    existing = users_crud.get_by_name_ci(db, display_name)
    if existing:
        return existing.id
    email = _synthetic_email(display_name)
    by_email = users_crud.get_by_email(db, email)
    if by_email:
        return by_email.id
    user = users_crud.create_user(
        db,
        user_id=str(uuid.uuid4()),
        name=display_name.strip(),
        email=email,
        password_hash=auth_logic.hash_password(secrets.token_urlsafe(48)),
        role="employee",
        is_active=False,
    )
    created.append(display_name.strip())
    return user.id


def _resolve_section_id(db: Db, project_id: str, feature: str, capability: str) -> str:
    name = (feature or "").strip() or (capability or "").strip() or DEFAULT_SECTION_NAME
    existing = sections_crud.find_by_name(db, project_id, name)
    if existing:
        return existing.id
    created = sections_crud.create_section(
        db, section_id=new_id("sc"), name=name, project_id=project_id
    )
    return created.id


def _build_description(row: dict[str, str]) -> str:
    parts: list[str] = []
    feature = (row.get("Feature") or "").strip()
    capability = (row.get("Capability") or "").strip()
    comments = (row.get("Comments") or "").strip()
    if feature:
        parts.append(f"Feature: {feature}")
    if capability:
        parts.append(f"Capability: {capability}")
    if comments:
        parts.append(f"Comments: {comments}")
    return "\n".join(parts)


def _build_tags(row: dict[str, str]) -> list[str]:
    tags: list[str] = []
    for col in ("Week", "Phase", "Complexity"):
        v = (row.get(col) or "").strip()
        if v:
            tags.append(v if col == "Week" else f"{col}:{v}")
    return tags[:20]


def _build_custom_fields(row: dict[str, str]) -> dict[str, str]:
    fields: dict[str, str] = {}
    for col in ("Week", "Phase", "Complexity", "Dependency", "Added On", "in Hours"):
        v = (row.get(col) or "").strip()
        if v:
            fields[col] = v
    return fields


def import_delivery_csv(db: Db, actor_id: str, filename: str | None, content: bytes) -> TasksImportReport:
    """Import delivery CSV. Batched to avoid exhausting the DB connection pool:

    - resolve projects/users/sections once (cached)
    - preload existing titles for dedup (one query)
    - single transaction for all inserts
    - quiet inserts (no per-row re-fetch / realtime bump)
    """
    actor = users_crud.get_by_id(db, actor_id)
    if not actor:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Account no longer exists")

    text = _decode(content)
    rows, header_line = _parse_rows(text)
    if not rows:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The file has no data rows")
    if len(rows) > MAX_ROWS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"The file has {len(rows)} rows; the limit is {MAX_ROWS}.",
        )

    day_first = _detect_day_first(rows)

    projects_by_name: dict[str, str] = {}
    users_by_name: dict[str, str] = {}
    sections_by_key: dict[tuple[str, str], str] = {}
    members_added: set[tuple[str, str]] = set()

    created_projects: list[str] = []
    created_users: list[str] = []
    skipped: list[TasksImportSkip] = []
    imported = 0
    duplicates = 0

    def skip(line: int, reason: str, detail: str = "") -> None:
        skipped.append(TasksImportSkip(line=line, reason=reason, detail=detail))

    # ── Pass 1: resolve projects / people / sections (few unique names) ───────
    prepared: list[dict] = []
    for i, row in enumerate(rows):
        line = header_line + 1 + i

        app_name = (row.get("Application") or "").strip()
        if not app_name:
            skip(line, "no_project", "The row has no Application (project)")
            continue

        feature = (row.get("Feature") or "").strip()
        capability = (row.get("Capability") or "").strip()
        title = (
            (row.get("Description") or "").strip()
            or feature
            or capability
            or "Untitled task"
        )
        if len(title) > 500:
            title = title[:497] + "…"

        developer = (row.get("Developer") or "").strip()

        try:
            start_iso = _parse_date(row.get("Start Date") or "", day_first)
            completed_iso = _parse_date(row.get("Completed Date") or "", day_first)
            added_iso = _parse_date(row.get("Added On") or "", day_first)
        except ValueError as e:
            skip(line, "bad_date", str(e))
            continue

        if app_name not in projects_by_name:
            projects_by_name[app_name] = _resolve_project_id(db, app_name, actor_id, created_projects)
        project_id = projects_by_name[app_name]

        if (project_id, actor_id) not in members_added:
            projects_crud.add_member(db, project_id, actor_id)
            members_added.add((project_id, actor_id))

        assignee_ids: list[str] = []
        if developer:
            if developer not in users_by_name:
                users_by_name[developer] = _resolve_user_id(db, developer, created_users)
            assignee_id = users_by_name[developer]
            assignee_ids = [assignee_id]
            if (project_id, assignee_id) not in members_added:
                projects_crud.add_member(db, project_id, assignee_id)
                members_added.add((project_id, assignee_id))

        primary = assignee_ids[0] if assignee_ids else actor_id

        section_key = (project_id, (feature or capability or DEFAULT_SECTION_NAME).strip().lower())
        if section_key not in sections_by_key:
            sections_by_key[section_key] = _resolve_section_id(db, project_id, feature, capability)
        section_id = sections_by_key[section_key]

        status_val = _map_status(row.get("Status") or "")
        priority = _map_priority(row.get("Priority") or "")
        time_tracked = _hours_to_seconds(row.get("in Hours") or "")
        # Delivery sheets have no due-date column — leave empty (column is NOT NULL).
        due = ""
        sprint = ""
        for key in ("Sprint", "Delivery Week", "Week"):
            v = (row.get(key) or "").strip()
            if v:
                sprint = v[:120]
                break
        is_started = bool(start_iso) or status_val in ("in_progress", "in_review", "done")
        started_at = start_iso
        completed_at = completed_iso if status_val == "done" else None
        if status_val == "done" and not completed_at:
            completed_at = start_iso or added_iso or date.today().isoformat()

        prepared.append({
            "line": line,
            "project_id": project_id,
            "section_id": section_id,
            "title": title,
            "primary": primary,
            "assignee_ids": assignee_ids,
            "row": row,
            "status_val": status_val,
            "priority": priority,
            "time_tracked": time_tracked,
            "due": due,
            "sprint": sprint,
            "is_started": is_started,
            "started_at": started_at,
            "completed_at": completed_at,
        })

    # ── Pass 2: preload existing titles once, then insert in one transaction ──
    assigned_keys, unassigned_keys = tasks_crud.load_dedup_index(db, list(projects_by_name.values()))
    # Also track keys created earlier in this same file.
    created_at = datetime.now(timezone.utc).isoformat()

    with db.transaction():
        for item in prepared:
            pid = item["project_id"]
            title = item["title"]
            primary = item["primary"]
            aids = item["assignee_ids"]

            if aids:
                key_a = (pid, title, primary)
                if key_a in assigned_keys:
                    duplicates += 1
                    continue
            else:
                key_u = (pid, title)
                if key_u in unassigned_keys:
                    duplicates += 1
                    continue

            tid = new_id("t")
            tasks_crud.insert_imported_task(
                db,
                task_id=tid,
                title=title,
                description=_build_description(item["row"]),
                project_id=pid,
                section_id=item["section_id"],
                assigned_to=primary,
                assigned_by=actor_id,
                created_by=actor_id,
                due_date=item["due"],
                sprint=item["sprint"],
                priority=item["priority"],
                status=item["status_val"],
                is_started=item["is_started"],
                started_at=item["started_at"],
                completed_at=item["completed_at"],
                approved_by_manager=item["status_val"] == "done",
                time_tracked=item["time_tracked"],
                tags=_build_tags(item["row"]),
                created_at=created_at,
                custom_fields=_build_custom_fields(item["row"]),
            )
            if aids:
                assignees_crud.insert_assignees_quiet(db, tid, aids)
                assigned_keys.add((pid, title, primary))
            else:
                unassigned_keys.add((pid, title))
            imported += 1

    # One bump after the whole file — avoids N websocket / client refetch storms.
    realtime.bump("tasks", "projects", "users")

    log_audit(
        db,
        actor_id,
        "tasks.csv_imported",
        "task",
        actor_id,
        filename or "tasks.csv",
        {
            "rows": len(rows),
            "imported": imported,
            "duplicates": duplicates,
            "skipped": len(skipped),
            "dateOrder": "DD/MM/YYYY" if day_first else "MM/DD/YYYY",
            "createdProjects": created_projects,
            "createdUsers": created_users,
            "membershipsAdded": len(members_added),
        },
    )

    return TasksImportReport(
        filename=filename or "tasks.csv",
        totalRows=len(rows),
        imported=imported,
        duplicates=duplicates,
        skippedCount=len(skipped),
        dateOrder="DD/MM/YYYY" if day_first else "MM/DD/YYYY",
        createdProjects=created_projects,
        createdUsers=created_users,
        membershipsAdded=len(members_added),
        skipped=skipped[:200],
    )
