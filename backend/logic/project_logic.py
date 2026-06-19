import uuid
from datetime import date
from pathlib import Path

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

import crud.projects as projects_crud
import crud.sections as sections_crud
import crud.tasks as tasks_crud
import crud.timesheet_entries as timesheet_entries_crud
from database.models import Project
from database.init_db import new_id
from logic.schemas import ProjectAppearancePatch, ProjectCreate, ProjectOut, SectionCreate, SectionOut

# Project background / photo files live on disk and are served statically at
# /project-media — keeps the (frequently fetched) /projects payload tiny.
PROJECT_MEDIA_DIR = Path(__file__).resolve().parent.parent / "data" / "project_media"
PROJECT_MEDIA_DIR.mkdir(parents=True, exist_ok=True)
MEDIA_URL_PREFIX = "/project-media/"
MAX_MEDIA_BYTES = 6 * 1024 * 1024  # 6 MB


def _unlink_if_local(value: str | None) -> None:
    """Delete a stored media file when its DB reference is replaced/cleared."""
    if value and value.startswith(MEDIA_URL_PREFIX):
        try:
            (PROJECT_MEDIA_DIR / value[len(MEDIA_URL_PREFIX):]).unlink(missing_ok=True)
        except Exception:
            pass

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
        backgroundImage=p.background_image or "",
        accentColor=p.accent_color or "",
        projectImage=p.project_image or "",
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


def set_appearance(db: Session, user_id: str, project_id: str, body: ProjectAppearancePatch) -> ProjectOut:
    """Managers/admins set a project's background image + accent palette colour."""
    p = projects_crud.get_by_id(db, project_id)
    if not p:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found")
    ensure_manager(db, user_id)
    ensure_project_member(db, project_id, user_id)
    old_bg, old_proj = (p.background_image or ""), (p.project_image or "")
    bg = body.backgroundImage if body.backgroundImage is not None else old_bg
    accent = body.accentColor if body.accentColor is not None else (p.accent_color or "")
    proj_img = body.projectImage if body.projectImage is not None else old_proj
    bg, accent, proj_img = bg.strip(), accent.strip(), proj_img.strip()
    # Clean up any replaced/removed locally-stored files.
    if bg != old_bg:
        _unlink_if_local(old_bg)
    if proj_img != old_proj:
        _unlink_if_local(old_proj)
    projects_crud.update_appearance(db, project_id, bg, accent, proj_img)
    return to_project_out(db, projects_crud.get_by_id(db, project_id))


def upload_media(
    db: Session, user_id: str, project_id: str, kind: str,
    filename: str | None, content_type: str | None, content: bytes, accent_color: str = "",
) -> ProjectOut:
    """Save an uploaded background/project image to disk; store only its served URL."""
    p = projects_crud.get_by_id(db, project_id)
    if not p:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found")
    ensure_manager(db, user_id)
    ensure_project_member(db, project_id, user_id)
    if kind not in ("background", "project"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "kind must be 'background' or 'project'")
    if not content_type or not content_type.startswith("image/"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "File must be an image")
    if len(content) > MAX_MEDIA_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Image exceeds 6 MB limit")

    ext = Path(filename or "img").suffix.lower() or ".jpg"
    if ext not in (".jpg", ".jpeg", ".png", ".webp", ".gif"):
        ext = ".jpg"
    stored = f"{uuid.uuid4().hex}{ext}"
    (PROJECT_MEDIA_DIR / stored).write_bytes(content)
    url = f"{MEDIA_URL_PREFIX}{stored}"

    bg, accent, proj_img = (p.background_image or ""), (p.accent_color or ""), (p.project_image or "")
    if kind == "background":
        _unlink_if_local(bg)
        bg, accent = url, (accent_color or "").strip()
    else:
        _unlink_if_local(proj_img)
        proj_img = url
    projects_crud.update_appearance(db, project_id, bg, accent, proj_img)
    return to_project_out(db, projects_crud.get_by_id(db, project_id))


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
