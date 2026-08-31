"""PRD import chain: analyze → stage in temp_tasks → edit → commit to real stories/tasks."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import HTTPException, status

from crud import temp_tasks as temp_crud
from database.database import Db
from database.init_db import new_id
from database.models import TempTask
from logic import project_logic
from logic.prd_extract_logic import extract_prd
from logic.schemas import (
    GeneratedTaskPreview,
    PrdCommitOut,
    PrdDraftOut,
    PrdDraftStoryOut,
    PrdDraftTaskOut,
    TempTaskCreateBody,
    TempTaskPatch,
    UserStoryConfirmGenerateBody,
    UserStoryCreate,
)
from logic import user_story_logic

_KIND_STORY = "user_story"
_KIND_TASK = "task"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _gate(db: Db, user_id: str) -> None:
    project_logic.ensure_manager(db, user_id)


def _to_draft(rows: list[TempTask]) -> PrdDraftOut:
    if not rows:
        return PrdDraftOut()
    stories = [r for r in rows if r.kind == _KIND_STORY]
    tasks = [r for r in rows if r.kind == _KIND_TASK]
    by_parent: dict[str, list[TempTask]] = {}
    for t in tasks:
        if t.parent_id:
            by_parent.setdefault(t.parent_id, []).append(t)
    out_stories: list[PrdDraftStoryOut] = []
    for s in stories:
        kids = sorted(by_parent.get(s.id, []), key=lambda r: (r.position, r.created_at))
        out_stories.append(
            PrdDraftStoryOut(
                id=s.id,
                title=s.title,
                description=s.description or "",
                acceptanceCriteria=s.acceptance_criteria or "",
                priority=s.priority or "Medium",
                projectId=s.project_id,
                sectionId=s.section_id,
                position=s.position,
                tasks=[
                    PrdDraftTaskOut(
                        id=t.id,
                        title=t.title,
                        description=t.description or "",
                        priority=t.priority or "Medium",
                        position=t.position,
                    )
                    for t in kids
                ],
            )
        )
    return PrdDraftOut(
        importId=rows[0].import_id,
        sourceText=rows[0].source_text or "",
        stories=out_stories,
    )


def get_draft(db: Db, user_id: str) -> PrdDraftOut:
    _gate(db, user_id)
    return _to_draft(temp_crud.list_for_user(db, user_id))


def analyze(
    db: Db,
    user_id: str,
    *,
    text: str | None = None,
    file_bytes: bytes | None = None,
    filename: str | None = None,
) -> PrdDraftOut:
    """Run the PRD chain and replace this user's staging rows in temp_tasks."""
    _gate(db, user_id)
    source, preview = extract_prd(
        db, user_id, text=text, file_bytes=file_bytes, filename=filename
    )
    temp_crud.delete_for_user(db, user_id)
    if not preview.stories:
        db.commit()
        return PrdDraftOut(sourceText=source, stories=[])

    import_id = new_id("pi")
    now = _now()
    for si, story in enumerate(preview.stories):
        sid = new_id("ts")
        temp_crud.create(
            db,
            row_id=sid,
            import_id=import_id,
            user_id=user_id,
            kind=_KIND_STORY,
            parent_id=None,
            title=story.title,
            description=story.description or "",
            acceptance_criteria=story.acceptanceCriteria or "",
            project_id=story.projectId,
            section_id=story.sectionId,
            priority=story.priority or "Medium",
            position=si,
            source_text=source,
            created_at=now,
            updated_at=now,
        )
        for ti, task in enumerate(story.tasks or []):
            temp_crud.create(
                db,
                row_id=new_id("tt"),
                import_id=import_id,
                user_id=user_id,
                kind=_KIND_TASK,
                parent_id=sid,
                title=task.title,
                description=task.description or "",
                acceptance_criteria="",
                project_id=story.projectId,
                section_id=story.sectionId,
                priority=task.priority or "Medium",
                position=ti,
                source_text=source,
                created_at=now,
                updated_at=now,
            )
    db.commit()
    return _to_draft(temp_crud.list_for_user(db, user_id))


def _owned(db: Db, user_id: str, row_id: str) -> TempTask:
    row = temp_crud.get_by_id(db, row_id)
    if not row or row.user_id != user_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Staged item not found")
    return row


