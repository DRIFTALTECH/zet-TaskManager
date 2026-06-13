from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from database.database import get_db
from logic import timesheet_logic
from logic.schemas import TimesheetEntryCreate, TimesheetEntryOut, TimesheetEntryPatch
from routes.deps import get_current_user_id

router = APIRouter()


@router.get("/users/{target_user_id}/entries", response_model=list[TimesheetEntryOut])
def list_user_entries_as_manager(
    target_user_id: str,
    start: str,
    end: str,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    return timesheet_logic.list_entries_as_manager(db, user_id, target_user_id, start, end)


@router.get("/projects/{project_id}/entries", response_model=list[TimesheetEntryOut])
def list_project_entries_as_manager(
    project_id: str,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    return timesheet_logic.list_entries_for_project(db, user_id, project_id)


@router.get("/entries", response_model=list[TimesheetEntryOut])
def list_entries(
    start: str,
    end: str,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    return timesheet_logic.list_entries(db, user_id, start, end)


@router.post("/entries", response_model=TimesheetEntryOut)
def create_entry(
    body: TimesheetEntryCreate,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    return timesheet_logic.create_entry(db, user_id, body)


@router.patch("/entries/{entry_id}", response_model=TimesheetEntryOut)
def patch_entry(
    entry_id: str,
    body: TimesheetEntryPatch,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    return timesheet_logic.patch_entry(db, user_id, entry_id, body)


@router.delete("/entries/{entry_id}", status_code=204)
def delete_entry(
    entry_id: str,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    timesheet_logic.delete_entry(db, user_id, entry_id)
    return Response(status_code=204)


@router.delete("/day-entries/{work_date}", status_code=204)
def delete_entries_for_day(
    work_date: str,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    timesheet_logic.delete_all_entries_for_day(db, user_id, work_date)
    return Response(status_code=204)
