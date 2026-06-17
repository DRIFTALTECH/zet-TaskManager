import json

from sqlalchemy.orm import Session

import realtime
from database.models import Task


def get_by_id(db: Session, task_id: str) -> Task | None:
    return db.query(Task).get(task_id)


def list_all(db: Session) -> list[Task]:
    return db.query(Task).all()


def list_for_member_projects(db: Session, user_id: str) -> list[Task]:
    """Tasks in any project the user is a member of — filtered in SQL via a join."""
    from database.models import ProjectMember

    return (
        db.query(Task)
        .join(ProjectMember, ProjectMember.project_id == Task.project_id)
        .filter(ProjectMember.user_id == user_id)
        .all()
    )


def list_for_project(db: Session, project_id: str) -> list[Task]:
    return db.query(Task).filter(Task.project_id == project_id).all()


def count_for_section(db: Session, section_id: str) -> int:
    return db.query(Task).filter(Task.section_id == section_id).count()


def create_task(
    db: Session,
    *,
    task_id: str,
    title: str,
    description: str,
    project_id: str,
    section_id: str,
    assigned_to: str,
    assigned_by: str,
    created_by: str,
    due_date: str,
    priority: str,
    status: str,
    is_started: bool,
    approved_by_manager: bool,
    time_tracked: int,
    tags: list[str],
    created_at: str,
    time_log: dict[str, int] | None = None,
    custom_fields: dict[str, str] | None = None,
) -> Task:
    t = Task(
        id=task_id,
        title=title,
        description=description,
        project_id=project_id,
        section_id=section_id,
        assigned_to=assigned_to,
        assigned_by=assigned_by,
        created_by=created_by,
        due_date=due_date,
        priority=priority,
        status=status,
        is_started=is_started,
        started_at=None,
        completed_at=None,
        approved_by_manager=approved_by_manager,
        time_tracked=time_tracked,
        tags_json=json.dumps(tags),
        custom_fields_json=json.dumps(custom_fields or {}),
        created_at=created_at,
    )
    db.add(t)
    db.commit()
    db.refresh(t)
    realtime.bump("tasks")
    return t


def update_task(db: Session, task: Task) -> Task:
    db.add(task)
    db.commit()
    db.refresh(task)
    realtime.bump("tasks")
    return task


def delete_task(db: Session, task_id: str) -> None:
    db.query(Task).filter(Task.id == task_id).delete()
    db.commit()
    realtime.bump("tasks")


def reassign_status(db: Session, from_status: str, to_status: str) -> None:
    """Bulk-move every task in one status/column to another (e.g. on column delete)."""
    db.query(Task).filter(Task.status == from_status).update({"status": to_status})
    db.commit()
    realtime.bump("tasks")
