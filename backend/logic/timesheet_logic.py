import json
import logging
import re
from datetime import datetime, timezone, date, timedelta

from fastapi import HTTPException, status
from database.database import Db

import crud.timesheet_entries as te_crud
import crud.timesheet_submissions as ts_crud
import crud.sections as sections_crud
import crud.projects as projects_crud
import crud.users as users_crud
from ai import chains
from ai.schemas import ProjectRef, SectionRef, TimesheetParseResponse, UserRef
from database.init_db import new_id
from database.models import TimesheetEntry, TimesheetSubmission, User
from logic import notification_logic, project_logic, user_logic
from logic.audit import log_audit
from logic.schemas import (
    MomMemberOut,
    SectionCreate,
    TimesheetEntryCreate,
    TimesheetEntryOut,
    TimesheetEntryPatch,
    TimesheetRejectBody,
    TimesheetReviewDayOut,
    TimesheetReviewEntryOut,
    TimesheetSubmissionOut,
    TimesheetSubmissionReviewOut,
)

log = logging.getLogger("zet.timesheet")

TIME_RE = re.compile(r"^\s*(\d{1,2}):(\d{2})\s*$")
LOCKED_STATUSES = frozenset({"submitted"})
REVIEWED_STATUSES = frozenset({"approved", "rejected"})


def _dates_in_week(week_start: str) -> list[str]:
    monday = date.fromisoformat(week_start)
    return [(monday + timedelta(days=i)).isoformat() for i in range(7)]


def _parse_submitted_dates(sub: TimesheetSubmission | None) -> list[str]:
    if sub is None:
        return []
    raw = getattr(sub, "submitted_dates", None) or "[]"
    try:
        parsed = json.loads(raw)
    except (TypeError, json.JSONDecodeError):
        return []
    if not isinstance(parsed, list):
        return []
    return sorted({str(d) for d in parsed if d})


def _encode_submitted_dates(dates: list[str]) -> str:
    return json.dumps(sorted(set(dates)))


def _is_date_locked(sub: TimesheetSubmission | None, work_date: str) -> bool:
    if sub is None or sub.status not in LOCKED_STATUSES:
        return False
    return work_date in _parse_submitted_dates(sub)


def _normalize_submit_dates(week_start: str, dates: list[str] | None) -> list[str]:
    allowed = set(_dates_in_week(week_start))
    if not dates:
        return sorted(allowed)
    out: list[str] = []
    seen: set[str] = set()
    for d in dates:
        try:
            date.fromisoformat(d)
        except ValueError:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Invalid date: {d}")
        if d not in allowed:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"Date {d} is not in week starting {week_start}",
            )
        if d in seen:
            continue
        seen.add(d)
        out.append(d)
    if not out:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "At least one date is required")
    return sorted(out)


def week_start_for(work_date: str) -> str:
    """Monday ISO date for the week containing work_date."""
    d = date.fromisoformat(work_date)
    return (d - timedelta(days=d.weekday())).isoformat()


def week_end_for(week_start: str) -> str:
    monday = date.fromisoformat(week_start)
    return (monday + timedelta(days=6)).isoformat()


def _parse_week_start(week_start: str) -> str:
    try:
        d = date.fromisoformat(week_start)
    except ValueError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "weekStart must be YYYY-MM-DD")
    if d.weekday() != 0:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "weekStart must be a Monday")
    return week_start


def _snap_to_week_start(value: str) -> str:
    """Any date -> the Monday of its ISO week. Used for range filters, where the
    caller picks arbitrary days rather than week boundaries."""
    try:
        return week_start_for(value)
    except Exception:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "week_from / week_to must be dates in YYYY-MM-DD form"
        )


def _ensure_date_editable(db: Db, user_id: str, work_date: str) -> None:
    ws = week_start_for(work_date)
    sub = ts_crud.get_for_user_week(db, user_id, ws)
    if _is_date_locked(sub, work_date):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Timesheet for {work_date} is locked ({sub.status if sub else 'submitted'})",
        )


