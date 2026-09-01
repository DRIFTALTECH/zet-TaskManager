"""User story business logic — additive; does not alter legacy task flows."""
from __future__ import annotations

import json
import logging
import re
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException, status
from pydantic import BaseModel, Field, field_validator

from ai.schemas import _coerce_text

from crud import projects as projects_crud
from crud import sections as sections_crud
from crud import task_assignees as assignees_crud
from crud import tasks as tasks_crud
from crud import user_stories as stories_crud
from crud import user_story_assignees as story_assignees_crud
from database.database import Db
from database.init_db import new_id
from database.models import Task, UserStory
from logic import project_logic, task_logic
from logic.schemas import (
    BulkCreateStoriesBody,
    ExtractedStoryPreview,
    ExtractStoriesPreviewOut,
    GeneratedSubtaskPreview,
    GeneratedTaskPreview,
    UserStoryConfirmGenerateBody,
    UserStoryCreate,
    UserStoryGeneratePreviewOut,
    UserStoryOut,
    UserStoryPatch,
)

log = logging.getLogger("zet.user_stories")

_DONE = frozenset({"completed", "done"})
_AI_TAG = "ai-generated"

# Informal markers like "( sub task -> get clockify api key )" embedded in a task title.
_INLINE_SUBTASK_RE = re.compile(
    r"\s*\(\s*sub[\s_-]*tasks?\s*(?:->|:)\s*(.+?)\s*\)\s*$",
    re.IGNORECASE,
)


def _parse_float(raw: str | None) -> float | None:
    if raw is None or raw == "":
        return None
    try:
        return float(raw)
    except (TypeError, ValueError):
        return None


def _fmt_float(v: float | None) -> str | None:
    if v is None:
        return None
    return str(v)


def _is_done(status: str) -> bool:
    return (status or "").strip().lower() in _DONE


def _unique_ordered(ids: list[str] | None) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for uid in ids or []:
        u = (uid or "").strip()
        if not u or u in seen:
            continue
        seen.add(u)
        out.append(u)
    return out


def _resolve_assignee_ids(
    db: Db, project_id: str, *, assignee_ids: list[str] | None, assignee_id: str | None
) -> list[str]:
    """Prefer assigneeIds; fall back to single assigneeId. Validate membership."""
    ids = _unique_ordered(assignee_ids)
    if not ids and assignee_id:
        ids = _unique_ordered([assignee_id])
    if not ids:
        return []
    mids = set(projects_crud.member_ids(db, project_id))
    bad = [i for i in ids if i not in mids]
    if bad:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "assigneeIds must be project members")
    return ids


def _set_story_assignees(db: Db, story: UserStory, ids: list[str]) -> None:
    story_assignees_crud.set_assignees(db, story.id, ids)
    story.assignee_id = ids[0] if ids else None


def _progress_for_story(db: Db, story_id: str) -> tuple[float, int, int, int, int]:
    rows = tasks_crud.list_for_user_story(db, story_id)
    tops = [t for t in rows if not getattr(t, "parent_task_id", None)]
    subs = [t for t in rows if getattr(t, "parent_task_id", None)]
    tc, tdone = len(tops), sum(1 for t in tops if _is_done(t.status))
    sc, sdone = len(subs), sum(1 for t in subs if _is_done(t.status))
    total = tc + sc
    pct = round(100.0 * (tdone + sdone) / total, 1) if total else 0.0
    return pct, tc, tdone, sc, sdone


def _first_section_id(db: Db, project_id: str) -> str:
    secs = sections_crud.list_for_project(db, project_id)
    if not secs:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Add a section to this project first")
    return secs[0].id


