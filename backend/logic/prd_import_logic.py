"""PRD import chain: analyze → stage in temp_tasks → edit → commit to real stories/tasks."""
from __future__ import annotations

import json
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

from fastapi import HTTPException, status

from crud import temp_tasks as temp_crud
from crud import projects as projects_crud
from database.database import Db
from database.init_db import new_id
from database.models import TempTask
from logic import project_logic
from ai.schemas import PrdExtractedStory, PrdExtractedTask, PrdOutlineStory
from ai import chains
from logic.prd_extract_logic import _to_preview, ensure_task_assignees, members_of
from logic.task_extraction_logic import _refs, resolve_source
from logic.schemas import (
    GeneratedTaskPreview,
    PrdCommitOut,
    PrdCommitBody,
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


def _ids_of(row) -> list[str]:
    raw = getattr(row, "assignee_ids", None) or ""
    if not raw:
        return []
    try:
        v = json.loads(raw)
        return [str(x) for x in v if x]
    except Exception:
        return []


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
                assigneeIds=_ids_of(s),
                tasks=[
                    PrdDraftTaskOut(
                        id=t.id,
                        title=t.title,
                        description=t.description or "",
                        priority=t.priority or "Medium",
                        position=t.position,
                        projectId=t.project_id,
                        sectionId=t.section_id,
                        assigneeIds=_ids_of(t),
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


def _stage_preview(
    db: Db,
    *,
    import_id: str,
    user_id: str,
    source: str,
    lock_pid: str | None,
    now: str,
    index: int,
    story,
) -> PrdDraftStoryOut:
    sid = new_id("ts")
    pid = lock_pid or story.projectId
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
        project_id=pid,
        section_id=None,
        priority=story.priority or "Medium",
        position=index,
        source_text=source,
        created_at=now,
        updated_at=now,
    )
    tasks_out: list[PrdDraftTaskOut] = []
    story_aids: list[str] = []
    for ti, task in enumerate(story.tasks or []):
        tid = new_id("tt")
        aids = [i for i in (getattr(task, "assigneeIds", None) or []) if i]
        for uid in aids:
            if uid not in story_aids:
                story_aids.append(uid)
        temp_crud.create(
            db,
            row_id=tid,
            import_id=import_id,
            user_id=user_id,
            kind=_KIND_TASK,
            parent_id=sid,
            title=task.title,
            description=task.description or "",
            acceptance_criteria="",
            project_id=pid,
            section_id=None,
            priority=task.priority or "Medium",
            position=ti,
            source_text=source,
            created_at=now,
            updated_at=now,
            assignee_ids=json.dumps(aids),
        )
        tasks_out.append(
            PrdDraftTaskOut(
                id=tid,
                title=task.title,
                description=task.description or "",
                priority=task.priority or "Medium",
                position=ti,
                projectId=pid,
                assigneeIds=aids,
            )
        )
    parent = temp_crud.get_by_id(db, sid)
    if parent and story_aids:
        parent.assignee_ids = json.dumps(story_aids)
        parent.updated_at = now
        temp_crud.update(db, parent)
    db.commit()
    return PrdDraftStoryOut(
        id=sid,
        title=story.title,
        description=story.description or "",
        acceptanceCriteria=story.acceptanceCriteria or "",
        priority=story.priority or "Medium",
        projectId=pid,
        sectionId=None,
        position=index,
        assigneeIds=story_aids,
        tasks=tasks_out,
    )


def _default_tasks(title: str) -> list[PrdExtractedTask]:
    label = (title or "this story").strip() or "this story"
    return [
        PrdExtractedTask(
            title=f"Implement {label}",
            description=f"Build the core work for {label}.",
            priority="Medium",
        )
    ]


def _attach_tasks(
    db: Db,
    *,
    story_id: str,
    import_id: str,
    user_id: str,
    source: str,
    project_id: str | None,
    now: str,
    tasks: list[PrdExtractedTask],
    members: list,
) -> list[PrdDraftTaskOut]:
    outs: list[PrdDraftTaskOut] = []
    assigned = ensure_task_assignees(tasks, members)
    story_aids: list[str] = []
    for ti, (task, ids) in enumerate(zip(tasks, assigned)):
        title = (task.title or "").strip()
        if not title:
            continue
        tid = new_id("tt")
        for uid in ids:
            if uid not in story_aids:
                story_aids.append(uid)
        temp_crud.create(
            db,
            row_id=tid,
            import_id=import_id,
            user_id=user_id,
            kind=_KIND_TASK,
            parent_id=story_id,
            title=title,
            description=task.description or "",
            acceptance_criteria="",
            project_id=project_id,
            section_id=None,
            priority=(task.priority or "Medium").strip() or "Medium",
            position=ti,
            source_text=source,
            created_at=now,
            updated_at=now,
            assignee_ids=json.dumps(ids),
        )
        outs.append(
            PrdDraftTaskOut(
                id=tid,
                title=title,
                description=task.description or "",
                priority=(task.priority or "Medium").strip() or "Medium",
                position=ti,
                projectId=project_id,
                assigneeIds=ids,
            )
        )
    parent = temp_crud.get_by_id(db, story_id)
    if parent and story_aids:
        parent.assignee_ids = json.dumps(story_aids)
        parent.updated_at = now
        temp_crud.update(db, parent)
    db.commit()
    return outs


def _expand_story_tasks(source: str, shell: PrdOutlineStory, projects) -> list[PrdExtractedTask]:
    """Same expand prompt for every story — one LLM call per story."""
    try:
        bundle = chains.expand_prd_story(source, shell, projects)
        tasks = list(bundle.tasks or [])
    except Exception:
        tasks = []
    return tasks or _default_tasks(shell.title)


def _shell_preview(shell: PrdOutlineStory, projects):
    raw = PrdExtractedStory(
        title=shell.title,
        description=shell.description,
        acceptance_criteria=shell.acceptance_criteria,
        priority=shell.priority or "Medium",
        project_id=shell.project_id,
        project_name=shell.project_name,
        tasks=[],
    )
    return _to_preview(raw, projects)


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
    """Phase 1: outline stories. Phase 2: N parallel expand calls (same prompt)."""
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

    yield _progress(12, "outline", "Finding user stories")
    outlined: list[PrdOutlineStory] = []
    try:
        outlined = list(chains.outline_prd(source[:80000], projects).stories or [])
    except Exception:
        outlined = []

    if not outlined:
        yield _progress(18, "outline", "Retrying story outline")
        try:
            raw = chains.extract_prd(source[:80000], projects)
            for es in raw.stories or []:
                outlined.append(
                    PrdOutlineStory(
                        title=es.title,
                        description=es.description,
                        acceptance_criteria=es.acceptance_criteria,
                        priority=es.priority,
                        project_id=es.project_id,
                        project_name=es.project_name,
                    )
                )
        except Exception:
            outlined = []

    if not outlined:
        temp_crud.delete_for_user(db, user_id)
        db.commit()
        yield {
            "type": "done",
            "percent": 100,
            "label": "No user stories in that PRD",
            "draft": PrdDraftOut(sourceText=source, stories=[]).model_dump(),
        }
        return

    total = len(outlined)
    yield _progress(
        24,
        "outline",
        f"Found {total} user stor{'y' if total == 1 else 'ies'}",
        totalStories=total,
    )

    temp_crud.delete_for_user(db, user_id)
    import_id = new_id("pi")
    now = _now()
    jobs: list[tuple[str, PrdOutlineStory]] = []
    for i, shell in enumerate(outlined):
        preview = _shell_preview(shell, projects)
        if preview is None:
            continue
        staged = _stage_preview(
            db,
            import_id=import_id,
            user_id=user_id,
            source=source,
            lock_pid=lock_pid,
            now=now,
            index=len(jobs),
            story=preview,
        )
        jobs.append((staged.id, shell))
        percent = 24 + int(((i + 1) / total) * 8)
        yield _progress(
            percent,
            "outline",
            f"Story {i + 1} of {total}",
            doneStories=0,
            totalStories=total,
        )
        yield {"type": "story", "percent": percent, "story": staged.model_dump()}

    if not jobs:
        draft = _to_draft(temp_crud.list_for_user(db, user_id))
        yield {"type": "done", "percent": 100, "label": "No user stories in that PRD", "draft": draft.model_dump()}
        return

    n = len(jobs)
    yield _progress(34, "expand", f"Writing tasks for {n} stor{'y' if n == 1 else 'ies'} in parallel", doneStories=0, totalStories=n)

    def _work(item: tuple[str, PrdOutlineStory]) -> tuple[str, list[PrdExtractedTask]]:
        sid, shell = item
        return sid, _expand_story_tasks(source, shell, projects)

    done_n = 0
    workers = min(8, n)
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(_work, job): job for job in jobs}
        for fut in as_completed(futures):
            sid, tasks = fut.result()
            parent = temp_crud.get_by_id(db, sid)
            pid = (parent.project_id if parent else None) or lock_pid
            outs = _attach_tasks(
                db,
                story_id=sid,
                import_id=import_id,
                user_id=user_id,
                source=source,
                project_id=pid,
                now=_now(),
                tasks=tasks,
                members=members_of(projects, pid),
            )
            done_n += 1
            percent = 34 + int((done_n / n) * 62)
            label = parent.title if parent else "story"
            yield _progress(
                percent,
                "expand",
                f"Tasks ready · {label}",
                doneStories=done_n,
                totalStories=n,
            )
            yield {
                "type": "tasks",
                "percent": percent,
                "storyId": sid,
                "tasks": [t.model_dump() for t in outs],
            }

    yield _progress(98, "save", "Draft ready")
    draft = _to_draft(temp_crud.list_for_user(db, user_id))
    yield {"type": "done", "percent": 100, "label": "Draft ready", "draft": draft.model_dump()}


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
    if body.assigneeIds is not None:
        ids = [i.strip() for i in body.assigneeIds if i and str(i).strip()]
        pid = row.project_id
        if pid and ids:
            mids = set(projects_crud.member_ids(db, pid))
            bad = [i for i in ids if i not in mids]
            if bad:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, "assigneeIds must be project members")
        row.assignee_ids = json.dumps(ids)
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