def _resolve_assigned_manager(db: Db, employee: User) -> str:
    manager_id = getattr(employee, "manager_id", None)
    if not manager_id:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "No manager assigned. Ask an admin to set your manager.",
        )
    manager = users_crud.get_by_id(db, manager_id)
    if not manager or not bool(getattr(manager, "is_active", True)):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Assigned manager not found or inactive")
    if manager.role not in ("manager", "superadmin"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Assigned manager must have manager or admin role")
    return manager_id


def _can_view_submission(db: Db, actor_id: str, sub: TimesheetSubmission) -> None:
    if sub.user_id == actor_id:
        return
    project_logic.ensure_manager(db, actor_id)


def _can_review_submission(db: Db, actor_id: str, sub: TimesheetSubmission) -> None:
    project_logic.ensure_manager(db, actor_id)


def submission_to_out(db: Db, sub: TimesheetSubmission | None, *, user_id: str, week_start: str) -> TimesheetSubmissionOut:
    week_end = week_end_for(week_start)
    if sub is None:
        user = users_crud.get_by_id(db, user_id)
        return TimesheetSubmissionOut(
            id=None,
            userId=user_id,
            userName=user.name if user else None,
            weekStart=week_start,
            weekEnd=week_end,
            status="draft",
            submittedDates=[],
        )
    names = users_crud.names_for_ids(db, [sub.user_id, sub.reviewer_id] if sub.reviewer_id else [sub.user_id])
    return TimesheetSubmissionOut(
        id=sub.id,
        userId=sub.user_id,
        userName=names.get(sub.user_id),
        weekStart=sub.week_start,
        weekEnd=week_end_for(sub.week_start),
        status=sub.status,  # type: ignore[arg-type]
        submittedAt=sub.submitted_at,
        submittedDates=_parse_submitted_dates(sub),
        reviewerId=sub.reviewer_id,
        reviewerName=names.get(sub.reviewer_id) if sub.reviewer_id else None,
        reviewedAt=sub.reviewed_at,
        rejectionNote=sub.rejection_note or None,
    )


def get_week_status(db: Db, user_id: str, week_start: str) -> TimesheetSubmissionOut:
    ws = _parse_week_start(week_start)
    sub = ts_crud.get_for_user_week(db, user_id, ws)
    return submission_to_out(db, sub, user_id=user_id, week_start=ws)


def list_pending_approvals(db: Db, manager_id: str) -> list[TimesheetSubmissionOut]:
    project_logic.ensure_manager(db, manager_id)
    rows = ts_crud.list_pending_for_reviewer(db, manager_id)
    return [submission_to_out(db, r, user_id=r.user_id, week_start=r.week_start) for r in rows]


def list_manager_submissions(
    db: Db,
    actor_id: str,
    *,
    submission_status: str | None = None,
    user_id: str | None = None,
    week_start: str | None = None,
    week_from: str | None = None,
    week_to: str | None = None,
) -> list[TimesheetSubmissionOut]:
    if submission_status is not None and submission_status not in ("submitted", "approved", "rejected"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "status must be submitted, approved, or rejected")
    ws = _parse_week_start(week_start) if week_start is not None else None
    # A range selects whole weeks. The bounds come from a free date picker, so they
    # are SNAPPED to their ISO Monday rather than required to be one — a Wed-to-Fri
    # custom range must still return that week's submission, not a 400.
    wf = _snap_to_week_start(week_from) if week_from else None
    wt = _snap_to_week_start(week_to) if week_to else None
    if wf and wt and wf > wt:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "week_from must be on or before week_to")
    actor = user_logic.get_user_or_404(db, actor_id)
    if actor.role == "employee":
        if user_id is not None and user_id != actor_id:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Not authorized to view other users' submissions")
        rows = ts_crud.list_for_reviewer(
            db, user_id=actor_id, status=submission_status, week_start=ws,
            week_from=wf, week_to=wt,
        )
    else:
        project_logic.ensure_manager(db, actor_id)
        rows = ts_crud.list_for_reviewer(
            db, status=submission_status, user_id=user_id, week_start=ws,
            week_from=wf, week_to=wt,
        )
    return [submission_to_out(db, r, user_id=r.user_id, week_start=r.week_start) for r in rows]


