"""PRD extract chain: document/text → detailed user stories (preview only).

Nothing is written until the client Accepts a story. Stories are assigned to
project members when the model (or fallback) can pick a real member.
"""
from __future__ import annotations

import uuid

from fastapi import HTTPException, status

from ai import chains
from ai.schemas import PrdExtractedStory, PrdExtractResponse, ProjectRef, SectionRef, UserRef
from logic.schemas import ExtractedStoryPreview, ExtractStoriesPreviewOut
from logic.task_extraction_logic import _refs, resolve_source
from logic.user_story_logic import _normalize_story_title


def match_project_section(
    projects: list[ProjectRef],
    project_id: str | None,
    project_name: str | None,
    section_id: str | None,
    section_name: str | None,
) -> tuple[ProjectRef | None, SectionRef | None]:
    """Resolve model ids/names onto a real project + section. Never invent ids."""
    project = None
    pid = (project_id or "").strip()
    pname = (project_name or "").strip().lower()
    if pid:
        project = next((p for p in projects if p.id == pid), None)
    if project is None and pname:
        project = next((p for p in projects if (p.name or "").lower() == pname), None)
        if project is None:
            project = next(
                (
                    p
                    for p in projects
                    if pname in (p.name or "").lower() or (p.name or "").lower() in pname
                ),
                None,
            )
    if project is None and len(projects) == 1:
        project = projects[0]

    section = None
    if project:
        secs = project.sections or []
        sid = (section_id or "").strip()
        sname = (section_name or "").strip().lower()
        if sid:
            section = next((s for s in secs if s.id == sid), None)
        if section is None and sname:
            section = next((s for s in secs if (s.name or "").lower() == sname), None)
            if section is None:
                section = next(
                    (
                        s
                        for s in secs
                        if sname in (s.name or "").lower() or (s.name or "").lower() in sname
                    ),
                    None,
                )
        if section is None and len(secs) == 1:
            section = secs[0]
    return project, section


def snap_assignee_ids(
    assignee_id: str | None,
    assignee_name: str | None,
    members: list[UserRef],
) -> list[str]:
    """Keep only real project members. Invented IDs are dropped."""
    if not members:
        return []
    by_id = {m.id: m for m in members}
    aid = (assignee_id or "").strip()
    if aid in by_id:
        return [aid]
    name = (assignee_name or "").strip().lower()
    if not name:
        return []
    exact = next((m for m in members if (m.name or "").strip().lower() == name), None)
    if exact:
        return [exact.id]
    partial = next(
        (m for m in members if name in (m.name or "").lower() or (m.name or "").lower() in name),
        None,
    )
    return [partial.id] if partial else []


def ensure_story_assignee(
    assignee_id: str | None,
    assignee_name: str | None,
    members: list[UserRef],
    *,
    round_robin_index: int = 0,
) -> list[str]:
    """Story owner: named/id match first; otherwise round-robin a member."""
    ids = snap_assignee_ids(assignee_id, assignee_name, members)
    if ids or not members:
        return ids
    m = members[round_robin_index % len(members)]
    return [m.id]


def members_of(projects: list[ProjectRef], project_id: str | None) -> list[UserRef]:
    project = next((p for p in projects if p.id == project_id), None) if project_id else None
    if project is None and len(projects) == 1:
        project = projects[0]
    return list(project.members or []) if project else []


def _to_preview(
    story: PrdExtractedStory,
    projects: list[ProjectRef],
    *,
    round_robin_index: int = 0,
) -> ExtractedStoryPreview | None:
    title, description = _normalize_story_title(
        story.title or "", (story.description or "").strip()
    )
    if not title:
        title = " ".join((story.title or "").split())[:80] or "Untitled story"
    project, section = match_project_section(
        projects,
        story.project_id,
        story.project_name,
        getattr(story, "section_id", None),
        getattr(story, "section_name", None),
    )
    members = list(project.members or []) if project else []
    story_ids = ensure_story_assignee(
        getattr(story, "assignee_id", None),
        getattr(story, "assignee_name", None),
        members,
        round_robin_index=round_robin_index,
    )
    tags = [str(t).strip() for t in (getattr(story, "tags", None) or []) if str(t).strip()]
    return ExtractedStoryPreview(
        key=f"us-{uuid.uuid4().hex[:10]}",
        title=title,
        description=description,
        acceptanceCriteria=(story.acceptance_criteria or "").strip(),
        priority=(story.priority or "Medium").strip() or "Medium",
        assigneeIds=story_ids,
        tasks=[],
        projectId=project.id if project else None,
        sectionId=section.id if section else None,
        projectName=project.name if project else (story.project_name or None),
        sectionName=section.name if section else (getattr(story, "section_name", None) or None),
        estimatedHours=getattr(story, "estimated_hours", None),
        storyPoints=getattr(story, "story_points", None),
        startDate=getattr(story, "start_date", None) or None,
        dueDate=getattr(story, "due_date", None) or None,
        sprint=(getattr(story, "sprint", None) or "") or "",
        tags=tags,
    )


def extract_prd(
    db,
    user_id: str,
    *,
    text: str | None = None,
    file_bytes: bytes | None = None,
    filename: str | None = None,
) -> tuple[str, ExtractStoriesPreviewOut]:
    """Resolve PRD/text, run the extract chain, return a preview (not persisted)."""
    source = resolve_source(db, user_id, text=text, file_bytes=file_bytes, filename=filename)
    if not source:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Nothing to extract — paste a PRD or upload a document.",
        )
    _users, projects = _refs(db, user_id)
    stories: list[ExtractedStoryPreview] = []
    outlined = []
    try:
        outlined = list(chains.outline_prd(source[:80000], projects).stories or [])
    except Exception:
        outlined = []
    if outlined:
        for i, shell in enumerate(outlined):
            raw_story = PrdExtractedStory(
                title=shell.title,
                description=shell.description,
                acceptance_criteria=shell.acceptance_criteria,
                priority=shell.priority or "Medium",
                project_id=shell.project_id,
                project_name=shell.project_name,
                assignee_id=getattr(shell, "assignee_id", None),
                assignee_name=getattr(shell, "assignee_name", None),
                tasks=[],
            )
            preview = _to_preview(raw_story, projects, round_robin_index=i)
            if preview:
                stories.append(preview)
        return source, ExtractStoriesPreviewOut(stories=stories)

    try:
        raw = chains.extract_prd(source[:80000], projects)
    except Exception as exc:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            f"AI story extraction failed: {exc}",
        ) from exc
    if not isinstance(raw, PrdExtractResponse):
        raw = PrdExtractResponse.model_validate(raw)
    for i, es in enumerate(raw.stories or []):
        preview = _to_preview(es, projects, round_robin_index=i)
        if preview:
            stories.append(preview)
    return source, ExtractStoriesPreviewOut(stories=stories)
