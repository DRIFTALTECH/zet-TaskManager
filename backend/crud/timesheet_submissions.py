from database.models import TimesheetSubmission

from crud._base import Db, fetch_all, fetch_one, row_to_model, rows_to_models

_SELECT = """SELECT id, user_id, week_start, status, submitted_at, reviewer_id,
    reviewed_at, rejection_note, submitted_dates FROM timesheet_submissions"""

_STATUS_ORDER = """CASE status
    WHEN 'submitted' THEN 0
    WHEN 'rejected' THEN 1
    WHEN 'approved' THEN 2
    ELSE 3
END"""


def get_for_user_week(db: Db, user_id: str, week_start: str) -> TimesheetSubmission | None:
    return row_to_model(
        TimesheetSubmission,
        fetch_one(
            db,
            f"{_SELECT} WHERE user_id = %s AND week_start = %s",
            (user_id, week_start),
        ),
    )


def get_by_id(db: Db, submission_id: str) -> TimesheetSubmission | None:
    return row_to_model(
        TimesheetSubmission,
        fetch_one(db, f"{_SELECT} WHERE id = %s", (submission_id,)),
    )


def list_for_reviewer(
    db: Db,
    *,
    manager_id: str | None = None,
    status: str | None = None,
    user_id: str | None = None,
    week_start: str | None = None,
) -> list[TimesheetSubmission]:
    # ponytail: keyed on users.manager_id, not frozen reviewer_id — survives manager reassignment
    join_users = manager_id is not None
    pfx = "ts." if join_users else ""
    clauses: list[str] = []
    params: list = []

    if manager_id is not None:
        clauses.append("u.manager_id = %s")
        params.append(manager_id)
    if status is not None:
        clauses.append(f"{pfx}status = %s")
        params.append(status)
    if user_id is not None:
        clauses.append(f"{pfx}user_id = %s")
        params.append(user_id)
    if week_start is not None:
        clauses.append(f"{pfx}week_start = %s")
        params.append(week_start)

    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    if join_users:
        sql = f"""SELECT ts.id, ts.user_id, ts.week_start, ts.status, ts.submitted_at,
            ts.reviewer_id, ts.reviewed_at, ts.rejection_note, ts.submitted_dates
            FROM timesheet_submissions ts
            JOIN users u ON ts.user_id = u.id
            {where}
            ORDER BY CASE ts.status
                WHEN 'submitted' THEN 0 WHEN 'rejected' THEN 1
                WHEN 'approved' THEN 2 ELSE 3 END,
            ts.submitted_at DESC"""
    else:
        sql = f"""{_SELECT} {where}
            ORDER BY {_STATUS_ORDER}, submitted_at DESC"""

    rows = fetch_all(db, sql, tuple(params) if params else None)
    return rows_to_models(TimesheetSubmission, rows)


def list_pending_for_reviewer(db: Db, manager_id: str) -> list[TimesheetSubmission]:
    return list_for_reviewer(db, manager_id=manager_id, status="submitted")


def create(db: Db, row: TimesheetSubmission) -> TimesheetSubmission:
    db.write(
        """INSERT INTO timesheet_submissions
            (id, user_id, week_start, status, submitted_at, reviewer_id, reviewed_at, rejection_note, submitted_dates)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
        (
            row.id,
            row.user_id,
            row.week_start,
            row.status,
            row.submitted_at,
            row.reviewer_id,
            row.reviewed_at,
            row.rejection_note,
            row.submitted_dates or "[]",
        ),
    )
    return row


def update(db: Db, row: TimesheetSubmission) -> TimesheetSubmission:
    db.write(
        """UPDATE timesheet_submissions SET
            user_id = %s, week_start = %s, status = %s, submitted_at = %s,
            reviewer_id = %s, reviewed_at = %s, rejection_note = %s, submitted_dates = %s
            WHERE id = %s""",
        (
            row.user_id,
            row.week_start,
            row.status,
            row.submitted_at,
            row.reviewer_id,
            row.reviewed_at,
            row.rejection_note,
            row.submitted_dates or "[]",
            row.id,
        ),
    )
    return row