def _project_section_names(db: Db, rows: list[TimesheetEntry]) -> tuple[dict[str, str], dict[str, str]]:
    pn: dict[str, str] = {}
    sn: dict[str, str] = {}
    for r in rows:
        if r.project_id not in pn:
            p = projects_crud.get_by_id(db, r.project_id)
            pn[r.project_id] = p.name if p else ""
        if r.section_id not in sn:
            s = sections_crud.get_by_id(db, r.section_id)
            sn[r.section_id] = s.name if s else ""
    return pn, sn


def get_submission_review(db: Db, actor_id: str, submission_id: str) -> TimesheetSubmissionReviewOut:
    sub = ts_crud.get_by_id(db, submission_id)
    if not sub:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Submission not found")
    _can_view_submission(db, actor_id, sub)
    week_end = week_end_for(sub.week_start)
    rows = te_crud.list_for_user_range(db, sub.user_id, sub.week_start, week_end)
    pn, sn = _project_section_names(db, rows)
    by_date: dict[str, list[TimesheetEntry]] = {}
    for r in rows:
        by_date.setdefault(r.work_date, []).append(r)
    review_dates = _parse_submitted_dates(sub)
    if not review_dates:
        review_dates = _dates_in_week(sub.week_start)
    days: list[TimesheetReviewDayOut] = []
    weekly_total = 0
    for wd in review_dates:
        day_rows = by_date.get(wd, [])
        entries = [
            TimesheetReviewEntryOut(
                id=r.id,
                workDate=r.work_date,
                projectId=r.project_id,
                projectName=pn.get(r.project_id, ""),
                sectionId=r.section_id,
                sectionName=sn.get(r.section_id, ""),
                description=r.description or "",
                timeFrom=r.time_from,
                timeTo=r.time_to,
                seconds=r.seconds,
                billable=r.billable,
            )
            for r in day_rows
        ]
        day_total = sum(e.seconds for e in entries)
        weekly_total += day_total
        days.append(TimesheetReviewDayOut(workDate=wd, entries=entries, totalSeconds=day_total))
    return TimesheetSubmissionReviewOut(
        submission=submission_to_out(db, sub, user_id=sub.user_id, week_start=sub.week_start),
        days=days,
        totalSeconds=weekly_total,
    )


def submit_week(
    db: Db, user_id: str, week_start: str, dates: list[str] | None = None,
) -> TimesheetSubmissionOut:
    ws = _parse_week_start(week_start)
    target_dates = _normalize_submit_dates(ws, dates)
    existing = ts_crud.get_for_user_week(db, user_id, ws)
    locked_dates = _parse_submitted_dates(existing) if existing else []
    locked_set = set(locked_dates)

    if existing and existing.status in LOCKED_STATUSES:
        dupes = [d for d in target_dates if d in locked_set]
        if dupes:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"Already submitted: {', '.join(dupes)}",
            )
        new_dates = [d for d in target_dates if d not in locked_set]
        if not new_dates:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "No new dates to submit")
    else:
        new_dates = target_dates

    employee = user_logic.get_user_or_404(db, user_id)
    reviewer_id = _resolve_assigned_manager(db, employee)
    now = datetime.now(timezone.utc).isoformat()
    week_label = f"{ws} — {week_end_for(ws)}"

    if existing and existing.status in REVIEWED_STATUSES:
        existing.status = "submitted"
        existing.submitted_at = now
        existing.reviewer_id = reviewer_id
        existing.reviewed_at = None
        existing.rejection_note = ""
        existing.submitted_dates = _encode_submitted_dates(new_dates)
        sub = ts_crud.update(db, existing)
    elif existing and existing.status in LOCKED_STATUSES:
        merged = sorted(locked_set | set(new_dates))
        existing.status = "submitted"
        existing.submitted_at = now
        existing.reviewer_id = reviewer_id
        existing.reviewed_at = None
        existing.rejection_note = ""
        existing.submitted_dates = _encode_submitted_dates(merged)
        sub = ts_crud.update(db, existing)
    else:
        sub = ts_crud.create(
            db,
            TimesheetSubmission(
                id=new_id("ts"),
                user_id=user_id,
                week_start=ws,
                status="submitted",
                submitted_at=now,
                reviewer_id=reviewer_id,
                reviewed_at=None,
                rejection_note="",
                submitted_dates=_encode_submitted_dates(new_dates),
            ),
        )

    log_audit(
        db, user_id, "timesheet.submitted", "timesheet_submission", sub.id,
        week_label, {"weekStart": ws, "reviewerId": reviewer_id, "dates": new_dates},
    )
    notification_logic.notify_users(
        db,
        user_ids=[reviewer_id],
        type="timesheet_submitted",
        title="Timesheet submitted",
        message=f'{employee.name} submitted their timesheet for {week_label}',
        entity_type="timesheet_submission",
        entity_id=sub.id,
        triggered_by=user_id,
    )
    return submission_to_out(db, sub, user_id=user_id, week_start=ws)


