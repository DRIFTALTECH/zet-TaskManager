"""File-attachment sub-resource: /tasks/{task_id}/attachments"""

import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from database.database import get_db
from database.models import Task, TaskAttachment, User
from logic.audit import log_audit
from logic.schemas import TaskAttachmentOut
from routes.deps import get_current_user_id

router = APIRouter()

ATTACHMENTS_DIR = Path(__file__).resolve().parent.parent / "data" / "attachments"
ATTACHMENTS_DIR.mkdir(parents=True, exist_ok=True)

MAX_FILE_SIZE = 20 * 1024 * 1024  # 20 MB


def _get_task_or_404(task_id: str, db: Session) -> Task:
    t = db.get(Task, task_id)
    if not t:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Task not found")
    return t


def _row_to_out(row: TaskAttachment, db: Session) -> TaskAttachmentOut:
    uploader = db.get(User, row.uploaded_by)
    return TaskAttachmentOut(
        id=row.id,
        taskId=row.task_id,
        filename=row.filename,
        contentType=row.content_type,
        sizeBytes=row.size_bytes,
        uploadedBy=row.uploaded_by,
        uploaderName=uploader.name if uploader else row.uploaded_by,
        createdAt=row.created_at,
    )


@router.get("", response_model=list[TaskAttachmentOut])
def list_attachments(
    task_id: str,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    _get_task_or_404(task_id, db)
    rows = (
        db.query(TaskAttachment)
        .filter(TaskAttachment.task_id == task_id)
        .order_by(TaskAttachment.created_at)
        .all()
    )
    return [_row_to_out(r, db) for r in rows]


@router.post("", response_model=TaskAttachmentOut, status_code=201)
async def upload_attachment(
    task_id: str,
    file: UploadFile = File(...),
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    task = _get_task_or_404(task_id, db)
    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "File exceeds 20 MB limit")

    ext = Path(file.filename or "file").suffix
    stored_name = f"{uuid.uuid4()}{ext}"
    (ATTACHMENTS_DIR / stored_name).write_bytes(content)

    row = TaskAttachment(
        id=str(uuid.uuid4()),
        task_id=task_id,
        filename=file.filename or stored_name,
        stored_name=stored_name,
        content_type=file.content_type or "application/octet-stream",
        size_bytes=len(content),
        uploaded_by=user_id,
        created_at=datetime.now(timezone.utc).isoformat(),
    )
    db.add(row)
    log_audit(db, user_id, "attachment.uploaded", "attachment", row.id, row.filename,
              {"taskId": task_id, "taskTitle": task.title, "sizeBytes": len(content)})
    db.commit()
    db.refresh(row)
    return _row_to_out(row, db)


@router.get("/{attachment_id}/download")
def download_attachment(
    task_id: str,
    attachment_id: str,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    _get_task_or_404(task_id, db)
    row = db.get(TaskAttachment, attachment_id)
    if not row or row.task_id != task_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Attachment not found")
    file_path = ATTACHMENTS_DIR / row.stored_name
    if not file_path.exists():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File not found on disk")
    return FileResponse(
        path=str(file_path),
        filename=row.filename,
        media_type=row.content_type,
    )


@router.delete("/{attachment_id}", status_code=204)
def delete_attachment(
    task_id: str,
    attachment_id: str,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    _get_task_or_404(task_id, db)
    row = db.get(TaskAttachment, attachment_id)
    if not row or row.task_id != task_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Attachment not found")
    # Only uploader or manager can delete
    caller = db.get(User, user_id)
    if row.uploaded_by != user_id and (not caller or caller.role != "manager"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed to delete this attachment")

    file_path = ATTACHMENTS_DIR / row.stored_name
    if file_path.exists():
        file_path.unlink()

    log_audit(db, user_id, "attachment.deleted", "attachment", row.id, row.filename,
              {"taskId": task_id})
    db.delete(row)
    db.commit()
    return Response(status_code=204)
