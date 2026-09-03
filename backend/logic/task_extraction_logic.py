"""Task-extraction chain: turn typed text, an uploaded document, or recorded/uploaded
audio into structured tasks (with suggested assignees, project, section, priority, due
date) via the AI parser. DB access is delegated to the existing logic/crud layers."""

import io

from fastapi import HTTPException, status

import crud.projects as projects_crud
import crud.users as users_crud
from ai import chains, service
from ai.schemas import ParseTaskResponse, ProjectRef, SectionRef, UserRef
from logic import project_logic

AUDIO_EXT = {"mp3", "wav", "m4a", "webm", "ogg", "oga", "flac", "mp4", "mpeg", "mpga", "aac"}
PLAIN_TEXT_EXT = {"txt", "md", "markdown", "csv", "log", "rtf", ""}


def _ext(filename: str | None) -> str:
    if not filename or "." not in filename:
        return ""
    return filename.rsplit(".", 1)[-1].lower()


def _document_text(data: bytes, filename: str) -> str:
    ext = _ext(filename)
    if ext == "doc":
        raise ValueError("Old .doc files aren't supported. Save as .docx or PDF and try again.")
    if ext == "pdf":
        from pypdf import PdfReader

        reader = PdfReader(io.BytesIO(data))
        return "\n".join((page.extract_text() or "") for page in reader.pages).strip()
    if ext == "docx":
        from docx import Document
        from docx.table import Table
        from docx.text.paragraph import Paragraph

        doc = Document(io.BytesIO(data))
        # Walk the body in document order so tables (where week/task/assignee/project
        # columns usually live) are captured inline, not silently dropped. Table rows
        # are rendered pipe-delimited so the LLM sees which assignee/project each row names.
        parts: list[str] = []
        for child in doc.element.body.iterchildren():
            if child.tag.endswith("}p"):
                parts.append(Paragraph(child, doc).text)
            elif child.tag.endswith("}tbl"):
                for row in Table(child, doc).rows:
                    parts.append(" | ".join(c.text.strip() for c in row.cells))
        return "\n".join(parts).strip()
    if ext in PLAIN_TEXT_EXT:
        return data.decode("utf-8", "ignore").strip()
    # Unknown type — best-effort decode.
    return data.decode("utf-8", "ignore").strip()


def _refs(db, user_id: str) -> tuple[list[UserRef], list[ProjectRef]]:
    users_by_id = {
        u.id: UserRef(
            id=u.id,
            name=u.name,
            job_title=getattr(u, "job_title", "") or "",
            current_experience_months=getattr(u, "experience_months", 0) or 0,
        )
        for u in users_crud.list_all(db)
    }
    users = list(users_by_id.values())
    projects = [
        ProjectRef(
            id=p.id,
            name=p.name,
            sections=[SectionRef(id=s.id, name=s.name) for s in p.sections],
            # Members of this project — the only people a task in it may be assigned to.
            members=[users_by_id[mid] for mid in projects_crud.member_ids(db, p.id) if mid in users_by_id],
        )
        for p in project_logic.list_projects(db, user_id)
    ]
    return users, projects


MAX_DOCS = 8


def _file_text(data: bytes, name: str) -> str:
    if _ext(name) in AUDIO_EXT:
        return service.transcribe(data, name or "audio.webm").strip()
    return _document_text(data, name or "").strip()


def resolve_source(
    db,
    user_id: str,
    *,
    text: str | None = None,
    file_bytes: bytes | None = None,
    filename: str | None = None,
    files: list[tuple[bytes, str]] | None = None,
) -> str:
    """Resolve pasted text and one or more documents to a single source string."""
    if not project_logic.is_managerial(db, user_id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only managers and admins can create tasks this way.")
    docs: list[tuple[bytes, str]] = []
    if file_bytes:
        docs.append((file_bytes, filename or "upload"))
    docs.extend(files or [])
    docs = [(data, name) for data, name in docs if data][:MAX_DOCS]
    pasted = (text or "").strip()
    chunks: list[str] = []
    if pasted:
        chunks.append(pasted)
    # ponytail: one outline over concatenated docs, not N extract chains
    named = bool(pasted and docs) or len(docs) > 1
    for data, name in docs:
        try:
            body = _file_text(data, name)
        except ValueError as exc:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
        if not body:
            continue
        chunks.append(f"===== {name} =====\n{body}" if named else body)
    return "\n\n".join(chunks).strip()


def extract_tasks(
    db,
    user_id: str,
    *,
    text: str | None = None,
    file_bytes: bytes | None = None,
    filename: str | None = None,
) -> tuple[str, ParseTaskResponse]:
    """Resolve the input to text (transcribe audio / read document / use typed text),
    then run the AI task parser. Returns (source_text, parsed tasks)."""
    source = resolve_source(db, user_id, text=text, file_bytes=file_bytes, filename=filename)
    if not source:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Nothing to extract — type a description, upload a document, or record audio.",
        )
    users, projects = _refs(db, user_id)
    result = chains.parse_task(source, users, projects)
    return source, result