def _finalize_review_transition(
    db: Db,
    actor_id: str,
    sub: TimesheetSubmission,
    *,
    audit_action: str,
    audit_extra: dict,
    notify_type: str,
    notify_title: str,
    notify_message: str,
) -> TimesheetSubmissionOut:
    week_label = f"{sub.week_start} — {week_end_for(sub.week_start)}"
    log_audit(db, actor_id, audit_action, "timesheet_submission", sub.id, week_label, audit_extra)
    notification_logic.notify_users(
        db,
        user_ids=[sub.user_id],
        type=notify_type,
        title=notify_title,
        message=notify_message,
        entity_type="timesheet_submission",
        entity_id=sub.id,
        triggered_by=actor_id,
    )
    return submission_to_out(db, sub, user_id=sub.user_id, week_start=sub.week_start)


def approve_submission(db: Db, actor_id: str, submission_id: str) -> TimesheetSubmissionOut:
    sub = ts_crud.get_by_id(db, submission_id)
    if not sub:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Submission not found")
    _can_review_submission(db, actor_id, sub)
    if sub.status != "submitted":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Cannot approve a timesheet that is {sub.status}")
    from_status = sub.status
    now = datetime.now(timezone.utc).isoformat()
    sub.status = "approved"
    sub.reviewer_id = actor_id
    sub.reviewed_at = now
    sub = ts_crud.update(db, sub)
    week_label = f"{sub.week_start} — {week_end_for(sub.week_start)}"
    actor_name = users_crud.names_for_ids(db, [actor_id]).get(actor_id, "Manager")
    return _finalize_review_transition(
        db, actor_id, sub,
        audit_action="timesheet.approved",
        audit_extra={"employeeId": sub.user_id, "weekStart": sub.week_start, "fromStatus": from_status},
        notify_type="timesheet_approved",
        notify_title="Timesheet approved",
        notify_message=f'{actor_name} approved your timesheet for {week_label}',
    )


