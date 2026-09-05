"""PRD import chain: analyze → stage stories in temp_tasks → edit → commit stories only."""
from __future__ import annotations

import json
import logging
from collections.abc import Iterator
from datetime import datetime, timezone

from fastapi import HTTPException, status

from crud import temp_tasks as temp_crud
from crud import projects as projects_crud
from database.database import Db
from database.init_db import new_id
from database.models import TempTask
from logic import project_logic
from logic.prd_chunks import dedupe_by_title, split_for_outline
from ai.schemas import PrdExtractedStory, PrdOutlineStory
from ai import chains
from logic.prd_extract_logic import _to_preview
from logic.task_extraction_logic import _refs, resolve_source
from logic.schemas import (
    PrdCommitOut,
    PrdDraftOut,
    PrdDraftStoryOut,
    TempTaskCreateBody,
    TempTaskPatch,
    UserStoryCreate,
    UserStoryGeneratePreviewOut,
)
from logic import user_story_logic

log = logging.getLogger("zet.prd")

_KIND_STORY = "user_story"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _gate(db: Db, user_id: str) -> None:
    project_logic.ensure_manager(db, user_id)


def _ids_of(row) -> list[str]:
    raw = getattr(row, "assignee_ids", None) or ""
    if not raw:
        return []
    try:
        v = json.loads(raw)
        return [str(x) for x in v if x]
    except Exception:
        return []


def _extra_of(row) -> dict:
    raw = getattr(row, "extra_json", None) or ""
    if not raw:
        return {}
    try:
        v = json.loads(raw)
        return v if isinstance(v, dict) else {}
    except Exception:
        return {}


def _extra_dump(story) -> str:
    tags = [str(t).strip() for t in (getattr(story, "tags", None) or []) if str(t).strip()]
    return json.dumps(
        {
            "estimatedHours": getattr(story, "estimatedHours", None),
            "storyPoints": getattr(story, "storyPoints", None),
            "startDate": getattr(story, "startDate", None) or None,
            "dueDate": getattr(story, "dueDate", None) or None,
            "sprint": (getattr(story, "sprint", None) or "") or "",
            "tags": tags,
        }
    )


def _story_out(s: TempTask) -> PrdDraftStoryOut:
    extra = _extra_of(s)
    tags = extra.get("tags") or []
    if not isinstance(tags, list):
        tags = []
    return PrdDraftStoryOut(
        id=s.id,
        title=s.title,
        description=s.description or "",
        acceptanceCriteria=s.acceptance_criteria or "",
        priority=s.priority or "Medium",
        projectId=s.project_id,
        sectionId=s.section_id,
        position=s.position,
        assigneeIds=_ids_of(s),
        estimatedHours=extra.get("estimatedHours"),
        storyPoints=extra.get("storyPoints"),
        startDate=extra.get("startDate") or None,
        dueDate=extra.get("dueDate") or None,
        sprint=extra.get("sprint") or "",
        tags=[str(t).strip() for t in tags if str(t).strip()],
        tasks=[],
    )


def _to_draft(rows: list[TempTask]) -> PrdDraftOut:
    if not rows:
        return PrdDraftOut()
    stories = [r for r in rows if r.kind == _KIND_STORY]
    return PrdDraftOut(
        importId=rows[0].import_id,
        sourceText=rows[0].source_text or "",
        stories=[_story_out(s) for s in stories],
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
    files: list[tuple[bytes, str]] | None = None,
    project_id: str | None = None,
) -> PrdDraftOut:
    """Same pipeline as analyze_stream; returns the finished draft (no SSE)."""
    draft = PrdDraftOut()
    for ev in analyze_stream(
        db, user_id, text=text, file_bytes=file_bytes, filename=filename, files=files, project_id=project_id
    ):
        if ev.get("type") == "done":
            draft = PrdDraftOut.model_validate(ev["draft"])
    return draft


