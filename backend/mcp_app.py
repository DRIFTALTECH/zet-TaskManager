"""
Embedded MCP server — runs INSIDE the FastAPI backend, same process and port.

Mounted at `/mcp`, it exposes ZET to MCP clients (Claude, Cursor, …). Tools call
the logic layer directly (in-process) — no HTTP loopback — so they go through the
same logic → crud path and inherit every permission/visibility rule.

Auth (OAuth 2.1 resource-server model): a ZET personal access token is the bearer
credential. `PATVerifier` validates it and resolves it to a user; FastMCP then
exposes the standard protected-resource metadata. The token may also be passed as
`?token=...` on the URL (promoted to an Authorization header by middleware) so a
single copy-paste URL works in any client.
"""

from urllib.parse import parse_qs

from fastmcp import FastMCP
from fastmcp.server.auth import AccessToken, TokenVerifier
from fastmcp.server.dependencies import get_access_token

import crud.users as users_crud
from database.database import SessionLocal
from oauth_provider import oauth_provider
from logic import (
    meeting_notes_logic,
    project_logic,
    task_logic,
    timesheet_logic,
    token_logic,
    user_logic,
)
from logic.schemas import (
    ScrumCreate,
    SectionCreate,
    TaskCreate,
    TaskMoveBody,
    TimesheetEntryCreate,
    TimesheetEntryPatch,
)


# ── Auth: validate ZET personal access tokens as OAuth bearer tokens ──────────

class PATVerifier(TokenVerifier):
    async def verify_token(self, token: str) -> AccessToken | None:
        if not token:
            return None
        db = SessionLocal()
        try:
            user_id = token_logic.resolve_user_id(db, token)
        finally:
            db.close()
        if not user_id:
            return None
        return AccessToken(token=token, client_id=user_id, scopes=[])


mcp = FastMCP(
    name="ZET",
    instructions=(
        "Tools for the ZET task manager: find employees and projects, manage project "
        "membership, read/update timesheets, log work, manage tasks, and post daily scrums. "
        "Names resolve to IDs automatically; ambiguous names return candidates to choose from. "
        "Call `whoami` first — manager/admin-only actions fail for employees."
    ),
    # Full OAuth 2.1 flow (browser login) + manual PATs both validate via this provider.
    auth=oauth_provider,
)


# ── Helpers ────────────────────────────────────────────────────────────────────

def _uid() -> str:
    tok = get_access_token()
    if not tok or not tok.client_id:
        raise ValueError("Not authenticated — supply a valid ZET token.")
    return tok.client_id


def _find_project(db, uid: str, name_or_id: str):
    projects = project_logic.list_projects(db, uid)
    for p in projects:
        if p.id == name_or_id:
            return p
    q = name_or_id.lower()
    matches = [p for p in projects if q in p.name.lower()]
    if len(matches) == 1:
        return matches[0]
    if not matches:
        raise ValueError(f"No project matches '{name_or_id}'. You have: {[p.name for p in projects]}")
    raise ValueError(f"'{name_or_id}' is ambiguous — matches: {[p.name for p in matches]}.")


def _find_user(db, name_or_id: str):
    users = users_crud.list_all(db)
    for u in users:
        if u.id == name_or_id:
            return u
    q = name_or_id.lower()
    matches = [u for u in users if q in u.name.lower() or q in u.email.lower()]
    if len(matches) == 1:
        return matches[0]
    if not matches:
        raise ValueError(f"No employee matches '{name_or_id}'.")
    raise ValueError(f"'{name_or_id}' is ambiguous — matches: {[u.name + ' <' + u.email + '>' for u in matches]}.")


def _resolve_section(db, uid: str, project, name: str, create: bool = False):
    for s in project.sections:
        if s.name.lower() == name.lower():
            return s
    partial = [s for s in project.sections if name.lower() in s.name.lower()]
    if len(partial) == 1:
        return partial[0]
    if create and name.strip():
        updated = project_logic.add_section(db, uid, project.id, SectionCreate(name=name.strip()))
        for s in updated.sections:
            if s.name.lower() == name.strip().lower():
                return s
    return None


# ── Identity ──────────────────────────────────────────────────────────────────

@mcp.tool
def whoami() -> dict:
    """Return the current user (whose token this is) and their role."""
    db = SessionLocal()
    try:
        u = users_crud.get_by_id(db, _uid())
        if not u:
            raise ValueError("User not found")
        return user_logic.to_user_out(db, u).model_dump()
    finally:
        db.close()


# ── People & projects ──────────────────────────────────────────────────────────