def reject_submission(
    db: Db, actor_id: str, submission_id: str, body: TimesheetRejectBody,
) -> TimesheetSubmissionOut:
    sub = ts_crud.get_by_id(db, submission_id)
    if not sub:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Submission not found")
    _can_review_submission(db, actor_id, sub)
    if sub.status not in ("submitted", "approved"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Cannot reject a timesheet that is {sub.status}")
    from_status = sub.status
    now = datetime.now(timezone.utc).isoformat()
    sub.status = "rejected"
    sub.reviewer_id = actor_id
    sub.reviewed_at = now
    sub.rejection_note = (body.comment or "").strip()
    sub = ts_crud.update(db, sub)
    week_label = f"{sub.week_start} — {week_end_for(sub.week_start)}"
    actor_name = users_crud.names_for_ids(db, [actor_id]).get(actor_id, "Manager")
    msg = f'{actor_name} rejected your timesheet for {week_label}'
    if sub.rejection_note:
        msg = f"{msg}: {sub.rejection_note}"
    return _finalize_review_transition(
        db, actor_id, sub,
        audit_action="timesheet.rejected",
        audit_extra={
            "employeeId": sub.user_id,
            "weekStart": sub.week_start,
            "fromStatus": from_status,
            "comment": sub.rejection_note,
        },
        notify_type="timesheet_rejected",
        notify_title="Timesheet rejected",
        notify_message=msg,
    )


def reopen_submission(db: Db, actor_id: str, submission_id: str) -> TimesheetSubmissionOut:
    sub = ts_crud.get_by_id(db, submission_id)
    if not sub:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Submission not found")
    _can_review_submission(db, actor_id, sub)
    if sub.status not in ("approved", "rejected"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Cannot reopen a timesheet that is {sub.status}")
    from_status = sub.status
    employee = users_crud.get_by_id(db, sub.user_id)
    sub.status = "submitted"
    sub.reviewer_id = _resolve_assigned_manager(db, employee) if employee else None
    sub.reviewed_at = None
    sub.rejection_note = ""
    sub = ts_crud.update(db, sub)
    week_label = f"{sub.week_start} — {week_end_for(sub.week_start)}"
    actor_name = users_crud.names_for_ids(db, [actor_id]).get(actor_id, "Manager")
    return _finalize_review_transition(
        db, actor_id, sub,
        audit_action="timesheet.reopened",
        audit_extra={
            "fromStatus": from_status,
            "toStatus": "submitted",
            "reviewerId": actor_id,
            "weekStart": sub.week_start,
        },
        notify_type="timesheet_reopened",
        notify_title="Timesheet reopened for review",
        notify_message=f'{actor_name} reopened your timesheet for {week_label}',
    )


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


def _validate_section_project(db: Db, project_id: str, section_id: str) -> None:
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
        taskId=getattr(e, "task_id", None),
        description=e.description or "",
        timeFrom=e.time_from,
        timeTo=e.time_to,
        seconds=e.seconds,
        billable=e.billable,
        createdAt=e.created_at,
    )


# Widest range a single request may read. Generous enough for "this year" while
# stopping a hand-edited query string from pulling the whole table in one go.
MAX_RANGE_DAYS = 400


def validate_range(start: str, end: str) -> tuple[date, date]:
    """Parse and bound a requested date range. Raises 400 on anything unusable."""
    try:
        s_date = date.fromisoformat((start or "").strip())
        e_date = date.fromisoformat((end or "").strip())
    except ValueError:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "start and end must be dates in YYYY-MM-DD form"
        )
    if s_date > e_date:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "start must be on or before end")
    span = (e_date - s_date).days + 1
    if span > MAX_RANGE_DAYS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"That range covers {span} days; the maximum is {MAX_RANGE_DAYS}. "
            "Pick a shorter period.",
        )
    return s_date, e_date


def list_entries(db: Db, user_id: str, start: str, end: str) -> list[TimesheetEntryOut]:
    validate_range(start, end)
    rows = te_crud.list_for_user_range(db, user_id, start, end)
    return [to_out(r) for r in rows]


def list_entries_as_manager(db: Db, manager_id: str, target_user_id: str, start: str, end: str) -> list[TimesheetEntryOut]:
    project_logic.ensure_manager(db, manager_id)
    user_logic.get_user_or_404(db, target_user_id)
    return list_entries(db, target_user_id, start, end)


def list_entries_team(db: Db, user_id: str, start: str, end: str) -> list[TimesheetEntryOut]:
    """Manager/admin team report: every member's rows in range. Admin sees all;
    a manager sees only rows on projects they belong to (same visibility as /projects)."""
    validate_range(start, end)
    project_logic.ensure_manager(db, user_id)
    if project_logic.is_admin(db, user_id):
        rows = te_crud.list_for_range_all(db, start, end)
    else:
        pids = [p.id for p in projects_crud.list_for_member(db, user_id)]
        rows = te_crud.list_for_range_in_projects(db, pids, start, end)
    return [to_out(r) for r in rows]


