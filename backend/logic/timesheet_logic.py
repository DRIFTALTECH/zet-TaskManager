import logging
import re
from datetime import datetime, timezone, date, timedelta

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

import crud.timesheet_entries as te_crud
import crud.sections as sections_crud
import crud.projects as projects_crud
import crud.users as users_crud
from ai import chains
from ai.schemas import ProjectRef, SectionRef, TimesheetParseResponse, UserRef
from database.init_db import new_id
from database.models import TimesheetEntry, User
from logic import project_logic, user_logic
from logic.schemas import MomMemberOut, SectionCreate, TimesheetEntryCreate, TimesheetEntryOut, TimesheetEntryPatch

log = logging.getLogger("zet.timesheet")

TIME_RE = re.compile(r"^\s*(\d{1,2}):(\d{2})\s*$")


def normalize_time_value(s: str) -> str:
    raw = (s or "").strip()
    if not raw:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Time is required")
    if re.fullmatch(r"\d{1,4}", raw):
        padded = raw.zfill(4)
        h, mm = int(padded[:2]), int(padded[2:])
    else:
        m = TIME_RE.match(raw)
        if not m:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "Use HH:MM or 4-digit 24h time (e.g. 0930 or 930)",
            )
        h, mm = int(m.group(1)), int(m.group(2))
    if h > 23 or mm < 0 or mm > 59:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid time")
    return f"{h:02d}:{mm:02d}"


def _hm_to_seconds(hm: str) -> int:
    h, mm = hm.split(":")
    return int(h) * 3600 + int(mm) * 60


def span_seconds(time_from: str, time_to: str) -> int:
    tf = normalize_time_value(time_from)
    tt = normalize_time_value(time_to)
    sf = _hm_to_seconds(tf)
    st = _hm_to_seconds(tt)
    if st > sf:
        return st - sf
    if st == sf:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "End time must be after start time")
    return 86400 - sf + st


def _reject_future_date(work_date: str) -> None:
    """No timesheet/work entry may be dated in the future — you can't log work that
    hasn't happened yet. Allow up to UTC-today + 1 day so a user whose local zone is
    ahead of UTC (e.g. IST) can still log *their* today near midnight.
    # ponytail: +1-day UTC tolerance, not true per-user tz. Pass the client's tz
    # offset through and compare in local time if a stricter bound is ever needed."""
    try:
        wd = date.fromisoformat(work_date)
    except ValueError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "workDate must be YYYY-MM-DD")
    if wd > date.today() + timedelta(days=1):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Cannot log time for a future date.")


def _validate_section_project(db: Session, project_id: str, section_id: str) -> None:
    sec = sections_crud.get_by_id(db, section_id)
    if not sec or sec.project_id != project_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Section does not belong to this project")


def to_out(e: TimesheetEntry) -> TimesheetEntryOut:
    return TimesheetEntryOut(
        id=e.id,
        userId=e.user_id,
        workDate=e.work_date,
        projectId=e.project_id,
        sectionId=e.section_id,
        description=e.description or "",
        timeFrom=e.time_from,
        timeTo=e.time_to,
        seconds=e.seconds,
        billable=e.billable,
        createdAt=e.created_at,
    )


def list_entries(db: Session, user_id: str, start: str, end: str) -> list[TimesheetEntryOut]:
    if start > end:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "start must be <= end")
    rows = te_crud.list_for_user_range(db, user_id, start, end)
    return [to_out(r) for r in rows]


def list_entries_as_manager(db: Session, manager_id: str, target_user_id: str, start: str, end: str) -> list[TimesheetEntryOut]:
    project_logic.ensure_manager(db, manager_id)
    user_logic.get_user_or_404(db, target_user_id)
    return list_entries(db, target_user_id, start, end)


def list_entries_team(db: Session, user_id: str, start: str, end: str) -> list[TimesheetEntryOut]:
    """Manager/admin team report: every member's rows in range. Admin sees all;
    a manager sees only rows on projects they belong to (same visibility as /projects)."""
    if start > end:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "start must be <= end")
    project_logic.ensure_manager(db, user_id)
    if project_logic.is_admin(db, user_id):
        rows = te_crud.list_for_range_all(db, start, end)
    else:
        pids = [p.id for p in projects_crud.list_for_member(db, user_id)]
        rows = te_crud.list_for_range_in_projects(db, pids, start, end)
    return [to_out(r) for r in rows]


