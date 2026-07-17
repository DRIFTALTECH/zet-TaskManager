from database.models import TaskAttachment, UserStoryAttachment

from crud._base import Db, fetch_all, fetch_one, row_to_model, rows_to_models

_SELECT = """SELECT id, task_id, filename, stored_name, content_type, size_bytes,
    uploaded_by, created_at FROM task_attachments"""

_STORY_SELECT = """SELECT id, user_story_id, filename, stored_name, content_type, size_bytes,
    uploaded_by, created_at FROM user_story_attachments"""


def get_by_id(db: Db, attachment_id: str) -> TaskAttachment | None:
    return row_to_model(
        TaskAttachment,
        fetch_one(db, f"{_SELECT} WHERE id = %s", (attachment_id,)),
    )


def list_for_task(db: Db, task_id: str) -> list[TaskAttachment]:
    rows = fetch_all(
        db,
        f"{_SELECT} WHERE task_id = %s ORDER BY created_at",
        (task_id,),
    )
    return rows_to_models(TaskAttachment, rows)


def create(db: Db, attachment: TaskAttachment) -> TaskAttachment:
    db.write(
        """INSERT INTO task_attachments
            (id, task_id, filename, stored_name, content_type, size_bytes, uploaded_by, created_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
        (
            attachment.id,
            attachment.task_id,
            attachment.filename,
            attachment.stored_name,
            attachment.content_type,
            attachment.size_bytes,
            attachment.uploaded_by,
            attachment.created_at,
        ),
    )
    return attachment


def delete(db: Db, attachment: TaskAttachment) -> None:
    db.write("DELETE FROM task_attachments WHERE id = %s", (attachment.id,))


# ── User story attachments (same disk layout; separate table) ─────────────────


def get_story_by_id(db: Db, attachment_id: str) -> UserStoryAttachment | None:
    return row_to_model(
        UserStoryAttachment,
        fetch_one(db, f"{_STORY_SELECT} WHERE id = %s", (attachment_id,)),
    )


def list_for_user_story(db: Db, user_story_id: str) -> list[UserStoryAttachment]:
    rows = fetch_all(
        db,
        f"{_STORY_SELECT} WHERE user_story_id = %s ORDER BY created_at",
        (user_story_id,),
    )
    return rows_to_models(UserStoryAttachment, rows)


def create_for_user_story(db: Db, attachment: UserStoryAttachment) -> UserStoryAttachment:
    db.write(
        """INSERT INTO user_story_attachments
            (id, user_story_id, filename, stored_name, content_type, size_bytes, uploaded_by, created_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
        (
            attachment.id,
            attachment.user_story_id,
            attachment.filename,
            attachment.stored_name,
            attachment.content_type,
            attachment.size_bytes,
            attachment.uploaded_by,
            attachment.created_at,
        ),
    )
    return attachment


def delete_story_attachment(db: Db, attachment: UserStoryAttachment) -> None:
    db.write("DELETE FROM user_story_attachments WHERE id = %s", (attachment.id,))