def _to_out(db: Db, s: UserStory) -> UserStoryOut:
    pct, tc, tdone, sc, sdone = _progress_for_story(db, s.id)
    aids = story_assignees_crud.list_user_ids_ordered(db, s.id)
    if not aids and s.assignee_id:
        aids = [s.assignee_id]
    return UserStoryOut(
        id=s.id,
        projectId=s.project_id,
        sectionId=getattr(s, "section_id", None) or None,
        title=s.title,
        description=s.description or "",
        acceptanceCriteria=s.acceptance_criteria or "",
        priority=s.priority,
        status=s.status,
        assigneeId=aids[0] if aids else s.assignee_id,
        assigneeIds=aids,
        reporterId=s.reporter_id,
        estimatedHours=_parse_float(s.estimated_hours),
        storyPoints=_parse_float(s.story_points),
        startDate=s.start_date,
        dueDate=s.due_date,
        createdAt=s.created_at,
        updatedAt=s.updated_at,
        progressPercent=pct,
        taskCount=tc,
        completedTaskCount=tdone,
        subtaskCount=sc,
        completedSubtaskCount=sdone,
    )


def list_for_project(db: Db, user_id: str, project_id: str) -> list[UserStoryOut]:
    project_logic.ensure_project_member(db, project_id, user_id)
    return [_to_out(db, s) for s in stories_crud.list_for_project(db, project_id)]


def list_for_section(db: Db, user_id: str, section_id: str) -> list[UserStoryOut]:
    sec = sections_crud.get_by_id(db, section_id)
    if not sec:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Section not found")
    project_logic.ensure_project_member(db, sec.project_id, user_id)
    return [_to_out(db, s) for s in stories_crud.list_for_section(db, section_id)]


def get_story(db: Db, user_id: str, story_id: str) -> UserStoryOut:
    s = stories_crud.get_by_id(db, story_id)
    if not s:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User story not found")
    project_logic.ensure_project_member(db, s.project_id, user_id)
    return _to_out(db, s)


def create_story(db: Db, user_id: str, body: UserStoryCreate) -> UserStoryOut:
    project_logic.ensure_project_member(db, body.projectId, user_id)
    aids = _resolve_assignee_ids(
        db, body.projectId, assignee_ids=body.assigneeIds, assignee_id=body.assigneeId
    )
    now = datetime.now(timezone.utc).isoformat()
    sid = new_id("us")
    s = stories_crud.create(
        db,
        story_id=sid,
        project_id=body.projectId,
        section_id=None,
        title=body.title.strip(),
        description=body.description or "",
        acceptance_criteria=body.acceptanceCriteria or "",
        priority=body.priority or "Medium",
        status=body.status or "backlog",
        assignee_id=aids[0] if aids else None,
        reporter_id=user_id,
        estimated_hours=_fmt_float(body.estimatedHours),
        story_points=_fmt_float(body.storyPoints),
        start_date=body.startDate,
        due_date=body.dueDate,
        created_at=now,
        updated_at=now,
    )
    _set_story_assignees(db, s, aids)
    if aids:
        stories_crud.update(db, s)
    db.commit()
    return _to_out(db, s)


def patch_story(db: Db, user_id: str, story_id: str, body: UserStoryPatch) -> UserStoryOut:
    s = stories_crud.get_by_id(db, story_id)
    if not s:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User story not found")
    project_logic.ensure_project_member(db, s.project_id, user_id)
    if body.title is not None:
        s.title = body.title.strip()
    if body.description is not None:
        s.description = body.description
    if body.acceptanceCriteria is not None:
        s.acceptance_criteria = body.acceptanceCriteria
    if body.priority is not None:
        s.priority = body.priority
    if body.status is not None:
        s.status = body.status
    if body.assigneeIds is not None:
        aids = _resolve_assignee_ids(
            db, s.project_id, assignee_ids=body.assigneeIds, assignee_id=None
        )
        _set_story_assignees(db, s, aids)
    elif body.assigneeId is not None:
        aid = body.assigneeId or None
        aids = _resolve_assignee_ids(db, s.project_id, assignee_ids=None, assignee_id=aid) if aid else []
        _set_story_assignees(db, s, aids)
    if body.estimatedHours is not None:
        s.estimated_hours = _fmt_float(body.estimatedHours)
    if body.storyPoints is not None:
        s.story_points = _fmt_float(body.storyPoints)
    if body.startDate is not None:
        s.start_date = body.startDate or None
    if body.dueDate is not None:
        s.due_date = body.dueDate or None
    s.updated_at = datetime.now(timezone.utc).isoformat()
    stories_crud.update(db, s)
    db.commit()
    return _to_out(db, s)