def _progress(percent: int, stage: str, label: str, **extra) -> dict:
    ev = {"type": "progress", "percent": max(0, min(100, percent)), "stage": stage, "label": label}
    ev.update(extra)
    return ev


def _draft_story(sid: str, story, lock_pid: str | None, index: int) -> PrdDraftStoryOut:
    tags = [str(t).strip() for t in (getattr(story, "tags", None) or []) if str(t).strip()]
    return PrdDraftStoryOut(
        id=sid,
        title=story.title,
        description=story.description or "",
        acceptanceCriteria=getattr(story, "acceptanceCriteria", None) or "",
        priority=story.priority or "Medium",
        projectId=lock_pid or story.projectId,
        sectionId=getattr(story, "sectionId", None),
        position=index,
        assigneeIds=[i for i in (getattr(story, "assigneeIds", None) or []) if i],
        estimatedHours=getattr(story, "estimatedHours", None),
        storyPoints=getattr(story, "storyPoints", None),
        startDate=getattr(story, "startDate", None) or None,
        dueDate=getattr(story, "dueDate", None) or None,
        sprint=getattr(story, "sprint", None) or "",
        tags=tags,
        tasks=[],
    )


def _shell_preview(shell: PrdOutlineStory, projects, *, round_robin_index: int = 0):
    raw = PrdExtractedStory(
        title=shell.title,
        description=shell.description,
        acceptance_criteria=shell.acceptance_criteria,
        priority=shell.priority or "Medium",
        project_id=shell.project_id,
        project_name=shell.project_name,
        section_id=getattr(shell, "section_id", None),
        section_name=getattr(shell, "section_name", None),
        assignee_id=getattr(shell, "assignee_id", None),
        assignee_name=getattr(shell, "assignee_name", None),
        estimated_hours=getattr(shell, "estimated_hours", None),
        story_points=getattr(shell, "story_points", None),
        start_date=getattr(shell, "start_date", None),
        due_date=getattr(shell, "due_date", None),
        sprint=getattr(shell, "sprint", None),
        tags=list(getattr(shell, "tags", None) or []),
        tasks=[],
    )
    return _to_preview(raw, projects, round_robin_index=round_robin_index)