def list_entries_for_project(db: Db, manager_id: str, project_id: str) -> list[TimesheetEntryOut]:
    """Manager-only: all timesheet rows logged against a project, across every member."""
    project_logic.ensure_manager(db, manager_id)
    if not projects_crud.get_by_id(db, project_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found")
    rows = te_crud.list_for_project(db, project_id)
    return [to_out(r) for r in rows]


def create_entry(
    db: Db,
    user_id: str,
    body: TimesheetEntryCreate,
    *,
    from_scrum: bool = False,
) -> TimesheetEntryOut:
    _reject_future_date(body.workDate)
    if not from_scrum:
        _ensure_date_editable(db, user_id, body.workDate)
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
        task_id=body.taskId,
        description=body.description or "",
        time_from=tf,
        time_to=tt,
        seconds=sec,
        billable=body.billable,
        created_at=now,
    )
    te_crud.create_entry(db, row)
    return to_out(row)


def _next_free_slot(db: Db, user_id: str, work_date: str, seconds: int) -> tuple[str, str]:
    """Where a task's hours sit on the day.

    Closing a task reports a duration, not a clock range, but a timesheet row needs
    both. The block is appended after whatever the user already logged that day —
    starting at 09:00 on an empty day — so a day of closed tasks reads as a
    sequence rather than a pile of overlapping 09:00 rows.
    """
    day_start = 9 * 3600
    used_until = day_start
    for e in te_crud.list_for_user_day(db, user_id, work_date):
        end = _hm_to_seconds(e.time_to)
        # A row crossing midnight ends the next day; it cannot push today's cursor.
        if _hm_to_seconds(e.time_from) <= end:
            used_until = max(used_until, end)
    # Never spill past the day: a long entry is pulled back so it still ends by 23:59.
    start = min(used_until, max(0, 86_340 - seconds))
    end = min(86_340, start + seconds)
    return f"{start // 3600:02d}:{start % 3600 // 60:02d}", f"{end // 3600:02d}:{end % 3600 // 60:02d}"


def record_task_time(
    db: Db, user_id: str, task, seconds: int, work_date: str
) -> TimesheetEntryOut | None:
    """Put a task's actual time on the user's timesheet, replacing any earlier row
    for the same task.

    Called when a task is closed with hours and minutes. Replacing rather than
    appending is what keeps the two numbers equal: a task that was timed already
    has a row, and the hours entered at Done are the correction to it.

    Deliberately skips `_ensure_date_editable`: a submitted week must not block
    someone from finishing a task. It returns None instead of raising when the
    row cannot be written, and the task's own time log stays the source of truth.
    """
    te_crud.delete_for_task(db, user_id, task.id)
    if seconds <= 0:
        return None
    if not task.section_id:
        return None
    try:
        _reject_future_date(work_date)
        project_logic.ensure_project_member(db, task.project_id, user_id)
        _validate_section_project(db, task.project_id, task.section_id)
        time_from, time_to = _next_free_slot(db, user_id, work_date, seconds)
        row = TimesheetEntry(
            id=new_id("te"),
            user_id=user_id,
            work_date=work_date,
            project_id=task.project_id,
            section_id=task.section_id,
            task_id=task.id,
            description=task.title,
            time_from=time_from,
            time_to=time_to,
            seconds=seconds,
            billable=True,
            created_at=datetime.now(timezone.utc).isoformat(),
        )
        te_crud.create_entry(db, row)
        return to_out(row)
    except HTTPException:
        return None


def patch_entry(db: Db, user_id: str, entry_id: str, body: TimesheetEntryPatch) -> TimesheetEntryOut:
    row = te_crud.get_by_id(db, entry_id)
    if not row or row.user_id != user_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Entry not found")
    _ensure_date_editable(db, user_id, row.work_date)
    if body.workDate is not None:
        _reject_future_date(body.workDate)
        _ensure_date_editable(db, user_id, body.workDate)
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


def delete_entry(db: Db, user_id: str, entry_id: str) -> None:
    row = te_crud.get_by_id(db, entry_id)
    if not row or row.user_id != user_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Entry not found")
    _ensure_date_editable(db, user_id, row.work_date)
    te_crud.delete_entry(db, row)