def delete_story(db: Db, user_id: str, story_id: str) -> None:
    s = stories_crud.get_by_id(db, story_id)
    if not s:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User story not found")
    project_logic.ensure_project_member(db, s.project_id, user_id)
    stories_crud.delete(db, story_id)
    db.commit()


def list_story_tasks(db: Db, user_id: str, story_id: str):
    s = stories_crud.get_by_id(db, story_id)
    if not s:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User story not found")
    project_logic.ensure_project_member(db, s.project_id, user_id)
    rows = tasks_crud.list_for_user_story(db, story_id)
    return [task_logic.to_task_out(db, t, user_id) for t in rows]


class _GenSubtask(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    description: str = ""


class _GenTask(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    description: str = ""
    priority: str = "Medium"
    subtasks: list[_GenSubtask] = Field(default_factory=list)


class _GenPlan(BaseModel):
    tasks: list[_GenTask] = Field(default_factory=list)


class _ExtractStory(BaseModel):
    title: str = Field(..., min_length=1, max_length=120)
    description: str = ""
    acceptance_criteria: str = ""
    priority: str = "Medium"
    tasks: list[_GenTask] = Field(default_factory=list)

    @field_validator("acceptance_criteria", "description", mode="before")
    @classmethod
    def _text(cls, v):
        coerced = _coerce_text(v)
        return coerced or ""


class _ExtractPlan(BaseModel):
    stories: list[_ExtractStory] = Field(default_factory=list)


def _task_tags(t: Task) -> list[str]:
    try:
        tags = json.loads(t.tags_json or "[]")
        return tags if isinstance(tags, list) else []
    except Exception:
        return []


def _is_ai_generated(t: Task) -> bool:
    return _AI_TAG in _task_tags(t)


def _story_context_text(db: Db, s: UserStory) -> str:
    """Include attached document text when available (reuse task extraction parser)."""
    parts = [
        f"Title: {s.title}",
        f"Description:\n{s.description or '(none)'}",
        f"Acceptance criteria:\n{s.acceptance_criteria or '(none)'}",
    ]
    try:
        from logic import attachment_logic
        from logic.task_extraction_logic import _document_text

        for att in attachment_logic.list_for_user_story(db, s.id):
            path, filename, _ct = attachment_logic.resolve_story_for_download(db, s.id, att.id)
            raw = path.read_bytes()
            text = _document_text(raw, filename)
            if text.strip():
                parts.append(f"Attached document ({filename}):\n{text[:12000]}")
    except Exception:
        log.debug("Could not include story attachments in AI context", exc_info=True)
    return "\n\n".join(parts)


def preview_generate_tasks(db: Db, user_id: str, story_id: str) -> UserStoryGeneratePreviewOut:
    """AI plan only — does not persist tasks. Client confirms via confirm_generate_tasks."""
    s = stories_crud.get_by_id(db, story_id)
    if not s:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User story not found")
    project_logic.ensure_project_member(db, s.project_id, user_id)

    from ai import service as ai_service
    from langchain_core.prompts import ChatPromptTemplate

    prompt = ChatPromptTemplate.from_messages(
        [
            (
                "system",
                "You are a delivery planner. Break the user story into concrete engineering "
                "tasks with nested subtasks when the story implies them. Prefer 3–8 tasks. "
                "Be specific and actionable. Do not invent unrelated work. "
                "IMPORTANT: put child work under tasks[].subtasks — never as sibling tasks. "
                "When text says '(sub task -> X)' or '(subtask: X)', the parent is the "
                "surrounding task and X must be a subtask of that task.",
            ),
            ("human", "{context}"),
        ]
    )
    try:
        plan = ai_service.complete_structured(
            prompt,
            {"context": _story_context_text(db, s)},
            _GenPlan,
        )
    except Exception as exc:
        log.exception("User story generate preview failed")
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            f"AI task generation failed: {exc}",
        ) from exc

    if not isinstance(plan, _GenPlan):
        plan = _GenPlan.model_validate(plan)

    existing = tasks_crud.list_for_user_story(db, story_id)
    existing_titles = {
        (t.title or "").strip().lower()
        for t in existing
        if not getattr(t, "parent_task_id", None)
    }

    previews: list[GeneratedTaskPreview] = []
    for gt in plan.tasks:
        title = (gt.title or "").strip()
        if not title or title.lower() in existing_titles:
            continue
        tkey = f"t-{uuid.uuid4().hex[:10]}"
        subs = [
            GeneratedSubtaskPreview(
                key=f"s-{uuid.uuid4().hex[:10]}",
                title=(gs.title or "").strip(),
                description=(gs.description or "").strip(),
            )
            for gs in (gt.subtasks or [])
            if (gs.title or "").strip()
        ]
        previews.append(
            GeneratedTaskPreview(
                key=tkey,
                title=title,
                description=(gt.description or "").strip(),
                priority=gt.priority or s.priority or "Medium",
                subtasks=subs,
            )
        )
    return UserStoryGeneratePreviewOut(storyId=story_id, tasks=previews)


def confirm_generate_tasks(
    db: Db, user_id: str, story_id: str, body: UserStoryConfirmGenerateBody
) -> list:
    """Persist only the checked preview tasks/subtasks from the client."""
    s = stories_crud.get_by_id(db, story_id)
    if not s:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User story not found")
    project_logic.ensure_project_member(db, s.project_id, user_id)

    if body.replaceGenerated:
        existing = tasks_crud.list_for_user_story(db, story_id)
        for t in list(existing):
            if _is_ai_generated(t) and not getattr(t, "parent_task_id", None):
                tasks_crud.delete_task(db, t.id)

    existing = tasks_crud.list_for_user_story(db, story_id)
    existing_titles = {
        (t.title or "").strip().lower()
        for t in existing
        if not getattr(t, "parent_task_id", None)
    }

    story_aids = story_assignees_crud.list_user_ids_ordered(db, s.id)
    if not story_aids and s.assignee_id:
        story_aids = [s.assignee_id]
    mids = projects_crud.member_ids(db, s.project_id)
    # Only real story assignees — never fall back to the creating user.
    assign_list = [a for a in story_aids if a in mids]

    created_outs = []
    now = datetime.now(timezone.utc).isoformat()
    today = now[:10]

    for gt in body.tasks or []:
        # Normalize inline "(sub task -> …)" markers even if the preview omitted nesting.
        title, inline_sub = _split_inline_subtask((gt.title or "").strip())
        if not title or title.lower() in existing_titles:
            continue
        # Per-task assigneeIds win; assign=True copies story assignees when none set.
        explicit = [i for i in (getattr(gt, "assigneeIds", None) or []) if i]
        if explicit:
            task_assignees = [i for i in explicit if i in mids]
        else:
            should_assign = bool(getattr(gt, "assign", False)) and bool(assign_list)
            task_assignees = assign_list if should_assign else []
        # assigned_to is NOT NULL — placeholder only; empty assigneeIds = unassigned in API.
        primary = task_assignees[0] if task_assignees else user_id
        tid = new_id("t")
        wanted_section = (getattr(gt, "sectionId", None) or "").strip() or None
        if wanted_section:
            secs = sections_crud.list_for_project(db, s.project_id)
            if not any(sec.id == wanted_section for sec in secs):
                wanted_section = None
        task_section = wanted_section or getattr(s, "section_id", None) or _first_section_id(db, s.project_id)
        t = tasks_crud.create_task(
            db,
            task_id=tid,
            title=title,
            description=(gt.description or "").strip(),
            project_id=s.project_id,
            section_id=task_section,
            assigned_to=primary,
            assigned_by=user_id,
            created_by=user_id,
            due_date=s.due_date or today,
            priority=gt.priority or s.priority or "Medium",
            status="backlog",
            is_started=False,
            approved_by_manager=False,
            time_tracked=0,
            tags=[_AI_TAG],
            created_at=now,
            user_story_id=s.id,
            parent_task_id=None,
        )
        assignees_crud.set_assignees(db, tid, task_assignees)
        existing_titles.add(title.lower())
        created_outs.append(task_logic.to_task_out(db, t, user_id))

        sub_titles: list[tuple[str, str]] = []
        seen_subs: set[str] = set()
        for gs in gt.subtasks or []:
            stitle, nested = _split_inline_subtask((gs.title or "").strip())
            if stitle and stitle.lower() not in seen_subs:
                seen_subs.add(stitle.lower())
                sub_titles.append((stitle, (gs.description or "").strip()))
            if nested and nested.lower() not in seen_subs:
                seen_subs.add(nested.lower())
                sub_titles.append((nested, ""))
        if inline_sub and inline_sub.lower() not in seen_subs:
            sub_titles.append((inline_sub, ""))

        for stitle, sdesc in sub_titles:
            sid = new_id("t")
            st = tasks_crud.create_task(
                db,
                task_id=sid,
                title=stitle,
                description=sdesc,
                project_id=s.project_id,
                section_id=task_section,
                assigned_to=primary,
                assigned_by=user_id,
                created_by=user_id,
                due_date=s.due_date or today,
                priority="Medium",
                status="backlog",
                is_started=False,
                approved_by_manager=False,
                time_tracked=0,
                tags=[_AI_TAG],
                created_at=now,
                user_story_id=s.id,
                parent_task_id=tid,
            )
            assignees_crud.set_assignees(db, sid, task_assignees)
            created_outs.append(task_logic.to_task_out(db, st, user_id))

    s.updated_at = datetime.now(timezone.utc).isoformat()
    stories_crud.update(db, s)
    db.commit()
    return created_outs


def _shorten_title(title: str, max_len: int = 80) -> str:
    """Keep story/task titles short; detail belongs in description."""
    t = " ".join((title or "").split())
    if not t or len(t) <= max_len:
        return t
    for sep in (". ", "! ", "? ", "; ", " — ", " – ", ": "):
        idx = t.find(sep)
        if 8 <= idx <= max_len:
            return t[:idx].strip()
    cut = t[:max_len].rsplit(" ", 1)[0].strip()
    if len(cut) < 8:
        cut = t[:max_len].strip()
    return cut.rstrip(" ,;:-") + "…"


def _normalize_story_title(title: str, description: str) -> tuple[str, str]:
    """Short title + move overflow into description when the model pasted a paragraph."""
    raw = " ".join((title or "").strip().split())
    if not raw:
        return "", (description or "").strip()
    short = _shorten_title(raw, 80)
    desc = (description or "").strip()
    if short.rstrip("…") != raw and raw.lower() not in desc.lower():
        desc = raw if not desc else f"{raw}\n\n{desc}"
    return short, desc


def _split_inline_subtask(title: str) -> tuple[str, str | None]:
    """Pull trailing '(sub task -> …)' / '(subtask: …)' out of a task title."""
    m = _INLINE_SUBTASK_RE.search(title or "")
    if not m:
        return (title or "").strip(), None
    parent = (title[: m.start()] or "").strip()
    child = (m.group(1) or "").strip()
    if not parent or not child:
        return (title or "").strip(), None
    return parent, child


def _normalize_gen_task(gt: _GenTask) -> tuple[str, list[_GenSubtask]]:
    """Ensure nested subtasks exist even when the model inlined them in the title."""
    title, inline = _split_inline_subtask((gt.title or "").strip())
    subs: list[_GenSubtask] = []
    seen: set[str] = set()
    for gs in gt.subtasks or []:
        st = (gs.title or "").strip()
        if not st:
            continue
        st2, nested = _split_inline_subtask(st)
        # Subtasks cannot nest further — keep the cleaned title only.
        key = st2.lower()
        if key in seen:
            continue
        seen.add(key)
        subs.append(_GenSubtask(title=st2, description=(gs.description or "").strip()))
        if nested:
            nk = nested.lower()
            if nk not in seen:
                seen.add(nk)
                subs.append(_GenSubtask(title=nested, description=""))
    if inline:
        ik = inline.lower()
        if ik not in seen:
            subs.append(_GenSubtask(title=inline, description=""))
    return title, subs


def _preview_tasks_from_gen(tasks: list[_GenTask] | None) -> list[GeneratedTaskPreview]:
    previews: list[GeneratedTaskPreview] = []
    for gt in tasks or []:
        title, norm_subs = _normalize_gen_task(gt)
        if not title:
            continue
        subs: list[GeneratedSubtaskPreview] = []
        for gs in norm_subs:
            st = (gs.title or "").strip()
            if not st:
                continue
            subs.append(
                GeneratedSubtaskPreview(
                    key=f"st-{uuid.uuid4().hex[:10]}",
                    title=st,
                    description=(gs.description or "").strip(),
                )
            )
        previews.append(
            GeneratedTaskPreview(
                key=f"tk-{uuid.uuid4().hex[:10]}",
                title=title,
                description=(gt.description or "").strip(),
                priority=gt.priority or "Medium",
                subtasks=subs,
            )
        )
    return previews


def extract_stories_preview(
    db: Db, user_id: str, project_id: str, source_text: str
) -> ExtractStoriesPreviewOut:
    """AI extracts multiple user stories (with tasks/subtasks) from a requirements document — no persist."""
    project_logic.ensure_project_member(db, project_id, user_id)
    text = (source_text or "").strip()
    if not text:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No requirement text to analyze")

    from ai import service as ai_service
    from langchain_core.prompts import ChatPromptTemplate

    prompt = ChatPromptTemplate.from_messages(
        [
            (
                "system",
                "You split a large requirements document into distinct user stories. "
                "Each story should be independently deliverable. Prefer 2–12 stories. "
                "TITLE RULES (critical): story title must be a short label of 3–8 words "
                "(max ~60 characters). Prefer the document's own heading when present "
                "(e.g. 'User story analytics' → title 'analytics'). "
                "Never paste sentences, paragraphs, or comma-separated task lists into "
                "the title — put that detail in description / acceptance_criteria / tasks. "
                "Fill acceptance_criteria when the document implies them. "
                "For EVERY story, break it into concrete engineering tasks (2–8). "
                "Nested work MUST go in tasks[].subtasks (not as separate top-level tasks). "
                "If the document writes '(sub task -> X)', '(subtask -> X)', or "
                "'(sub task: X)', treat X as a subtask of the parent task named before "
                "the parenthesis. Example: "
                "'add clockify sync (sub task -> get api key)' → task "
                "'add clockify sync' with subtask 'get api key'. "
                "Be specific and actionable; do not invent unrelated work. "
                "Reply with a single JSON object only (no markdown fences).",
            ),
            ("human", "Requirements document:\n\n{text}"),
        ]
    )
    try:
        plan = ai_service.complete_structured(
            prompt, {"text": text[:80000]}, _ExtractPlan
        )
    except Exception as exc:
        log.exception("Extract user stories failed")
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            f"AI story extraction failed: {exc}",
        ) from exc

    if not isinstance(plan, _ExtractPlan):
        plan = _ExtractPlan.model_validate(plan)

    stories: list[ExtractedStoryPreview] = []
    for es in plan.stories or []:
        title, description = _normalize_story_title(
            es.title or "", (es.description or "").strip()
        )
        if not title:
            continue
        stories.append(
            ExtractedStoryPreview(
                key=f"us-{uuid.uuid4().hex[:10]}",
                title=title,
                description=description,
                acceptanceCriteria=(es.acceptance_criteria or "").strip(),
                priority=es.priority or "Medium",
                assigneeIds=[],
                tasks=_preview_tasks_from_gen(es.tasks),
            )
        )
    return ExtractStoriesPreviewOut(stories=stories)


def bulk_create_stories(
    db: Db, user_id: str, body: BulkCreateStoriesBody
) -> list[UserStoryOut]:
    """Create reviewed stories from an extract preview, including nested tasks/subtasks."""
    project_logic.ensure_project_member(db, body.projectId, user_id)
    created: list[UserStoryOut] = []
    for es in body.stories or []:
        title, description = _normalize_story_title(
            es.title or "", es.description or ""
        )
        if not title:
            continue
        story_out = create_story(
            db,
            user_id,
            UserStoryCreate(
                projectId=body.projectId,
                title=title,
                description=description,
                acceptanceCriteria=es.acceptanceCriteria or "",
                priority=es.priority or "Medium",
                assigneeIds=es.assigneeIds or None,
            ),
        )
        if es.tasks:
            confirm_generate_tasks(
                db,
                user_id,
                story_out.id,
                UserStoryConfirmGenerateBody(replaceGenerated=False, tasks=es.tasks),
            )
            story_out = get_story(db, user_id, story_out.id)
        created.append(story_out)
    return created