def analyze_stream(
    db: Db,
    user_id: str,
    *,
    text: str | None = None,
    file_bytes: bytes | None = None,
    filename: str | None = None,
    files: list[tuple[bytes, str]] | None = None,
    project_id: str | None = None,
) -> Iterator[dict]:
    """Outline detailed user stories and stage them — no task expansion."""
    _gate(db, user_id)
    lock_pid = (project_id or "").strip() or None
    if lock_pid:
        project_logic.ensure_project_member(db, lock_pid, user_id)

    yield _progress(4, "parse", "Reading the PRD")
    source = resolve_source(
        db, user_id, text=text, file_bytes=file_bytes, filename=filename, files=files
    )
    if not source:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Nothing to extract — paste a PRD or upload a document.",
        )
    _users, projects = _refs(db, user_id)

    # One answer covering a whole BRD does not fit inside the model's output
    # cap, so the document is read a piece at a time and the answers joined. A
    # document that already fits comes back as a single piece and costs exactly
    # one call, as before.
    pieces = split_for_outline(source[:80000])
    outlined: list[PrdOutlineStory] = []
    outline_err: Exception | None = None
    for idx, piece in enumerate(pieces, start=1):
        label = (
            "Finding user stories"
            if len(pieces) == 1
            else f"Finding user stories ({idx} of {len(pieces)})"
        )
        yield _progress(18 + int(8 * (idx - 1) / len(pieces)), "outline", label)
        try:
            outlined.extend(chains.outline_prd(piece, projects).stories or [])
        except Exception as exc:
            # One piece failing costs that piece, not the whole import — the
            # stories found in the others are still worth staging.
            log.exception("PRD outline failed on piece %d of %d", idx, len(pieces))
            outline_err = exc
    # Split points are chosen on structure, so a requirement restated either
    # side of one can be outlined twice.
    outlined = dedupe_by_title(outlined)

    if not outlined:
        yield _progress(28, "outline", "Retrying story outline")
        try:
            raw = chains.extract_prd(pieces[0] if pieces else source[:80000], projects)
            outline_err = None
            for es in raw.stories or []:
                outlined.append(
                    PrdOutlineStory(
                        title=es.title,
                        description=es.description,
                        acceptance_criteria=es.acceptance_criteria,
                        priority=es.priority,
                        project_id=es.project_id,
                        project_name=es.project_name,
                        assignee_id=getattr(es, "assignee_id", None),
                        assignee_name=getattr(es, "assignee_name", None),
                        section_id=getattr(es, "section_id", None),
                        section_name=getattr(es, "section_name", None),
                        estimated_hours=getattr(es, "estimated_hours", None),
                        story_points=getattr(es, "story_points", None),
                        start_date=getattr(es, "start_date", None),
                        due_date=getattr(es, "due_date", None),
                        sprint=getattr(es, "sprint", None),
                        tags=list(getattr(es, "tags", None) or []),
                    )
                )
        except Exception as exc:
            log.exception("PRD extract retry failed")
            outline_err = outline_err or exc
            outlined = []

    if not outlined:
        if outline_err:
            # Both attempts came back with nothing usable. On a long document
            # that means the model was still writing when it hit the output cap
            # and not one story finished; a schema mismatch lands here too,
            # since Pydantic's ValidationError is a ValueError. The way out of
            # either is the same, so say it in terms of the document rather than
            # quoting an exception at someone who never asked about JSON.
            detail = (
                "No usable stories came back from that document — it is most "
                "likely too long to analyse in one pass. Try importing it a "
                "section at a time."
                if isinstance(outline_err, ValueError)
                else "Could not analyse that document just now — please try again."
            )
            raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail)
        temp_crud.delete_for_user(db, user_id)
        db.commit()
        yield {
            "type": "done",
            "percent": 100,
            "label": "No user stories in that PRD",
            "draft": PrdDraftOut(sourceText=source, stories=[]).model_dump(),
        }
        return

    staged: list[PrdDraftStoryOut] = []
    pending: list[tuple[str, object]] = []
    for i, shell in enumerate(outlined):
        preview = _shell_preview(shell, projects, round_robin_index=i)
        if preview is None:
            continue
        sid = new_id("ts")
        out = _draft_story(sid, preview, lock_pid, len(staged))
        staged.append(out)
        pending.append((sid, preview))

    if not staged:
        temp_crud.delete_for_user(db, user_id)
        db.commit()
        yield {
            "type": "done",
            "percent": 100,
            "label": "No user stories in that PRD",
            "draft": PrdDraftOut(sourceText=source, stories=[]).model_dump(),
        }
        return

    total = len(staged)
    yield _progress(80, "save", f"Saving {total} stor{'y' if total == 1 else 'ies'}", totalStories=total, doneStories=0)

    temp_crud.delete_for_user(db, user_id)
    import_id = new_id("pi")
    now = _now()
    for i, (sid, preview) in enumerate(pending):
        temp_crud.create(
            db,
            row_id=sid,
            import_id=import_id,
            user_id=user_id,
            kind=_KIND_STORY,
            parent_id=None,
            title=preview.title,
            description=preview.description or "",
            acceptance_criteria=preview.acceptanceCriteria or "",
            project_id=lock_pid or preview.projectId,
            section_id=getattr(preview, "sectionId", None),
            priority=preview.priority or "Medium",
            position=i,
            source_text=source,
            created_at=now,
            updated_at=now,
            assignee_ids=json.dumps([a for a in (preview.assigneeIds or []) if a]),
            extra_json=_extra_dump(preview),
        )
    db.commit()

    for out in staged:
        yield {"type": "story", "percent": 95, "story": out.model_dump()}
    yield _progress(
        100,
        "outline",
        f"Found {total} user stor{'y' if total == 1 else 'ies'}",
        totalStories=total,
        doneStories=total,
    )
    yield {
        "type": "done",
        "percent": 100,
        "label": "Draft ready",
        "draft": PrdDraftOut(importId=import_id, sourceText=source, stories=staged).model_dump(),
    }