@mcp.tool
def find_employees(query: str = "") -> list[dict]:
    """Find employees by name, email, or role (e.g. 'manager'). Empty lists everyone."""
    db = SessionLocal()
    try:
        users = users_crud.list_all(db)
        q = query.lower()
        if query:
            users = [u for u in users if q in u.name.lower() or q in u.email.lower() or q == u.role]
        return [{"id": u.id, "name": u.name, "email": u.email, "role": u.role} for u in users]
    finally:
        db.close()


@mcp.tool
def list_projects() -> list[dict]:
    """List projects visible to the current user (admins see all; others their own)."""
    db = SessionLocal()
    try:
        return [{"id": p.id, "name": p.name, "members": len(p.members), "sections": len(p.sections)}
                for p in project_logic.list_projects(db, _uid())]
    finally:
        db.close()


@mcp.tool
def get_project(project: str) -> dict:
    """Full detail for one project (by name or id): members and sections."""
    db = SessionLocal()
    try:
        p = _find_project(db, _uid(), project)
        by = {u.id: u for u in users_crud.list_all(db)}
        return {
            "id": p.id, "name": p.name, "description": p.description,
            "members": [{"id": m, "name": getattr(by.get(m), "name", m), "role": getattr(by.get(m), "role", "")} for m in p.members],
            "sections": [{"id": s.id, "name": s.name} for s in p.sections],
        }
    finally:
        db.close()


@mcp.tool
def assign_user_to_project(employee: str, project: str) -> dict:
    """Add an employee to a project (manager/admin only)."""
    db = SessionLocal()
    try:
        uid = _uid()
        p = _find_project(db, uid, project)
        u = _find_user(db, employee)
        project_logic.add_member(db, uid, p.id, u.id)
        return {"ok": True, "message": f"Added {u.name} to {p.name}."}
    finally:
        db.close()


@mcp.tool
def remove_user_from_project(employee: str, project: str) -> dict:
    """Remove an employee from a project (manager/admin only)."""
    db = SessionLocal()
    try:
        uid = _uid()
        p = _find_project(db, uid, project)
        u = _find_user(db, employee)
        project_logic.remove_member(db, uid, p.id, u.id)
        return {"ok": True, "message": f"Removed {u.name} from {p.name}."}
    finally:
        db.close()


# ── Sections ───────────────────────────────────────────────────────────────────

@mcp.tool
def list_sections(project: str) -> list[dict]:
    """List a project's existing sections. Prefer reusing these over creating new ones."""
    db = SessionLocal()
    try:
        p = _find_project(db, _uid(), project)
        return [{"id": s.id, "name": s.name} for s in p.sections]
    finally:
        db.close()


@mcp.tool
def create_section(project: str, name: str) -> dict:
    """Create a new section in a project. Use only when no existing section fits."""
    db = SessionLocal()
    try:
        uid = _uid()
        p = _find_project(db, uid, project)
        updated = project_logic.add_section(db, uid, p.id, SectionCreate(name=name.strip()))
        return {"ok": True, "sections": [{"id": s.id, "name": s.name} for s in updated.sections]}
    finally:
        db.close()


# ── Timesheet ──────────────────────────────────────────────────────────────────

@mcp.tool
def get_timesheet(start: str, end: str, employee: str = "") -> list[dict]:
    """Timesheet entries between start and end (YYYY-MM-DD). Leave employee empty for
    your own; managers/admins may pass an employee name to view someone else's."""
    db = SessionLocal()
    try:
        uid = _uid()
        if employee:
            u = _find_user(db, employee)
            rows = timesheet_logic.list_entries_as_manager(db, uid, u.id, start, end)
        else:
            rows = timesheet_logic.list_entries(db, uid, start, end)
        return [r.model_dump() for r in rows]
    finally:
        db.close()


@mcp.tool
def log_work(
    date: str,
    project: str,
    description: str,
    section: str = "",
    time_from: str = "09:00",
    time_to: str = "10:00",
    create_section_if_missing: bool = False,
) -> dict:
    """Log a timesheet entry. date: YYYY-MM-DD; time_from/time_to: HH:MM (24h).
    A section is required — if it doesn't exist this returns available_sections so you
    can pick one; only set create_section_if_missing=true when none fit."""
    db = SessionLocal()
    try:
        uid = _uid()
        p = _find_project(db, uid, project)
        available = [s.name for s in p.sections]
        if not section:
            return {"needs_section": True, "available_sections": available,
                    "message": "A section is required. Pick one of available_sections (or pass a new name with create_section_if_missing=true)."}
        sec = _resolve_section(db, uid, p, section, create=create_section_if_missing)
        if not sec:
            return {"needs_section": True, "available_sections": available,
                    "message": f"No section matches '{section}'. Choose from available_sections, or set create_section_if_missing=true."}
        body = TimesheetEntryCreate(
            workDate=date, projectId=p.id, sectionId=sec.id,
            description=description, timeFrom=time_from, timeTo=time_to,
        )
        return timesheet_logic.create_entry(db, uid, body).model_dump()
    finally:
        db.close()


