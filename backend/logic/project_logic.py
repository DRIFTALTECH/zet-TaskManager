from datetime import date

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

import crud.projects as projects_crud
import crud.sections as sections_crud
import crud.tasks as tasks_crud
import crud.timesheet_entries as timesheet_entries_crud
from database.models import Project
from database.init_db import new_id
from logic.schemas import ProjectCreate, ProjectOut, SectionCreate, SectionOut

def _section_out(s) -> SectionOut:
    return SectionOut(id=s.id, name=s.name, projectId=s.project_id)


def to_project_out(db: Session, p: Project) -> ProjectOut:
    members = projects_crud.member_ids(db, p.id)
    secs = sections_crud.list_for_project(db, p.id)
    return ProjectOut(
        id=p.id,
        name=p.name,
        description=p.description,
        createdBy=p.created_by,
        members=members,
        sections=[_section_out(s) for s in secs],
        createdAt=p.created_at,
    )


def is_managerial(db: Session, user_id: str) -> bool:
    """True for manager and admin — both have full access to every project."""
    from logic import user_logic

    u = user_logic.get_user_or_404(db, user_id)
    return u.role in ("manager", "admin")


def ensure_project_member(db: Session, project_id: str, user_id: str) -> None:
    p = projects_crud.get_by_id(db, project_id)
    if not p:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found")
    # Admins can access any project; managers and employees must be members.
    if is_admin(db, user_id):
        return
    mids = projects_crud.member_ids(db, project_id)
    if user_id not in mids:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not a member of this project")


def ensure_manager(db: Session, user_id: str) -> None:
    if not is_managerial(db, user_id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Manager only")


def is_admin(db: Session, user_id: str) -> bool:
    from logic import user_logic

    return user_logic.get_user_or_404(db, user_id).role == "admin"


def list_projects(db: Session, current_user_id: str) -> list[ProjectOut]:
    # Only admins see every project; managers and employees see the projects
    # they have been added to (filtered in SQL by the CRUD layer).
    projects = (
        projects_crud.list_all(db)
        if is_admin(db, current_user_id)
        else projects_crud.list_for_member(db, current_user_id)
    )
    return [to_project_out(db, p) for p in projects]


def create_project(db: Session, current_user_id: str, body: ProjectCreate) -> ProjectOut:
    # Only managers and admins may create projects — employees cannot.
    ensure_manager(db, current_user_id)
    pid = new_id("p")
    today = date.today().isoformat()
    p = projects_crud.create_project(
        db,
        project_id=pid,
        name=body.name.strip(),
        description=body.description.strip(),
        created_by=current_user_id,
        created_at=today,
    )
    projects_crud.add_member(db, pid, current_user_id)
    return to_project_out(db, p)


def add_section(db: Session, current_user_id: str, project_id: str, body: SectionCreate) -> ProjectOut:
    ensure_project_member(db, project_id, current_user_id)
    p = projects_crud.get_by_id(db, project_id)
    if not p:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found")
    sid = new_id("s")
    sections_crud.create_section(db, section_id=sid, name=body.name.strip(), project_id=project_id)
    return to_project_out(db, p)


def delete_section(db: Session, user_id: str, project_id: str, section_id: str) -> ProjectOut:
    p = projects_crud.get_by_id(db, project_id)
    if not p:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found")
    ensure_manager(db, user_id)
    sec = sections_crud.get_by_id(db, section_id)
    if not sec or sec.project_id != project_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Section not found")
    n_tasks = tasks_crud.count_for_section(db, section_id)
    if n_tasks > 0:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"This section still has {n_tasks} task(s). Move or delete them first.",
        )
    n_te = timesheet_entries_crud.count_for_section(db, section_id)
    if n_te > 0:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "This section is still used on timesheet entries; it cannot be deleted.",
        )
    sections_crud.delete_section(db, section_id)
    return to_project_out(db, p)


def add_member(db: Session, manager_id: str, project_id: str, user_id: str) -> ProjectOut:
    ensure_manager(db, manager_id)
    p = projects_crud.get_by_id(db, project_id)
    if not p:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found")
    from logic import user_logic

    user_logic.get_user_or_404(db, user_id)
    projects_crud.add_member(db, project_id, user_id)
    return to_project_out(db, p)


def remove_member(db: Session, manager_id: str, project_id: str, user_id: str) -> ProjectOut:
    ensure_manager(db, manager_id)
    p = projects_crud.get_by_id(db, project_id)
    if not p:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found")
    projects_crud.remove_member(db, project_id, user_id)
    return to_project_out(db, p)