def commit(
    db: Db,
    user_id: str,
    story_ids: list[str] | None = None,
    task_ids: list[str] | None = None,
) -> PrdCommitOut:
    """Create selected stories. Only ticked tasks are created; a story can have none."""
    _gate(db, user_id)
    draft = _to_draft(temp_crud.list_for_user(db, user_id))
    if not draft.stories:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Nothing to save — analyze a PRD first")

    wanted = {s.strip() for s in (story_ids or []) if s and s.strip()}
    stories = [s for s in draft.stories if s.id in wanted] if wanted else list(draft.stories)
    if wanted and not stories:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No selected stories to save")
    allow_tasks = None if task_ids is None else {t.strip() for t in task_ids if t and t.strip()}

    stories_created = 0
    tasks_created = 0
    committed_ids: list[str] = []
    for story in stories:
        title = (story.title or "").strip()
        if not title:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Every user story needs a title")
        if not story.projectId:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f'Choose a project for "{title}"',
            )
        tasks = [t for t in story.tasks if (t.title or "").strip()]
        if allow_tasks is not None:
            tasks = [t for t in tasks if t.id in allow_tasks]
        created = user_story_logic.create_story(
            db,
            user_id,
            UserStoryCreate(
                projectId=story.projectId,
                title=title,
                description=story.description or "",
                acceptanceCriteria=story.acceptanceCriteria or "",
                priority=story.priority or "Medium",
                assigneeIds=list(story.assigneeIds or []),
            ),
        )
        if tasks:
            previews = [
                GeneratedTaskPreview(
                    key=t.id,
                    title=t.title.strip(),
                    description=t.description or "",
                    priority=t.priority or "Medium",
                    assign=bool(t.assigneeIds),
                    assigneeIds=list(t.assigneeIds or []),
                    sectionId=t.sectionId,
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
            tasks_created += len(outs)
        stories_created += 1
        committed_ids.append(story.id)

    if wanted:
        # Only the saved story leaves the draft. Other stories and their tasks stay.
        for sid in committed_ids:
            temp_crud.delete_children(db, sid)
            temp_crud.delete(db, sid)
    else:
        temp_crud.delete_for_user(db, user_id)
    db.commit()
    return PrdCommitOut(storiesCreated=stories_created, tasksCreated=tasks_created)
