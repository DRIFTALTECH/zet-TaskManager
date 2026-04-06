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

PERSONAL_PROJECT_NAME = "Personal"
PERSONAL_PROJECT_DESCRIPTION = "Your private workspace. Only you can see tasks here."
DEFAULT_PERSONAL_SECTION = "General"


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
        isPersonal=bool(p.is_personal),
    )


def ensure_personal_project(db: Session, user_id: str) -> None:
    existing = (
        db.query(Project)
        .filter(Project.is_personal.is_(True), Project.created_by == user_id)
        .first()
    )
    if existing:
        return
    today = date.today().isoformat()
    pid = new_id("pp")
    projects_crud.create_project(
        db,
        project_id=pid,
        name=PERSONAL_PROJECT_NAME,
        description=PERSONAL_PROJECT_DESCRIPTION,
        created_by=user_id,
        created_at=today,
        is_personal=True,
    )
    projects_crud.add_member(db, pid, user_id)
    sid = new_id("s")
    sections_crud.create_section(db, section_id=sid, name=DEFAULT_PERSONAL_SECTION, project_id=pid)


def ensure_project_member(db: Session, project_id: str, user_id: str) -> None:
    p = projects_crud.get_by_id(db, project_id)
    if not p:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found")
    if p.is_personal and p.created_by != user_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not a member of this project")
    mids = projects_crud.member_ids(db, project_id)
    if user_id not in mids:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not a member of this project")


def ensure_manager(db: Session, user_id: str) -> None:
    from logic import user_logic

    u = user_logic.get_user_or_404(db, user_id)
    if u.role != "manager":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Manager only")


def list_projects(db: Session, current_user_id: str) -> list[ProjectOut]:
    ensure_personal_project(db, current_user_id)
    all_p = projects_crud.list_all(db)
    visible = []
    for p in all_p:
        if p.is_personal and p.created_by != current_user_id:
            continue
        if current_user_id not in projects_crud.member_ids(db, p.id):
            continue
        visible.append(p)
    visible.sort(key=lambda x: (not x.is_personal, (x.name or "").lower()))
    return [to_project_out(db, p) for p in visible]


def create_project(db: Session, current_user_id: str, body: ProjectCreate) -> ProjectOut:
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
    if p.is_personal:
        if p.created_by != user_id:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "Only the owner can modify sections in this personal project",
            )
    else:
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
    if p.is_personal:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Members cannot be added to a Personal workspace",
        )
    from logic import user_logic

    user_logic.get_user_or_404(db, user_id)
    projects_crud.add_member(db, project_id, user_id)
    return to_project_out(db, p)


def remove_member(db: Session, manager_id: str, project_id: str, user_id: str) -> ProjectOut:
    ensure_manager(db, manager_id)
    p = projects_crud.get_by_id(db, project_id)
    if not p:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found")
    if p.is_personal:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Members cannot be removed from a Personal workspace",
        )
    projects_crud.remove_member(db, project_id, user_id)
    return to_project_out(db, p)