def patch_row(db: Db, user_id: str, row_id: str, body: TempTaskPatch) -> PrdDraftOut:
    _gate(db, user_id)
    row = _owned(db, user_id, row_id)
    if body.title is not None:
        title = body.title.strip()
        if not title:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Title cannot be empty")
        row.title = title
    if body.description is not None:
        row.description = body.description
    if body.acceptanceCriteria is not None:
        row.acceptance_criteria = body.acceptanceCriteria
    if body.priority is not None:
        row.priority = body.priority.strip() or "Medium"
    if body.projectId is not None:
        row.project_id = body.projectId.strip() or None
        if row.kind == _KIND_STORY:
            row.section_id = None
    if body.sectionId is not None:
        row.section_id = body.sectionId.strip() or None
    row.updated_at = _now()
    temp_crud.update(db, row)
    if row.kind == _KIND_STORY:
        for child in temp_crud.list_for_import(db, row.import_id):
            if child.kind == _KIND_TASK and child.parent_id == row.id:
                child.project_id = row.project_id
                child.section_id = row.section_id
                child.updated_at = row.updated_at
                temp_crud.update(db, child)
    db.commit()
    return _to_draft(temp_crud.list_for_user(db, user_id))


def add_story(db: Db, user_id: str, body: TempTaskCreateBody) -> PrdDraftOut:
    _gate(db, user_id)
    rows = temp_crud.list_for_user(db, user_id)
    if not rows:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Analyze a PRD first")
    import_id = rows[0].import_id
    source = rows[0].source_text or ""
    stories = [r for r in rows if r.kind == _KIND_STORY]
    now = _now()
    temp_crud.create(
        db,
        row_id=new_id("ts"),
        import_id=import_id,
        user_id=user_id,
        kind=_KIND_STORY,
        parent_id=None,
        title=(body.title or "Untitled story").strip() or "Untitled story",
        description=body.description or "",
        acceptance_criteria="",
        project_id=None,
        section_id=None,
        priority="Medium",
        position=len(stories),
        source_text=source,
        created_at=now,
        updated_at=now,
    )
    db.commit()
    return _to_draft(temp_crud.list_for_user(db, user_id))


def add_task(db: Db, user_id: str, body: TempTaskCreateBody) -> PrdDraftOut:
    _gate(db, user_id)
    parent_id = (body.parentId or "").strip()
    if not parent_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "parentId is required")
    parent = _owned(db, user_id, parent_id)
    if parent.kind != _KIND_STORY:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Tasks must belong to a user story")
    kids = [r for r in temp_crud.list_for_import(db, parent.import_id) if r.parent_id == parent.id]
    now = _now()
    temp_crud.create(
        db,
        row_id=new_id("tt"),
        import_id=parent.import_id,
        user_id=user_id,
        kind=_KIND_TASK,
        parent_id=parent.id,
        title=(body.title or "Untitled task").strip() or "Untitled task",
        description=body.description or "",
        acceptance_criteria="",
        project_id=parent.project_id,
        section_id=parent.section_id,
        priority="Medium",
        position=len(kids),
        source_text=parent.source_text or "",
        created_at=now,
        updated_at=now,
    )
    db.commit()
    return _to_draft(temp_crud.list_for_user(db, user_id))


def delete_row(db: Db, user_id: str, row_id: str) -> PrdDraftOut:
    _gate(db, user_id)
    row = _owned(db, user_id, row_id)
    if row.kind == _KIND_STORY:
        temp_crud.delete_children(db, row.id)
    temp_crud.delete(db, row.id)
    db.commit()
    return _to_draft(temp_crud.list_for_user(db, user_id))


def discard(db: Db, user_id: str) -> PrdDraftOut:
    _gate(db, user_id)
    temp_crud.delete_for_user(db, user_id)
    db.commit()
    return PrdDraftOut()


def commit(db: Db, user_id: str) -> PrdCommitOut:
    """Create real user stories + unassigned tasks, then delete the staging rows."""
    _gate(db, user_id)
    draft = _to_draft(temp_crud.list_for_user(db, user_id))
    if not draft.stories:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Nothing to save — analyze a PRD first")

    stories_created = 0
    tasks_created = 0
    for story in draft.stories:
        title = (story.title or "").strip()
        if not title:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Every user story needs a title")
        if not story.projectId or not story.sectionId:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f'Choose a project and section for "{title}"',
            )
        tasks = [t for t in story.tasks if (t.title or "").strip()]
        if not tasks:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f'"{title}" needs at least one task',
            )
        created = user_story_logic.create_story(
            db,
            user_id,
            UserStoryCreate(
                projectId=story.projectId,
                sectionId=story.sectionId,
                title=title,
                description=story.description or "",
                acceptanceCriteria=story.acceptanceCriteria or "",
                priority=story.priority or "Medium",
            ),
        )
        previews = [
            GeneratedTaskPreview(
                key=t.id,
                title=t.title.strip(),
                description=t.description or "",
                priority=t.priority or "Medium",
                assign=False,
                subtasks=[],
            )
            for t in tasks
        ]
        outs = user_story_logic.confirm_generate_tasks(
            db,
            user_id,
            created.id,
            UserStoryConfirmGenerateBody(replaceGenerated=False, tasks=previews),
        )
        stories_created += 1
        tasks_created += len(outs)

    temp_crud.delete_for_user(db, user_id)
    db.commit()
    return PrdCommitOut(storiesCreated=stories_created, tasksCreated=tasks_created)