def _owned(db: Db, user_id: str, row_id: str) -> TempTask:
    row = temp_crud.get_by_id(db, row_id)
    if not row or row.user_id != user_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Staged item not found")
    return row


def preview_generate_tasks(db: Db, user_id: str, row_id: str) -> UserStoryGeneratePreviewOut:
    """AI preview from a staged PRD story — does not commit the story or create tasks."""
    _gate(db, user_id)
    row = _owned(db, user_id, row_id)
    if row.kind != _KIND_STORY:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Only staged stories can generate tasks")
    return user_story_logic.preview_generate_from_fields(
        db,
        user_id,
        story_id=row.id,
        title=row.title,
        description=row.description or "",
        acceptance_criteria=row.acceptance_criteria or "",
        project_id=row.project_id,
        section_id=row.section_id,
        priority=row.priority,
    )


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
    if body.assigneeIds is not None:
        ids = [i.strip() for i in body.assigneeIds if i and str(i).strip()]
        pid = row.project_id
        if pid and ids:
            mids = set(projects_crud.member_ids(db, pid))
            bad = [i for i in ids if i not in mids]
            if bad:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, "assigneeIds must be project members")
        row.assignee_ids = json.dumps(ids)
    extra = _extra_of(row)
    if body.estimatedHours is not None:
        extra["estimatedHours"] = body.estimatedHours
    if body.storyPoints is not None:
        extra["storyPoints"] = body.storyPoints
    if body.startDate is not None:
        extra["startDate"] = body.startDate or None
    if body.dueDate is not None:
        extra["dueDate"] = body.dueDate or None
    if body.sprint is not None:
        extra["sprint"] = (body.sprint or "").strip()[:120]
    if body.tags is not None:
        extra["tags"] = [str(t).strip() for t in body.tags if str(t).strip()]
    row.extra_json = json.dumps(extra)
    row.updated_at = _now()
    temp_crud.update(db, row)
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


def commit(
    db: Db,
    user_id: str,
    story_ids: list[str] | None = None,
    task_ids: list[str] | None = None,
) -> PrdCommitOut:
    """Create selected user stories only. task_ids is ignored (story-only flow)."""
    del task_ids  # story-only: never create tasks from PRD commit
    _gate(db, user_id)
    draft = _to_draft(temp_crud.list_for_user(db, user_id))
    if not draft.stories:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Nothing to save — analyze a PRD first")

    wanted = {s.strip() for s in (story_ids or []) if s and s.strip()}
    stories = [s for s in draft.stories if s.id in wanted] if wanted else list(draft.stories)
    if wanted and not stories:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No selected stories to save")

    stories_created = 0
    committed_draft_ids: list[str] = []
    created_ids: list[str] = []
    for story in stories:
        title = (story.title or "").strip()
        if not title:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Every user story needs a title")
        if not story.projectId:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f'Choose a project for "{title}"',
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
                assigneeIds=list(story.assigneeIds or []),
                estimatedHours=story.estimatedHours,
                storyPoints=story.storyPoints,
                startDate=story.startDate,
                dueDate=story.dueDate,
                sprint=story.sprint or "",
                tags=list(story.tags or []),
            ),
        )
        stories_created += 1
        committed_draft_ids.append(story.id)
        created_ids.append(created.id)

    if wanted:
        for sid in committed_draft_ids:
            temp_crud.delete_children(db, sid)
            temp_crud.delete(db, sid)
    else:
        temp_crud.delete_for_user(db, user_id)
    db.commit()
    return PrdCommitOut(storiesCreated=stories_created, tasksCreated=0, storyIds=created_ids)