def delete_all_entries_for_day(db: Db, user_id: str, work_date: str) -> int:
    """Remove every timesheet row the user has on work_date (YYYY-MM-DD)."""
    if len(work_date) != 10 or work_date[4] != "-" or work_date[7] != "-":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "workDate must be YYYY-MM-DD")
    _ensure_date_editable(db, user_id, work_date)
    return te_crud.delete_all_for_user_date(db, user_id, work_date)


def _active_users(db: Db) -> list[User]:
    """Registered app users only — excludes invented transcript names."""
    return [u for u in users_crud.list_all(db) if getattr(u, "is_active", True)]


def _match_user_by_name(name: str, users: list[User]) -> User | None:
    """Match a parsed scrum member name to a registered user (exact, then unique first-name)."""
    n = name.strip().lower()
    if not n:
        return None
    for u in users:
        if u.name.strip().lower() == n:
            return u
    first = n.split()[0]
    for u in users:
        un = u.name.strip().lower()
        if un == first or n.startswith(un + " "):
            return u
    by_first = [u for u in users if u.name.strip().lower().split()[0] == first]
    if len(by_first) == 1:
        return by_first[0]
    return None


def filter_scrum_members(members: list[MomMemberOut], users: list[User]) -> list[MomMemberOut]:
    """Keep only members that map to a real user; use canonical account names."""
    out: list[MomMemberOut] = []
    seen_ids: set[str] = set()
    for member in members:
        user = _match_user_by_name(member.name, users)
        if user is None or user.id in seen_ids:
            if user is None and member.name.strip():
                log.info("scrum member %r ignored (no matching app user)", member.name)
            continue
        seen_ids.add(user.id)
        items = [i.strip() for i in member.items if i.strip()]
        if items:
            out.append(MomMemberOut(name=user.name, items=items))
    return out