@mcp.tool
def update_timesheet_entry(entry_id: str, date: str = "", description: str = "", time_from: str = "", time_to: str = "") -> dict:
    """Update fields of an existing timesheet entry (only provided fields change)."""
    db = SessionLocal()
    try:
        patch = TimesheetEntryPatch(
            workDate=date or None, description=description or None,
            timeFrom=time_from or None, timeTo=time_to or None,
        )
        return timesheet_logic.patch_entry(db, _uid(), entry_id, patch).model_dump()
    finally:
        db.close()


@mcp.tool
def delete_timesheet_entry(entry_id: str) -> dict:
    """Delete a timesheet entry by id."""
    db = SessionLocal()
    try:
        timesheet_logic.delete_entry(db, _uid(), entry_id)
        return {"ok": True, "message": "Entry deleted."}
    finally:
        db.close()


# ── Tasks ──────────────────────────────────────────────────────────────────────

@mcp.tool
def list_my_tasks() -> list[dict]:
    """Tasks currently assigned to the current user."""
    db = SessionLocal()
    try:
        uid = _uid()
        return [{"id": t.id, "title": t.title, "status": t.status, "priority": t.priority,
                 "projectId": t.projectId, "dueDate": t.dueDate}
                for t in task_logic.list_tasks(db, uid) if uid in t.assigneeIds]
    finally:
        db.close()


@mcp.tool
def list_project_tasks(project: str) -> list[dict]:
    """All tasks in a project (by name or id)."""
    db = SessionLocal()
    try:
        uid = _uid()
        p = _find_project(db, uid, project)
        return [{"id": t.id, "title": t.title, "status": t.status, "priority": t.priority,
                 "assigneeIds": t.assigneeIds, "dueDate": t.dueDate}
                for t in task_logic.list_tasks(db, uid) if t.projectId == p.id]
    finally:
        db.close()


@mcp.tool
def create_task(
    project: str,
    section: str,
    title: str,
    description: str = "",
    assignees: list[str] | None = None,
    due_date: str = "",
    priority: str = "Medium",
) -> dict:
    """Create a task in a project section. assignees = names/ids (defaults to you).
    priority: Urgent | High | Medium | Low."""
    db = SessionLocal()
    try:
        uid = _uid()
        p = _find_project(db, uid, project)
        sec = _resolve_section(db, uid, p, section, create=True)
        if not sec:
            raise ValueError("A valid section is required.")
        ids = [_find_user(db, a).id for a in (assignees or [])] or [uid]
        body = TaskCreate(
            title=title, description=description, projectId=p.id, sectionId=sec.id,
            assigneeIds=ids, assignedBy=uid, createdBy=uid, dueDate=due_date,
            priority=priority, tags=[],
        )
        return task_logic.create_task_action(db, uid, body).model_dump()
    finally:
        db.close()


@mcp.tool
def move_task(task_id: str, status: str) -> dict:
    """Move a task to a status/column (backlog, in_progress, in_review, done)."""
    db = SessionLocal()
    try:
        return task_logic.move_task_action(db, _uid(), task_id, TaskMoveBody(status=status)).model_dump()
    finally:
        db.close()


# ── Daily scrum / minutes of meeting ───────────────────────────────────────────

@mcp.tool
def add_scrum(date: str, notes: str, title: str = "Daily Scrum") -> dict:
    """Post a scrum for a day (YYYY-MM-DD). Notes are AI-parsed into a per-person breakdown."""
    db = SessionLocal()
    try:
        return meeting_notes_logic.create_scrum(db, date, ScrumCreate(title=title, rawText=notes), _uid()).model_dump()
    finally:
        db.close()


# ── ASGI plumbing: promote ?token= to a Bearer header, then serve MCP ─────────

class _QueryTokenToHeader:
    """If no Authorization header is present but a `?token=` query param is, inject it
    as a Bearer header so a single copy-paste MCP URL authenticates."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") == "http":
            headers = scope.get("headers") or []
            has_auth = any(k == b"authorization" for k, _ in headers)
            if not has_auth:
                token = parse_qs(scope.get("query_string", b"").decode()).get("token", [None])[0]
                if token:
                    scope = dict(scope)
                    scope["headers"] = list(headers) + [(b"authorization", f"Bearer {token}".encode())]
        await self.app(scope, receive, send)


def build_mcp_asgi():
    """Return (asgi_app, lifespan) to mount under /mcp in the FastAPI app.

    stateless_http=True so the server holds no per-connection session state — this
    avoids "Session not found" when a client reconnects after idle, or across a
    reload/restart/worker."""
    http_app = mcp.http_app(path="/", transport="http", stateless_http=True)
    return _QueryTokenToHeader(http_app), http_app.lifespan
