"""CV / résumé skill extraction logic.

Text extraction mirrors the approach in task_extraction_logic._document_text().
The extracted text is sent to the LLM via ai.service.complete_structured().
If no AI provider is available, a heuristic keyword extractor is used instead.
"""

from __future__ import annotations

import io

from fastapi import HTTPException, status
from langchain_core.prompts import ChatPromptTemplate
from pydantic import BaseModel, Field

from logic import user_logic

# ── Constants ─────────────────────────────────────────────────────────────────

MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB
MAX_TEXT_CHARS = 20_000           # truncate before sending to LLM
MAX_SKILLS = 60

SUPPORTED_EXT = {"pdf", "docx", "doc", "txt", "md", "rtf"}

# ── File-type helpers ─────────────────────────────────────────────────────────


def _ext(filename: str | None) -> str:
    if not filename or "." not in filename:
        return ""
    return filename.rsplit(".", 1)[-1].lower()


def extract_text_from_bytes(filename: str | None, content: bytes) -> str:
    """Parse PDF / DOCX / plain-text bytes into a raw string."""
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "File exceeds 10 MB limit")

    ext = _ext(filename)

    if ext == "pdf":
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(content))
        return "\n".join((page.extract_text() or "") for page in reader.pages).strip()

    if ext in ("docx", "doc"):
        from docx import Document
        from docx.table import Table
        from docx.text.paragraph import Paragraph
        doc = Document(io.BytesIO(content))
        parts: list[str] = []
        for child in doc.element.body.iterchildren():
            if child.tag.endswith("}p"):
                parts.append(Paragraph(child, doc).text)
            elif child.tag.endswith("}tbl"):
                for row in Table(child, doc).rows:
                    parts.append(" | ".join(c.text.strip() for c in row.cells))
        return "\n".join(parts).strip()

    # Plain text fallback (txt, md, rtf, unknown)
    return content.decode("utf-8", "ignore").strip()


# ── LLM schema ────────────────────────────────────────────────────────────────

class _SkillList(BaseModel):
    skills: list[str] = Field(
        default_factory=list,
        description=(
            "Concise skill names extracted from the resume, "
            "e.g. 'Python', 'React', 'Project Management'"
        ),
    )


_PROMPT = ChatPromptTemplate.from_messages([
    (
        "system",
        (
            "You are an expert resume parser. Given the text of a resume or CV, "
            "extract every professional skill, technology, tool, language, framework, "
            "methodology, or domain expertise mentioned. "
            "Return only a JSON object with a 'skills' list. "
            "Each entry must be a concise, normalised skill name (1-4 words). "
            "Omit duplicates and very generic words like 'communication' unless clearly "
            "listed as a dedicated skill section entry. "
            "Return at most {max_skills} skills."
        ),
    ),
    ("human", "Resume text:\n\n{text}"),
])


# ── Heuristic fallback ────────────────────────────────────────────────────────

# A broad set of common skill keywords for offline / no-key environments.
_SKILL_KEYWORDS = {
    "python", "javascript", "typescript", "java", "kotlin", "swift", "go", "rust",
    "c++", "c#", "ruby", "php", "scala", "r", "matlab", "sql", "nosql",
    "react", "vue", "angular", "next.js", "nuxt", "svelte",
    "node.js", "fastapi", "django", "flask", "spring", "express",
    "aws", "azure", "gcp", "docker", "kubernetes", "terraform", "ansible",
    "git", "linux", "bash", "powershell",
    "postgresql", "mysql", "mongodb", "redis", "elasticsearch",
    "machine learning", "deep learning", "nlp", "data science", "data analysis",
    "pandas", "numpy", "scikit-learn", "tensorflow", "pytorch",
    "rest api", "graphql", "grpc", "microservices", "ci/cd",
    "agile", "scrum", "kanban", "jira", "figma", "photoshop",
    "product management", "project management", "ux design", "ui design",
    "excel", "tableau", "power bi", "looker",
}


def _heuristic_extract(text: str) -> list[str]:
    """Simple keyword search — used when no LLM is available."""
    lower = text.lower()
    found: list[str] = []
    for kw in sorted(_SKILL_KEYWORDS):
        if kw in lower:
            found.append(" ".join(w.capitalize() for w in kw.split()))
    return found[:MAX_SKILLS]


# ── Public API ────────────────────────────────────────────────────────────────


def extract_skills_from_text(text: str) -> list[str]:
    """Call the LLM to extract skills. Falls back to heuristic on any error."""
    truncated = text[:MAX_TEXT_CHARS]
    try:
        from ai import service as ai_service
        result: _SkillList = ai_service.complete_structured(
            _PROMPT,
            {"text": truncated, "max_skills": MAX_SKILLS},
            _SkillList,
        )
        return list(dict.fromkeys(s.strip() for s in result.skills if s.strip()))[:MAX_SKILLS]
    except Exception:
        # No provider configured or transient error — use the heuristic.
        return _heuristic_extract(text)


def parse_cv_and_extract_skills(
    db,
    manager_id: str,
    filename: str | None,
    content: bytes,
) -> list[str]:
    """Entry point called by the route: validate caller, parse file, extract skills."""
    u = user_logic.get_user_or_404(db, manager_id)
    if u.role not in ("manager", "superadmin"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Manager only")

    ext = _ext(filename)
    if ext and ext not in SUPPORTED_EXT:
        raise HTTPException(
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            f"Unsupported file type '{ext}'. Accepted: {', '.join(sorted(SUPPORTED_EXT))}",
        )

    text = extract_text_from_bytes(filename, content)
    if not text:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Could not read any text from the uploaded file",
        )

    return extract_skills_from_text(text)
