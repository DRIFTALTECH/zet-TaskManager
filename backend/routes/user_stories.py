from fastapi import APIRouter, Depends, File, Form, Response, UploadFile
from fastapi.responses import FileResponse

from database.database import Db, get_db
from logic import attachment_logic, user_story_logic
from logic.schemas import (
    TaskOut,
    UserStoryAttachmentOut,
    UserStoryConfirmGenerateBody,
    UserStoryCreate,
    UserStoryGeneratePreviewOut,
    UserStoryOut,
    UserStoryPatch,
)
from routes.deps import get_current_user_id
from offloop import offloop
from upload_guard import read_limited

router = APIRouter()


@router.get("/user-stories", response_model=list[UserStoryOut])
def list_visible_stories(
    user_id: str = Depends(get_current_user_id),
    db: Db = Depends(get_db),
):
    return user_story_logic.list_visible(db, user_id)


@router.get("/projects/{project_id}/user-stories", response_model=list[UserStoryOut])
def list_project_stories(
    project_id: str,
    user_id: str = Depends(get_current_user_id),
    db: Db = Depends(get_db),
):
    return user_story_logic.list_for_project(db, user_id, project_id)


@router.get("/sections/{section_id}/user-stories", response_model=list[UserStoryOut])
def list_section_stories(
    section_id: str,
    user_id: str = Depends(get_current_user_id),
    db: Db = Depends(get_db),
):
    return user_story_logic.list_for_section(db, user_id, section_id)


@router.post("/user-stories", response_model=UserStoryOut)
def create_user_story(
    body: UserStoryCreate,
    user_id: str = Depends(get_current_user_id),
    db: Db = Depends(get_db),
):
    return user_story_logic.create_story(db, user_id, body)


@router.get("/user-stories/{story_id}", response_model=UserStoryOut)
def get_user_story(
    story_id: str,
    user_id: str = Depends(get_current_user_id),
    db: Db = Depends(get_db),
):
    return user_story_logic.get_story(db, user_id, story_id)


@router.patch("/user-stories/{story_id}", response_model=UserStoryOut)
def patch_user_story(
    story_id: str,
    body: UserStoryPatch,
    user_id: str = Depends(get_current_user_id),
    db: Db = Depends(get_db),
):
    return user_story_logic.patch_story(db, user_id, story_id, body)


@router.post("/user-stories/{story_id}/approve", response_model=UserStoryOut)
def approve_user_story(
    story_id: str,
    user_id: str = Depends(get_current_user_id),
    db: Db = Depends(get_db),
):
    return user_story_logic.approve_story(db, user_id, story_id)


@router.delete("/user-stories/{story_id}")
def delete_user_story(
    story_id: str,
    user_id: str = Depends(get_current_user_id),
    db: Db = Depends(get_db),
):
    user_story_logic.delete_story(db, user_id, story_id)
    return {"ok": True}


@router.get("/user-stories/{story_id}/tasks", response_model=list[TaskOut])
def list_user_story_tasks(
    story_id: str,
    user_id: str = Depends(get_current_user_id),
    db: Db = Depends(get_db),
):
    return user_story_logic.list_story_tasks(db, user_id, story_id)


@router.post(
    "/user-stories/{story_id}/generate-tasks",
    response_model=UserStoryGeneratePreviewOut,
)
def generate_user_story_tasks(
    story_id: str,
    user_id: str = Depends(get_current_user_id),
    db: Db = Depends(get_db),
):
    """AI preview only — does not create tasks until confirm-generate-tasks."""
    return user_story_logic.preview_generate_tasks(db, user_id, story_id)


@router.post(
    "/user-stories/{story_id}/confirm-generate-tasks",
    response_model=list[TaskOut],
)
def confirm_generate_user_story_tasks(
    story_id: str,
    body: UserStoryConfirmGenerateBody,
    user_id: str = Depends(get_current_user_id),
    db: Db = Depends(get_db),
):
    return user_story_logic.confirm_generate_tasks(db, user_id, story_id, body)


# ── Attachments (reuse attachment_logic disk + size limits) ───────────────────


@router.get(
    "/user-stories/{story_id}/attachments",
    response_model=list[UserStoryAttachmentOut],
)
def list_story_attachments(
    story_id: str,
    user_id: str = Depends(get_current_user_id),
    db: Db = Depends(get_db),
):
    return attachment_logic.list_for_user_story(db, story_id, user_id)


@router.post(
    "/user-stories/{story_id}/attachments",
    response_model=UserStoryAttachmentOut,
    status_code=201,
)
async def upload_story_attachment(
    story_id: str,
    file: UploadFile = File(...),
    user_id: str = Depends(get_current_user_id),
    db: Db = Depends(get_db),
):
    content = await read_limited(file, attachment_logic.MAX_FILE_SIZE, label='Attachment')
    return await offloop(
        attachment_logic.upload_for_user_story,
        db, story_id, user_id, file.filename, file.content_type, content,
    )


@router.get("/user-stories/{story_id}/attachments/{attachment_id}/download")
def download_story_attachment(
    story_id: str,
    attachment_id: str,
    user_id: str = Depends(get_current_user_id),
    db: Db = Depends(get_db),
):
    file_path, filename, content_type = attachment_logic.resolve_story_for_download(
        db, story_id, attachment_id, user_id
    )
    return FileResponse(
        path=str(file_path),
        filename=filename,
        media_type=content_type,
        headers={"X-Content-Type-Options": "nosniff"},
    )


@router.delete("/user-stories/{story_id}/attachments/{attachment_id}", status_code=204)
def delete_story_attachment(
    story_id: str,
    attachment_id: str,
    user_id: str = Depends(get_current_user_id),
    db: Db = Depends(get_db),
):
    user_story_logic.get_story(db, user_id, story_id)
    attachment_logic.delete_for_user_story(db, story_id, attachment_id, user_id)
    return Response(status_code=204)
