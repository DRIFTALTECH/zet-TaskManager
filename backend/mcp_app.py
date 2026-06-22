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

import base64
import mimetypes
from urllib.parse import parse_qs

from fastmcp import FastMCP
from fastmcp.exceptions import ToolError
from fastmcp.server.auth import AccessToken, TokenVerifier
from fastmcp.server.dependencies import get_access_token
from fastmcp.server.middleware import Middleware

import crud.users as users_crud
from database.database import SessionLocal
from oauth_provider import oauth_provider
from logic import (
    attachment_logic,
    checklist_logic,
    meeting_notes_logic,
    project_logic,
    task_feedback_logic,
    task_logic,
    timer_logic,
    timesheet_logic,
    token_logic,
    user_logic,
)
from logic.schemas import (
    ScrumCreate,
    SectionCreate,
    TaskChecklistCreate,
    TaskChecklistPatch,
    TaskCreate,
    TaskFeedbackCreate,
    TaskMoveBody,
    TaskPatch,
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
        "membership, read/update timesheets, log work, manage tasks, post daily scrums, "
        "and work tasks end-to-end. Names resolve to IDs automatically; ambiguous names "
        "return candidates to choose from. Call `whoami` first — manager/admin-only "
        "actions fail for employees.\n"
        "\n"
        "THE BOARD COLUMNS ARE A STATE MACHINE. A task's column tells you what to do, and "
        "you move it to signal where it is. The columns: backlog, in_progress, testing, "
        "in_review, done.\n"
        "  • backlog  = not started.\n"
        "  • in_progress = you are actively working on it right now.\n"
        "  • testing  = you are writing tests/scripts derived from the task's title & "
        "description, running them, and fixing what fails — looping until everything passes.\n"
        "  • in_review = your work is done; you've posted a summary and are waiting for the "
        "user. The user either approves (→ done) or moves it back to in_progress for rework.\n"
        "  • done = the user confirmed it's good.\n"
        "\n"
        "DEFAULT WORKING STYLE (do this automatically — never ask whether to use a command or "
        "whether to sync to ZET; keeping ZET in sync is your job, not a choice you offer):\n"
        "• 'What am I working on / my tasks' → `list_my_tasks`, grouped by status.\n"
        "• 'Work on / pick up / do <task>' → run the loop below. The ZET updates (move, timer, "
        "checklist, comment, attach) happen silently and automatically — never present them as "
        "options:\n"
        "  1. `get_task` for the full spec.\n"
        "  2. IMMEDIATELY `move_task` → in_progress and `start_timer`, before any doc/code. Post "
        "the plan via `add_task_comment` ('**Plan (Claude):**') and add each step with "
        "`add_checklist_item`.\n"
        "  3. The ONLY pause for the user is before substantial CODE changes to their repo: post "
        "the plan, get a quick confirm. A doc/analysis IS the work — just do it.\n"
        "  4. Do the work; tick each step with `set_checklist_item` as you finish.\n"
        "  5. If the task involves code, `move_task` → testing, then write MULTIPLE test scripts "
        "from the title/description, run them for real, fix every failure, and re-run — LOOP "
        "until all pass. Post progress comments as you iterate. Never claim success on a failing "
        "build.\n"
        "  6. The moment a deliverable exists (doc, diff, test output), `upload_task_attachment` "
        "it (e.g. plan.md, changes.diff, test-output.txt) and post a '**Done (Claude):**' summary "
        "via `add_task_comment`. Attaching is automatic — don't ask.\n"
        "  7. `stop_timer` (auto-logs; if too little, `log_work`), then `move_task` → in_review "
        "and ask the user ONLY to REVIEW. If they approve → `move_task` done. If they ask for "
        "changes (or move it back to in_progress), pick it up again from step 2.\n"
        "Rules: relay permission errors plainly (board moves are assignee-only; comments need "
        "project membership); never fabricate results; never offer a 'sync to ZET / keep "
        "building' menu — the sync is already done. The user must be able to reconstruct "
        "everything you did from the task's checklist, comments, and attachments alone."
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


def _caller_role() -> str | None:
    """Resolve the calling user's role (admin/manager/employee) from their token,
    or None if the caller can't be identified. Used to filter the tool list."""
    try:
        tok = get_access_token()
    except Exception:
        return None
    uid = tok.client_id if tok else None
    if not uid:
        return None
    db = SessionLocal()
    try:
        u = users_crud.get_by_id(db, uid)
        return u.role if u else None
    finally:
        db.close()


# Tools that require a managerial role no matter the project. Hidden from the tool
# list for employees, and blocked at call-time as defence-in-depth (the logic layer
# is still the real gate — these tools call ensure_manager internally).
_MANAGER_ONLY_TOOLS = {"assign_user_to_project", "remove_user_from_project"}


class RoleToolFilter(Middleware):
    """Per-request, per-role tool exposure.

    `on_list_tools` removes manager-only tools from an employee's advertised tool
    set so their client never even offers a tool the caller can't use. `on_call_tool`
    re-checks in case a client calls a tool it was never shown."""

    async def on_list_tools(self, context, call_next):
        tools = await call_next(context)
        if _caller_role() in ("manager", "admin"):
            return tools
        return [t for t in tools if t.name not in _MANAGER_ONLY_TOOLS]

    async def on_call_tool(self, context, call_next):
        name = getattr(context.message, "name", None)
        if name in _MANAGER_ONLY_TOOLS and _caller_role() not in ("manager", "admin"):
            raise ToolError("This action requires a manager or admin role.")
        return await call_next(context)


# Register role-aware tool exposure now that the middleware class exists.
mcp.add_middleware(RoleToolFilter())


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


def _find_task(db, uid: str, name_or_id: str):
    """Resolve a task by id or (unique) title — scoped to tasks the caller can see."""
    tasks = task_logic.list_tasks(db, uid)
    for t in tasks:
        if t.id == name_or_id:
            return t
    q = name_or_id.lower()
    matches = [t for t in tasks if q in t.title.lower()]
    if len(matches) == 1:
        return matches[0]
    if not matches:
        raise ValueError(f"No task matches '{name_or_id}'.")
    raise ValueError(f"'{name_or_id}' is ambiguous — matches: {[t.title for t in matches]}.")


def _resolve_checklist_item(db, task_id: str, item: str):
    items = checklist_logic.list_for_task(db, task_id)
    for c in items:
        if c.id == item:
            return c
    q = item.lower()
    matches = [c for c in items if q in c.title.lower()]
    if len(matches) == 1:
        return matches[0]
    if not matches:
        raise ValueError(f"No checklist item matches '{item}'.")
    raise ValueError(f"'{item}' is ambiguous — matches: {[c.title for c in matches]}.")


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


# ── Work-on-a-task loop: detail, planning, progress, artifacts, time ────────────
# These let an assistant read a task fully, post a plan, track steps as a checklist,
# write a summary of what changed, attach artifacts, and log the time it took.

@mcp.tool
def get_task(task_id: str) -> dict:
    """Full detail for one task (by id or title): description, status, priority,
    assignees, due date — PLUS its checklist, comment thread, and attachments.
    Call this first when you start working on a task; it's everything you need to plan."""
    db = SessionLocal()
    try:
        uid = _uid()
        t = _find_task(db, uid, task_id)
        detail = task_logic.get_task(db, uid, t.id).model_dump()
        detail["checklist"] = [c.model_dump() for c in checklist_logic.list_for_task(db, t.id)]
        detail["comments"] = [f.model_dump() for f in task_feedback_logic.list_feedback(db, uid, t.id)]
        detail["attachments"] = [a.model_dump() for a in attachment_logic.list_for_task(db, t.id)]
        return detail
    finally:
        db.close()


@mcp.tool
def update_task(task_id: str, description: str = "", priority: str = "", title: str = "") -> dict:
    """Update a task's description, priority (Urgent|High|Medium|Low) and/or title.
    Only non-empty fields change. Use `move_task` for board status, not this."""
    db = SessionLocal()
    try:
        uid = _uid()
        t = _find_task(db, uid, task_id)
        patch = TaskPatch(
            description=description or None,
            priority=priority or None,
            title=title or None,
        )
        return task_logic.patch_task_action(db, uid, t.id, patch).model_dump()
    finally:
        db.close()


@mcp.tool
def add_task_comment(task_id: str, message: str) -> dict:
    """Post a comment on a task's thread. Use this to share your PLAN before starting,
    progress updates as you go, and a final summary of WHAT CHANGED. Visible to the
    task's members in the app."""
    db = SessionLocal()
    try:
        uid = _uid()
        t = _find_task(db, uid, task_id)
        return task_feedback_logic.create_feedback_action(
            db, uid, t.id, TaskFeedbackCreate(message=message)
        ).model_dump()
    finally:
        db.close()


@mcp.tool
def list_task_comments(task_id: str) -> list[dict]:
    """Read a task's comment thread (chronological)."""
    db = SessionLocal()
    try:
        uid = _uid()
        t = _find_task(db, uid, task_id)
        return [f.model_dump() for f in task_feedback_logic.list_feedback(db, uid, t.id)]
    finally:
        db.close()


@mcp.tool
def add_checklist_item(task_id: str, title: str, priority: str = "Medium") -> dict:
    """Add a checklist item (one step) to a task. Lay out your plan as checklist items,
    then mark each done with `set_checklist_item` as you complete it — the user watches
    the steps tick off live on the card."""
    db = SessionLocal()
    try:
        uid = _uid()
        t = _find_task(db, uid, task_id)
        return checklist_logic.create(
            db, t.id, TaskChecklistCreate(title=title, priority=priority), uid
        ).model_dump()
    finally:
        db.close()


@mcp.tool
def set_checklist_item(task_id: str, item: str, done: bool = True, title: str = "") -> dict:
    """Update a checklist item (by id or title text): tick it done/undone, and/or rename it."""
    db = SessionLocal()
    try:
        uid = _uid()
        t = _find_task(db, uid, task_id)
        target = _resolve_checklist_item(db, t.id, item)
        patch = TaskChecklistPatch(isDone=done, title=title or None)
        return checklist_logic.patch(db, t.id, target.id, patch, uid).model_dump()
    finally:
        db.close()


@mcp.tool
def list_checklist(task_id: str) -> list[dict]:
    """List a task's checklist items with their done state."""
    db = SessionLocal()
    try:
        uid = _uid()
        t = _find_task(db, uid, task_id)
        return [c.model_dump() for c in checklist_logic.list_for_task(db, t.id)]
    finally:
        db.close()


@mcp.tool
def upload_task_attachment(task_id: str, filename: str, content: str = "", content_base64: str = "") -> dict:
    """Attach a file to a task — e.g. your `plan.md`, a git diff/patch, or test output.
    Pass UTF-8 text in `content` (for markdown/diff/logs) OR base64 bytes in
    `content_base64`. The filename extension determines the content type. Max 20 MB."""
    db = SessionLocal()
    try:
        uid = _uid()
        t = _find_task(db, uid, task_id)
        if content_base64:
            raw = base64.b64decode(content_base64)
        elif content:
            raw = content.encode("utf-8")
        else:
            raise ValueError("Provide either `content` (text) or `content_base64`.")
        ctype = mimetypes.guess_type(filename)[0] or ("text/plain" if content else "application/octet-stream")
        return attachment_logic.upload(db, t.id, uid, filename, ctype, raw).model_dump()
    finally:
        db.close()


@mcp.tool
def start_timer(task_id: str) -> dict:
    """Start a server-side work timer on a task (marks it started). Call `stop_timer`
    when done to auto-log the elapsed time to your timesheet."""
    db = SessionLocal()
    try:
        uid = _uid()
        t = _find_task(db, uid, task_id)
        return timer_logic.start(db, uid, t.id).model_dump()
    finally:
        db.close()


@mcp.tool
def stop_timer(task_id: str) -> dict:
    """Stop the running timer on a task; the elapsed time is logged to your timesheet
    automatically. Returns the updated task."""
    db = SessionLocal()
    try:
        uid = _uid()
        t = _find_task(db, uid, task_id)
        return timer_logic.stop(db, uid, t.id).model_dump()
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
