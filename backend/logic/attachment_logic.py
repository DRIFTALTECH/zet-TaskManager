"""Business logic for task file attachments: validation, file storage,
permissions, and audit — all DB access delegated to the CRUD layer.

User-story attachments reuse the same disk directory and size limits.
"""

import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import HTTPException, status

import crud.attachments as attachments_crud
import crud.tasks as tasks_crud
import crud.user_stories as stories_crud
import crud.users as users_crud
from database.models import TaskAttachment, UserStoryAttachment
from logic import project_logic
from logic.audit import log_audit
from logic.schemas import TaskAttachmentOut, UserStoryAttachmentOut

ATTACHMENTS_DIR = Path(__file__).resolve().parent.parent / "data" / "attachments"
ATTACHMENTS_DIR.mkdir(parents=True, exist_ok=True)

MAX_FILE_SIZE = 20 * 1024 * 1024  # 20 MB


def _ensure_task(db, task_id: str, user_id: str):
    """Task must exist AND the caller must belong to its project — attachments are
    project data, so existence alone is not authorization."""
    t = tasks_crud.get_by_id(db, task_id)
    if not t:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Task not found")
    project_logic.ensure_project_member(db, t.project_id, user_id)
    return t


def _ensure_story(db, story_id: str, user_id: str):
    s = stories_crud.get_by_id(db, story_id)
    if not s:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User story not found")
    project_logic.ensure_project_member(db, s.project_id, user_id)
    return s


def _store_bytes(filename: str | None, content: bytes) -> tuple[str, str]:
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "File exceeds 20 MB limit")
    ext = Path(filename or "file").suffix
    stored_name = f"{uuid.uuid4()}{ext}"
    (ATTACHMENTS_DIR / stored_name).write_bytes(content)
    return filename or stored_name, stored_name


def _to_out(db, row: TaskAttachment) -> TaskAttachmentOut:
    uploader = users_crud.get_by_id(db, row.uploaded_by)
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


def _to_story_out(db, row: UserStoryAttachment) -> UserStoryAttachmentOut:
    uploader = users_crud.get_by_id(db, row.uploaded_by)
    return UserStoryAttachmentOut(
        id=row.id,
        userStoryId=row.user_story_id,
        filename=row.filename,
        contentType=row.content_type,
        sizeBytes=row.size_bytes,
        uploadedBy=row.uploaded_by,
        uploaderName=uploader.name if uploader else row.uploaded_by,
        createdAt=row.created_at,
    )


def list_for_task(db, task_id: str, user_id: str) -> list[TaskAttachmentOut]:
    _ensure_task(db, task_id, user_id)
    return [_to_out(db, r) for r in attachments_crud.list_for_task(db, task_id)]


def upload(db, task_id: str, user_id: str, filename: str | None, content_type: str | None, content: bytes) -> TaskAttachmentOut:
    task = _ensure_task(db, task_id, user_id)
    display_name, stored_name = _store_bytes(filename, content)
    row = TaskAttachment(
        id=str(uuid.uuid4()),
        task_id=task_id,
        filename=display_name,
        stored_name=stored_name,
        content_type=content_type or "application/octet-stream",
        size_bytes=len(content),
        uploaded_by=user_id,
        created_at=datetime.now(timezone.utc).isoformat(),
    )
    attachments_crud.create(db, row)
    log_audit(db, user_id, "attachment.uploaded", "attachment", row.id, row.filename,
              {"taskId": task_id, "taskTitle": task.title, "sizeBytes": len(content)})
    return _to_out(db, row)


def resolve_for_download(db, task_id: str, attachment_id: str, user_id: str) -> tuple[Path, str, str]:
    """Returns (file_path, filename, content_type) for a downloadable attachment."""
    _ensure_task(db, task_id, user_id)
    row = attachments_crud.get_by_id(db, attachment_id)
    if not row or row.task_id != task_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Attachment not found")
    file_path = ATTACHMENTS_DIR / row.stored_name
    if not file_path.exists():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File not found on disk")
    return file_path, row.filename, row.content_type


def delete(db, task_id: str, attachment_id: str, user_id: str) -> None:
    _ensure_task(db, task_id, user_id)
    row = attachments_crud.get_by_id(db, attachment_id)
    if not row or row.task_id != task_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Attachment not found")
    caller = users_crud.get_by_id(db, user_id)
    if row.uploaded_by != user_id and (not caller or caller.role not in ("manager", "superadmin")):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed to delete this attachment")
    file_path = ATTACHMENTS_DIR / row.stored_name
    if file_path.exists():
        file_path.unlink()
    log_audit(db, user_id, "attachment.deleted", "attachment", row.id, row.filename, {"taskId": task_id})
    attachments_crud.delete(db, row)


# ── User story attachments ────────────────────────────────────────────────────


def list_for_user_story(db, story_id: str, user_id: str) -> list[UserStoryAttachmentOut]:
    _ensure_story(db, story_id, user_id)
    return [_to_story_out(db, r) for r in attachments_crud.list_for_user_story(db, story_id)]


def upload_for_user_story(
    db, story_id: str, user_id: str, filename: str | None, content_type: str | None, content: bytes
) -> UserStoryAttachmentOut:
    story = _ensure_story(db, story_id, user_id)
    display_name, stored_name = _store_bytes(filename, content)
    row = UserStoryAttachment(
        id=str(uuid.uuid4()),
        user_story_id=story_id,
        filename=display_name,
        stored_name=stored_name,
        content_type=content_type or "application/octet-stream",
        size_bytes=len(content),
        uploaded_by=user_id,
        created_at=datetime.now(timezone.utc).isoformat(),
    )
    attachments_crud.create_for_user_story(db, row)
    log_audit(
        db,
        user_id,
        "attachment.uploaded",
        "attachment",
        row.id,
        row.filename,
        {"userStoryId": story_id, "storyTitle": story.title, "sizeBytes": len(content)},
    )
    return _to_story_out(db, row)


def resolve_story_for_download(db, story_id: str, attachment_id: str, user_id: str) -> tuple[Path, str, str]:
    _ensure_story(db, story_id, user_id)
    row = attachments_crud.get_story_by_id(db, attachment_id)
    if not row or row.user_story_id != story_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Attachment not found")
    file_path = ATTACHMENTS_DIR / row.stored_name
    if not file_path.exists():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File not found on disk")
    return file_path, row.filename, row.content_type


def delete_for_user_story(db, story_id: str, attachment_id: str, user_id: str) -> None:
    _ensure_story(db, story_id, user_id)
    row = attachments_crud.get_story_by_id(db, attachment_id)
    if not row or row.user_story_id != story_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Attachment not found")
    caller = users_crud.get_by_id(db, user_id)
    if row.uploaded_by != user_id and (not caller or caller.role not in ("manager", "superadmin")):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed to delete this attachment")
    file_path = ATTACHMENTS_DIR / row.stored_name
    if file_path.exists():
        file_path.unlink()
    log_audit(
        db,
        user_id,
        "attachment.deleted",
        "attachment",
        row.id,
        row.filename,
        {"userStoryId": story_id},
    )
    attachments_crud.delete_story_attachment(db, row)