def list_entries_for_project(db: Session, manager_id: str, project_id: str) -> list[TimesheetEntryOut]:
    """Manager-only: all timesheet rows logged against a project, across every member."""
    project_logic.ensure_manager(db, manager_id)
    if not projects_crud.get_by_id(db, project_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found")
    rows = te_crud.list_for_project(db, project_id)
    return [to_out(r) for r in rows]


def create_entry(db: Session, user_id: str, body: TimesheetEntryCreate) -> TimesheetEntryOut:
    _reject_future_date(body.workDate)
    project_logic.ensure_project_member(db, body.projectId, user_id)
    _validate_section_project(db, body.projectId, body.sectionId)
    tf = normalize_time_value(body.timeFrom)
    tt = normalize_time_value(body.timeTo)
    sec = span_seconds(tf, tt)
    now = datetime.now(timezone.utc).isoformat()
    row = TimesheetEntry(
        id=new_id("te"),
        user_id=user_id,
        work_date=body.workDate,
        project_id=body.projectId,
        section_id=body.sectionId,
        description=body.description or "",
        time_from=tf,
        time_to=tt,
        seconds=sec,
        billable=body.billable,
        created_at=now,
    )
    te_crud.create_entry(db, row)
    return to_out(row)


def patch_entry(db: Session, user_id: str, entry_id: str, body: TimesheetEntryPatch) -> TimesheetEntryOut:
    row = te_crud.get_by_id(db, entry_id)
    if not row or row.user_id != user_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Entry not found")
    if body.workDate is not None:
        _reject_future_date(body.workDate)
        row.work_date = body.workDate
    if body.projectId is not None:
        row.project_id = body.projectId
    if body.sectionId is not None:
        row.section_id = body.sectionId
    if body.description is not None:
        row.description = body.description
    if body.timeFrom is not None:
        row.time_from = normalize_time_value(body.timeFrom)
    if body.timeTo is not None:
        row.time_to = normalize_time_value(body.timeTo)
    if body.billable is not None:
        row.billable = body.billable
    project_logic.ensure_project_member(db, row.project_id, user_id)
    _validate_section_project(db, row.project_id, row.section_id)
    row.seconds = span_seconds(row.time_from, row.time_to)
    te_crud.update_entry(db, row)
    return to_out(row)


def delete_entry(db: Session, user_id: str, entry_id: str) -> None:
    row = te_crud.get_by_id(db, entry_id)
    if not row or row.user_id != user_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Entry not found")
    te_crud.delete_entry(db, row)


def delete_all_entries_for_day(db: Session, user_id: str, work_date: str) -> int:
    """Remove every timesheet row the user has on work_date (YYYY-MM-DD)."""
    if len(work_date) != 10 or work_date[4] != "-" or work_date[7] != "-":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "workDate must be YYYY-MM-DD")
    return te_crud.delete_all_for_user_date(db, user_id, work_date)


def _match_user_by_name(name: str, users: list[User]) -> User | None:
    """Match a parsed scrum member name to a user (exact, then first-name)."""
    n = name.strip().lower()
    if not n:
        return None
    for u in users:
        if u.name.lower() == n:
            return u
    first = n.split()[0]
    for u in users:
        if u.name.lower().split()[0] == first:
            return u
    return None


def _project_refs_for_user(db: Session, user_id: str) -> list[ProjectRef]:
    users_by_id = {
        u.id: UserRef(
            id=u.id,
            name=u.name,
            job_title=getattr(u, "job_title", "") or "",
            current_experience_months=getattr(u, "experience_months", 0) or 0,
        )
        for u in users_crud.list_all(db)
    }
    return [
        ProjectRef(
            id=p.id,
            name=p.name,
            sections=[SectionRef(id=s.id, name=s.name) for s in p.sections],
            members=[users_by_id[mid] for mid in projects_crud.member_ids(db, p.id) if mid in users_by_id],
        )
        for p in project_logic.list_projects(db, user_id)
    ]


def create_draft_entries_from_parse(
    db: Session, user_id: str, work_date: str, parsed: TimesheetParseResponse
) -> list[TimesheetEntryOut]:
    """Persist parse_timesheet rows as editable timesheet entries (no submit step)."""
    created: list[TimesheetEntryOut] = []
    for row in parsed.rows:
        if not row.project_id:
            continue
        section_id = row.section_id
        if (
            not section_id
            and row.suggest_create_section
            and row.suggested_section_name
        ):
            updated = project_logic.add_section(
                db,
                user_id,
                row.project_id,
                SectionCreate(name=row.suggested_section_name.strip()),
            )
            name_lower = row.suggested_section_name.strip().lower()
            section_id = next(
                (s.id for s in updated.sections if s.name.lower() == name_lower),
                None,
            )
        if not section_id:
            continue
        try:
            created.append(
                create_entry(
                    db,
                    user_id,
                    TimesheetEntryCreate(
                        workDate=work_date,
                        projectId=row.project_id,
                        sectionId=section_id,
                        description=row.description or "",
                        timeFrom=row.time_from,
                        timeTo=row.time_to,
                    ),
                )
            )
        except HTTPException:
            continue
    return created


def generate_timesheets_from_scrum_members(
    db: Session, work_date: str, members: list[MomMemberOut]
) -> None:
    """For each matched scrum member, parse their items into draft timesheet entries."""
    if not members:
        return
    all_users = users_crud.list_all(db)
    for member in members:
        log.info("scrum→timesheet member=%r", member.name)
        user = _match_user_by_name(member.name, all_users)
        if user is None:
            log.info("scrum→timesheet member=%r matched_user_id=none (skipped)", member.name)
            continue
        log.info("scrum→timesheet member=%r matched_user_id=%s", member.name, user.id)
        items = [i.strip() for i in member.items if i.strip()]
        if not items:
            log.info("scrum→timesheet member=%r user_id=%s no items (skipped)", member.name, user.id)
            continue
        summary = "\n".join(items)
        projects = _project_refs_for_user(db, user.id)
        try:
            parsed = chains.parse_timesheet(summary, work_date, projects)
            log.info(
                "scrum→timesheet member=%r user_id=%s parse_timesheet rows=%d %s",
                member.name,
                user.id,
                len(parsed.rows),
                [r.model_dump() for r in parsed.rows],
            )
        except Exception as e:
            log.info(
                "scrum→timesheet member=%r user_id=%s parse_timesheet error: %s",
                member.name,
                user.id,
                e,
                exc_info=True,
            )
            continue
        created = create_draft_entries_from_parse(db, user.id, work_date, parsed)
        log.info(
            "scrum→timesheet member=%r user_id=%s entries_created=%d entry_ids=%s",
            member.name,
            user.id,
            len(created),
            [e.id for e in created],
        )
