"""PRD extract chain: document/text → user stories + tasks. Preview only.

Nothing is written until the client Accepts a card. People are never assigned.
"""
from __future__ import annotations

import uuid

from fastapi import HTTPException, status

from ai import chains
from ai.schemas import PrdExtractedStory, PrdExtractResponse, ProjectRef, SectionRef
from logic.schemas import ExtractedStoryPreview, ExtractStoriesPreviewOut, GeneratedTaskPreview
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


def _task_previews(story: PrdExtractedStory) -> list[GeneratedTaskPreview]:
    out: list[GeneratedTaskPreview] = []
    for t in story.tasks or []:
        title = (t.title or "").strip()
        if not title:
            continue
        out.append(
            GeneratedTaskPreview(
                key=f"tk-{uuid.uuid4().hex[:10]}",
                title=title,
                description=(t.description or "").strip(),
                priority=(t.priority or "Medium").strip() or "Medium",
                assign=False,
                subtasks=[],
            )
        )
    return out


def _to_preview(
    story: PrdExtractedStory, projects: list[ProjectRef]
) -> ExtractedStoryPreview | None:
    title, description = _normalize_story_title(
        story.title or "", (story.description or "").strip()
    )
    if not title:
        return None
    project, _section = match_project_section(
        projects,
        story.project_id,
        story.project_name,
        None,
        None,
    )
    return ExtractedStoryPreview(
        key=f"us-{uuid.uuid4().hex[:10]}",
        title=title,
        description=description,
        acceptanceCriteria=(story.acceptance_criteria or "").strip(),
        priority=(story.priority or "Medium").strip() or "Medium",
        assigneeIds=[],
        tasks=_task_previews(story),
        projectId=project.id if project else None,
        sectionId=None,
        projectName=project.name if project else (story.project_name or None),
        sectionName=None,
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
    try:
        raw = chains.extract_prd(source[:80000], projects)
    except Exception as exc:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            f"AI story extraction failed: {exc}",
        ) from exc
    if not isinstance(raw, PrdExtractResponse):
        raw = PrdExtractResponse.model_validate(raw)

    stories: list[ExtractedStoryPreview] = []
    for es in raw.stories or []:
        preview = _to_preview(es, projects)
        if preview:
            stories.append(preview)
    return source, ExtractStoriesPreviewOut(stories=stories)
