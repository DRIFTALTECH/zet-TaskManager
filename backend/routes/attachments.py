"""File-attachment sub-resource: /tasks/{task_id}/attachments — thin endpoints."""

from fastapi import APIRouter, Depends, File, Response, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from database.database import get_db
from logic import attachment_logic
from logic.schemas import TaskAttachmentOut
from routes.deps import get_current_user_id

router = APIRouter()


@router.get("", response_model=list[TaskAttachmentOut])
def list_attachments(
    task_id: str,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    return attachment_logic.list_for_task(db, task_id)


@router.post("", response_model=TaskAttachmentOut, status_code=201)
async def upload_attachment(
    task_id: str,
    file: UploadFile = File(...),
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    content = await file.read()
    return attachment_logic.upload(db, task_id, user_id, file.filename, file.content_type, content)


@router.get("/{attachment_id}/download")
def download_attachment(
    task_id: str,
    attachment_id: str,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    file_path, filename, content_type = attachment_logic.resolve_for_download(db, task_id, attachment_id)
    return FileResponse(path=str(file_path), filename=filename, media_type=content_type)


@router.delete("/{attachment_id}", status_code=204)
def delete_attachment(
    task_id: str,
    attachment_id: str,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    attachment_logic.delete(db, task_id, attachment_id, user_id)
    return Response(status_code=204)
