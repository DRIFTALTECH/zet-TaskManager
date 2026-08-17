from database.models import TimesheetEntry

from crud._base import Db, fetch_all, fetch_one, row_to_model, rows_to_models

_SELECT = """SELECT id, user_id, work_date, project_id, section_id, description,
    time_from, time_to, seconds, billable, created_at FROM timesheet_entries"""


def list_for_user_range(db: Db, user_id: str, start_date: str, end_date: str) -> list[TimesheetEntry]:
    rows = fetch_all(
        db,
        f"""{_SELECT}
            WHERE user_id = %s AND work_date >= %s AND work_date <= %s
            ORDER BY work_date, created_at""",
        (user_id, start_date, end_date),
    )
    return rows_to_models(TimesheetEntry, rows)


def list_for_project(db: Db, project_id: str) -> list[TimesheetEntry]:
    """Every timesheet row logged against a project, across all users (manager view)."""
    rows = fetch_all(
        db,
        f"""{_SELECT}
            WHERE project_id = %s
            ORDER BY work_date, created_at""",
        (project_id,),
    )
    return rows_to_models(TimesheetEntry, rows)


def list_for_range_all(db: Db, start_date: str, end_date: str) -> list[TimesheetEntry]:
    """Every user's rows in a date range (admin team report)."""
    rows = fetch_all(
        db,
        f"""{_SELECT}
            WHERE work_date >= %s AND work_date <= %s
            ORDER BY work_date, created_at""",
        (start_date, end_date),
    )
    return rows_to_models(TimesheetEntry, rows)


def list_for_range_in_projects(
    db: Db, project_ids: list[str], start_date: str, end_date: str
) -> list[TimesheetEntry]:
    """Rows in a date range scoped to a set of projects (manager team report)."""
    if not project_ids:
        return []
    # Expanded placeholders rather than `= ANY(%s)`: the array form is Postgres-only
    # and fails under the SQLite dialect used by dev and the test suite, so the
    # manager team view could not be exercised outside production.
    placeholders = ", ".join(["%s"] * len(project_ids))
    rows = fetch_all(
        db,
        f"""{_SELECT}
            WHERE work_date >= %s AND work_date <= %s
              AND project_id IN ({placeholders})
            ORDER BY work_date, created_at""",
        (start_date, end_date, *project_ids),
    )
    return rows_to_models(TimesheetEntry, rows)


def get_by_id(db: Db, entry_id: str) -> TimesheetEntry | None:
    return row_to_model(
        TimesheetEntry,
        fetch_one(db, f"{_SELECT} WHERE id = %s", (entry_id,)),
    )


def exists_matching(
    db: Db, *, user_id: str, work_date: str, time_from: str, time_to: str, description: str
) -> bool:
    """True when this exact row is already logged. A Clockify export carries no id,
    so re-uploading the same file would otherwise double every entry."""
    row = fetch_one(
        db,
        """SELECT id FROM timesheet_entries
           WHERE user_id = %s AND work_date = %s AND time_from = %s AND time_to = %s
             AND description = %s
           LIMIT 1""",
        (user_id, work_date, time_from, time_to, description),
    )
    return row is not None


def create_entry(db: Db, row: TimesheetEntry) -> TimesheetEntry:
    db.write(
        """INSERT INTO timesheet_entries
            (id, user_id, work_date, project_id, section_id, description,
             time_from, time_to, seconds, billable, created_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
        (
            row.id,
            row.user_id,
            row.work_date,
            row.project_id,
            row.section_id,
            row.description,
            row.time_from,
            row.time_to,
            row.seconds,
            row.billable,
            row.created_at,
        ),
    )
    return row


def update_entry(db: Db, row: TimesheetEntry) -> TimesheetEntry:
    db.write(
        """UPDATE timesheet_entries SET
            user_id = %s, work_date = %s, project_id = %s, section_id = %s,
            description = %s, time_from = %s, time_to = %s, seconds = %s,
            billable = %s, created_at = %s
            WHERE id = %s""",
        (
            row.user_id,
            row.work_date,
            row.project_id,
            row.section_id,
            row.description,
            row.time_from,
            row.time_to,
            row.seconds,
            row.billable,
            row.created_at,
            row.id,
        ),
    )
    return row


def upsert_entry(db: Db, row: TimesheetEntry) -> str:
    """Insert or update by id. Returns 'imported', 'updated', or 'unchanged'."""
    existing = get_by_id(db, row.id)
    if existing is None:
        create_entry(db, row)
        return "imported"
    same = (
        existing.user_id == row.user_id
        and existing.work_date == row.work_date
        and existing.project_id == row.project_id
        and existing.section_id == row.section_id
        and existing.description == row.description
        and existing.time_from == row.time_from
        and existing.time_to == row.time_to
        and existing.seconds == row.seconds
        and existing.billable == row.billable
    )
    if same:
        return "unchanged"
    update_entry(db, row)
    return "updated"


def delete_entry(db: Db, row: TimesheetEntry) -> None:
    db.write("DELETE FROM timesheet_entries WHERE id = %s", (row.id,))


def delete_all_for_user_date(db: Db, user_id: str, work_date: str) -> int:
    result = db.write(
        "DELETE FROM timesheet_entries WHERE user_id = %s AND work_date = %s",
        (user_id, work_date),
    )
    return int(result.get("rowcount", 0))


def count_for_section(db: Db, section_id: str) -> int:
    row = fetch_one(
        db,
        "SELECT COUNT(*) AS cnt FROM timesheet_entries WHERE section_id = %s",
        (section_id,),
    )
    return int(row["cnt"]) if row else 0
