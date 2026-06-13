from sqlalchemy.orm import Session

from database.models import TimesheetEntry


def list_for_user_range(db: Session, user_id: str, start_date: str, end_date: str) -> list[TimesheetEntry]:
    return (
        db.query(TimesheetEntry)
        .filter(
            TimesheetEntry.user_id == user_id,
            TimesheetEntry.work_date >= start_date,
            TimesheetEntry.work_date <= end_date,
        )
        .order_by(TimesheetEntry.work_date, TimesheetEntry.created_at)
        .all()
    )


def list_for_project(db: Session, project_id: str) -> list[TimesheetEntry]:
    """Every timesheet row logged against a project, across all users (manager view)."""
    return (
        db.query(TimesheetEntry)
        .filter(TimesheetEntry.project_id == project_id)
        .order_by(TimesheetEntry.work_date, TimesheetEntry.created_at)
        .all()
    )


def get_by_id(db: Session, entry_id: str) -> TimesheetEntry | None:
    return db.query(TimesheetEntry).filter(TimesheetEntry.id == entry_id).first()


def create_entry(db: Session, row: TimesheetEntry) -> TimesheetEntry:
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def update_entry(db: Session, row: TimesheetEntry) -> TimesheetEntry:
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def delete_entry(db: Session, row: TimesheetEntry) -> None:
    db.delete(row)
    db.commit()


def delete_all_for_user_date(db: Session, user_id: str, work_date: str) -> int:
    n = (
        db.query(TimesheetEntry)
        .filter(TimesheetEntry.user_id == user_id, TimesheetEntry.work_date == work_date)
        .delete(synchronize_session=False)
    )
    db.commit()
    return n


def count_for_section(db: Session, section_id: str) -> int:
    return db.query(TimesheetEntry).filter(TimesheetEntry.section_id == section_id).count()
