from fastapi import APIRouter, Depends, File, UploadFile, Response

from database.database import Db, get_db
from logic import clockify_import_logic, timesheet_logic
from logic.schemas import (
    ClockifyImportReport,
    TimesheetEntryCreate,
    TimesheetEntryOut,
    TimesheetEntryPatch,
    TimesheetRejectBody,
    TimesheetSubmissionOut,
    TimesheetSubmissionReviewOut,
    TimesheetSubmitBody,
)
from routes.deps import get_current_user_id, require_superadmin
from offloop import offloop
from upload_guard import read_limited

router = APIRouter()


@router.get("/submissions/status", response_model=TimesheetSubmissionOut)
def get_submission_status(
    week_start: str,
    user_id: str = Depends(get_current_user_id),
    db: Db = Depends(get_db),
):
    return timesheet_logic.get_week_status(db, user_id, week_start)


@router.get("/submissions", response_model=list[TimesheetSubmissionOut])
def list_manager_submissions(
    status: str | None = None,
    user_id: str | None = None,
    week_start: str | None = None,
    week_from: str | None = None,
    week_to: str | None = None,
    actor_id: str = Depends(get_current_user_id),
    db: Db = Depends(get_db),
):
    return timesheet_logic.list_manager_submissions(
        db, actor_id, submission_status=status, user_id=user_id, week_start=week_start,
        week_from=week_from, week_to=week_to,
    )


@router.get("/submissions/pending", response_model=list[TimesheetSubmissionOut])
def list_pending_submissions(
    user_id: str = Depends(get_current_user_id),
    db: Db = Depends(get_db),
):
    return timesheet_logic.list_pending_approvals(db, user_id)


@router.get("/submissions/{submission_id}/review", response_model=TimesheetSubmissionReviewOut)
def get_submission_review(
    submission_id: str,
    user_id: str = Depends(get_current_user_id),
    db: Db = Depends(get_db),
):
    return timesheet_logic.get_submission_review(db, user_id, submission_id)


@router.post("/submissions/{week_start}/submit", response_model=TimesheetSubmissionOut)
def submit_timesheet_week(
    week_start: str,
    body: TimesheetSubmitBody | None = None,
    user_id: str = Depends(get_current_user_id),
    db: Db = Depends(get_db),
):
    dates = None if body is None else body.dates
    return timesheet_logic.submit_week(db, user_id, week_start, dates)


@router.post("/submissions/{submission_id}/approve", response_model=TimesheetSubmissionOut)
def approve_timesheet_submission(
    submission_id: str,
    user_id: str = Depends(get_current_user_id),
    db: Db = Depends(get_db),
):
    return timesheet_logic.approve_submission(db, user_id, submission_id)


@router.post("/submissions/{submission_id}/reject", response_model=TimesheetSubmissionOut)
def reject_timesheet_submission(
    submission_id: str,
    body: TimesheetRejectBody,
    user_id: str = Depends(get_current_user_id),
    db: Db = Depends(get_db),
):
    return timesheet_logic.reject_submission(db, user_id, submission_id, body)


@router.post("/submissions/{submission_id}/reopen", response_model=TimesheetSubmissionOut)
def reopen_timesheet_submission(
    submission_id: str,
    user_id: str = Depends(get_current_user_id),
    db: Db = Depends(get_db),
):
    return timesheet_logic.reopen_submission(db, user_id, submission_id)


@router.get("/users/{target_user_id}/entries", response_model=list[TimesheetEntryOut])
def list_user_entries_as_manager(
    target_user_id: str,
    start: str,
    end: str,
    user_id: str = Depends(get_current_user_id),
    db: Db = Depends(get_db),
):
    return timesheet_logic.list_entries_as_manager(db, user_id, target_user_id, start, end)


@router.get("/projects/{project_id}/entries", response_model=list[TimesheetEntryOut])
def list_project_entries_as_manager(
    project_id: str,
    user_id: str = Depends(get_current_user_id),
    db: Db = Depends(get_db),
):
    return timesheet_logic.list_entries_for_project(db, user_id, project_id)


@router.get("/entries", response_model=list[TimesheetEntryOut])
def list_entries(
    start: str,
    end: str,
    user_id: str = Depends(get_current_user_id),
    db: Db = Depends(get_db),
):
    return timesheet_logic.list_entries(db, user_id, start, end)


@router.get("/entries/all", response_model=list[TimesheetEntryOut])
def list_team_entries(
    start: str,
    end: str,
    user_id: str = Depends(get_current_user_id),
    db: Db = Depends(get_db),
):
    """Manager/admin team report — all members' rows in range (visibility-scoped)."""
    return timesheet_logic.list_entries_team(db, user_id, start, end)


@router.post("/entries", response_model=TimesheetEntryOut)
def create_entry(
    body: TimesheetEntryCreate,
    user_id: str = Depends(get_current_user_id),
    db: Db = Depends(get_db),
):
    return timesheet_logic.create_entry(db, user_id, body)


@router.patch("/entries/{entry_id}", response_model=TimesheetEntryOut)
def patch_entry(
    entry_id: str,
    body: TimesheetEntryPatch,
    user_id: str = Depends(get_current_user_id),
    db: Db = Depends(get_db),
):
    return timesheet_logic.patch_entry(db, user_id, entry_id, body)


@router.delete("/entries/{entry_id}", status_code=204)
def delete_entry(
    entry_id: str,
    user_id: str = Depends(get_current_user_id),
    db: Db = Depends(get_db),
):
    timesheet_logic.delete_entry(db, user_id, entry_id)
    return Response(status_code=204)


@router.delete("/day-entries/{work_date}", status_code=204)
def delete_entries_for_day(
    work_date: str,
    user_id: str = Depends(get_current_user_id),
    db: Db = Depends(get_db),
):
    timesheet_logic.delete_all_entries_for_day(db, user_id, work_date)
    return Response(status_code=204)


@router.post("/import/clockify", response_model=ClockifyImportReport)
async def import_clockify_csv(
    file: UploadFile = File(...),
    actor_id: str = Depends(require_superadmin),
    db: Db = Depends(get_db),
):
    """Import a Clockify Detailed report CSV into timesheet entries.

    Superadmin only: each row is logged against the user named by its Email column,
    so this writes to other people's timesheets.
    """
    content = await read_limited(file, clockify_import_logic.MAX_CSV_BYTES, label="CSV")
    return await offloop(
        clockify_import_logic.import_detailed_csv, db, actor_id, file.filename, content,
    )