def _project_refs_for_user(
    db: Db, user_id: str, *, all_users: list[User] | None = None
) -> list[ProjectRef]:
    users_by_id = {
        u.id: UserRef(
            id=u.id,
            name=u.name,
            job_title=getattr(u, "job_title", "") or "",
            current_experience_months=getattr(u, "experience_months", 0) or 0,
        )
        for u in (all_users if all_users is not None else users_crud.list_all(db))
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


def _project_refs_light(db: Db, user_id: str) -> list[ProjectRef]:
    """Project/section list for AI parsing — skips per-project member lookups (faster)."""
    return [
        ProjectRef(
            id=p.id,
            name=p.name,
            sections=[SectionRef(id=s.id, name=s.name) for s in p.sections],
            members=[],
        )
        for p in project_logic.list_projects(db, user_id)
    ]


def _default_project_section(db: Db, user_id: str) -> tuple[str, str] | None:
    """First project + section the user belongs to (fallback when AI returns nothing)."""
    for p in project_logic.list_projects(db, user_id):
        if p.sections:
            return p.id, p.sections[0].id
    return None


def _scrum_entry_exists(
    db: Db,
    user_id: str,
    work_date: str,
    project_id: str,
    section_id: str,
    time_from: str,
    time_to: str,
    *,
    existing: list[TimesheetEntry] | None = None,
) -> bool:
    """True when an identical row already exists (avoid duplicate scrum auto-entries)."""
    tf = normalize_time_value(time_from)
    tt = normalize_time_value(time_to)
    rows = existing if existing is not None else te_crud.list_for_user_range(db, user_id, work_date, work_date)
    for row in rows:
        if (
            row.project_id == project_id
            and row.section_id == section_id
            and row.time_from == tf
            and row.time_to == tt
        ):
            return True
    return False


def _insert_scrum_entry(
    db: Db,
    user_id: str,
    work_date: str,
    project_id: str,
    section_id: str,
    description: str,
    time_from: str,
    time_to: str,
    *,
    existing: list[TimesheetEntry] | None = None,
) -> TimesheetEntryOut | None:
    if _scrum_entry_exists(
        db, user_id, work_date, project_id, section_id, time_from, time_to, existing=existing
    ):
        return None
    try:
        return create_entry(
            db,
            user_id,
            TimesheetEntryCreate(
                workDate=work_date,
                projectId=project_id,
                sectionId=section_id,
                description=description,
                timeFrom=time_from,
                timeTo=time_to,
            ),
            from_scrum=True,
        )
    except HTTPException as exc:
        log.warning(
            "scrum→timesheet user_id=%s create_entry rejected: %s (project=%s section=%s)",
            user_id,
            exc.detail,
            project_id,
            section_id,
        )
        return None


def _fallback_scrum_entries(
    db: Db,
    user_id: str,
    work_date: str,
    items: list[str],
    *,
    existing: list[TimesheetEntry] | None = None,
) -> list[TimesheetEntryOut]:
    """Direct rows from scrum bullets when AI timesheet parse yields nothing."""
    target = _default_project_section(db, user_id)
    if not target:
        log.warning("scrum→timesheet user_id=%s fallback skipped (no project/section)", user_id)
        return []
    project_id, section_id = target
    n = len(items)
    start_min = 9 * 60
    end_min = 17 * 60
    slot = max(30, (end_min - start_min) // n)

    created: list[TimesheetEntryOut] = []
    for i, desc in enumerate(items):
        tf_min = start_min + i * slot
        tt_min = min(end_min, tf_min + slot)
        tf = f"{tf_min // 60:02d}:{tf_min % 60:02d}"
        tt = f"{tt_min // 60:02d}:{tt_min % 60:02d}"
        row = _insert_scrum_entry(
            db,
            user_id,
            work_date,
            project_id,
            section_id,
            desc,
            tf,
            tt,
            existing=existing,
        )
        if row:
            created.append(row)
    return created


def create_draft_entries_from_parse(
    db: Db,
    user_id: str,
    work_date: str,
    parsed: TimesheetParseResponse,
    *,
    from_scrum: bool = False,
    existing: list[TimesheetEntry] | None = None,
) -> list[TimesheetEntryOut]:
    """Persist parse_timesheet rows as editable timesheet entries (no submit step)."""
    created: list[TimesheetEntryOut] = []
    for row in parsed.rows:
        if not row.project_id:
            if from_scrum:
                log.warning(
                    "scrum→timesheet user_id=%s skipped row (no project_id): %r",
                    user_id,
                    row.description,
                )
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
            if from_scrum:
                log.warning(
                    "scrum→timesheet user_id=%s skipped row (no section_id): project=%s %r",
                    user_id,
                    row.project_id,
                    row.description,
                )
            continue
        if from_scrum:
            row_out = _insert_scrum_entry(
                db,
                user_id,
                work_date,
                row.project_id,
                section_id,
                row.description or "",
                row.time_from,
                row.time_to,
                existing=existing,
            )
            if row_out:
                created.append(row_out)
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
    db: Db, work_date: str, members: list[MomMemberOut]
) -> None:
    """For each matched scrum member, parse their items into draft timesheet entries."""
    if not members:
        return
    app_users = _active_users(db)
    matched = filter_scrum_members(members, app_users)
    if not matched:
        log.warning("scrum→timesheet no members matched registered users")
        return

    for member in matched:
        user = _match_user_by_name(member.name, app_users)
        if user is None:
            continue
        items = member.items
        existing = te_crud.list_for_user_range(db, user.id, work_date, work_date)
        projects = _project_refs_light(db, user.id)
        created: list[TimesheetEntryOut] = []

        if projects:
            summary = "\n".join(items)
            try:
                parsed = chains.parse_timesheet(summary, work_date, projects)
                created = create_draft_entries_from_parse(
                    db, user.id, work_date, parsed, from_scrum=True, existing=existing
                )
            except Exception as e:
                log.warning(
                    "scrum→timesheet user_id=%s parse_timesheet failed: %s",
                    user.id,
                    e,
                    exc_info=True,
                )

        if not created:
            created = _fallback_scrum_entries(
                db, user.id, work_date, items, existing=existing
            )
            if created:
                log.info(
                    "scrum→timesheet user_id=%s fallback entries_created=%d",
                    user.id,
                    len(created),
                )

        log.info(
            "scrum→timesheet user=%r user_id=%s entries_created=%d",
            member.name,
            user.id,
            len(created),
        )
