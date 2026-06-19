from fastapi import APIRouter, Depends, File, Form, UploadFile
from sqlalchemy.orm import Session

from database.database import get_db
from logic import project_logic
from logic.schemas import MemberBody, ProjectAppearancePatch, ProjectCreate, ProjectOut, SectionCreate
from routes.deps import get_current_user_id

router = APIRouter()


@router.get("", response_model=list[ProjectOut])
def list_projects(user_id: str = Depends(get_current_user_id), db: Session = Depends(get_db)):
    return project_logic.list_projects(db, user_id)


@router.post("", response_model=ProjectOut)
def create_project(
    body: ProjectCreate,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    return project_logic.create_project(db, user_id, body)


@router.patch("/{project_id}/appearance", response_model=ProjectOut)
def set_appearance(
    project_id: str,
    body: ProjectAppearancePatch,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    return project_logic.set_appearance(db, user_id, project_id, body)


@router.post("/{project_id}/media", response_model=ProjectOut)
async def upload_media(
    project_id: str,
    kind: str = Form(...),
    file: UploadFile = File(...),
    accent_color: str = Form(default=""),
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    content = await file.read()
    return project_logic.upload_media(
        db, user_id, project_id, kind, file.filename, file.content_type, content, accent_color
    )


@router.post("/{project_id}/sections", response_model=ProjectOut)
def add_section(
    project_id: str,
    body: SectionCreate,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    return project_logic.add_section(db, user_id, project_id, body)


@router.delete("/{project_id}/sections/{section_id}", response_model=ProjectOut)
def delete_section_route(
    project_id: str,
    section_id: str,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    return project_logic.delete_section(db, user_id, project_id, section_id)


@router.post("/{project_id}/members", response_model=ProjectOut)
def add_member(
    project_id: str,
    body: MemberBody,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    return project_logic.add_member(db, user_id, project_id, body.user_id)


@router.delete("/{project_id}/members/{member_user_id}", response_model=ProjectOut)
def remove_member(
    project_id: str,
    member_user_id: str,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    return project_logic.remove_member(db, user_id, project_id, member_user_id)
