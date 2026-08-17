"""
analytics_logic.py — Query logic for the Analytics features migrated from Driftal_Analysis.

All data comes from ZET's own SQLite tables (User, Task, TimesheetEntry, Project, etc.).
No Clockify dependency for calculations; Clockify sync is handled separately by clockify_logic.py.
"""
from __future__ import annotations

import json
import logging
from collections import defaultdict
from datetime import date, timedelta, datetime, timezone
from typing import Any

from fastapi import HTTPException, status

import crud.analytics as analytics_crud
import crud.projects as projects_crud
from database.database import Db
from database.models import (
    Project,
    ProjectMember,
    Section,
    Task,
    TaskAssignee,
    TaskTimeLog,
    TimesheetEntry,
    User,
)

log = logging.getLogger("zet.analytics")


def health_score_condition(score: int) -> str:
    """Plain-language label from internal 0–100 score. Never expose the number to users."""
    if score >= 85:
        return "Doing well"
    if score >= 70:
        return "On track"
    if score >= 50:
        return "Needs attention"
    return "At risk"


# Priority weights for rankings (Urgent maps to Critical weight in product copy).
_PRIORITY_WEIGHTS: dict[str, int] = {
    "urgent": 5,
    "critical": 5,
    "high": 3,
    "medium": 2,
    "low": 1,
}

_HIGH_PRIORITIES = frozenset({"urgent", "critical", "high"})


def _priority_weight(priority: str | None) -> int:
    if not priority:
        return 2
    return _PRIORITY_WEIGHTS.get(priority.strip().lower(), 2)


def _parse_task_due(due_val: Any) -> date | None:
    if not due_val:
        return None
    try:
        return date.fromisoformat(str(due_val)[:10])
    except (ValueError, TypeError):
        return None


def _is_active_task(task: Task) -> bool:
    # Match board: "done" (Done column) and "completed" (manager-approved) are finished.
    status_lower = (task.status or "").strip().lower()
    return status_lower not in ("completed", "cancelled", "done", "archived", "closed")


def _is_overdue_task(task: Task, today: date) -> bool:
    if not _is_active_task(task):
        return False
    due = _parse_task_due(task.due_date)
    return due is not None and due < today


def _task_in_date_range(task: Task, start: date, end: date, field: str = "completed_at") -> bool:
    raw = getattr(task, field, None)
    if not raw:
        return False
    try:
        d = date.fromisoformat(str(raw)[:10])
        return start <= d <= end
    except (ValueError, TypeError):
        return False


def _parse_created_date(task: Task) -> date | None:
    if not task.created_at:
        return None
    try:
        return date.fromisoformat(str(task.created_at)[:10])
    except (ValueError, TypeError):
        return None


def _task_relevant_to_period(task: Task, start: date, end: date) -> bool:
    """True when a task was created, due, or completed within [start, end], or still active in that window."""
    if _task_in_date_range(task, start, end):
        return True
    if not _is_active_task(task):
        return False
    due = _parse_task_due(task.due_date)
    if due and start <= due <= end:
        return True
    created = _parse_created_date(task)
    if created and start <= created <= end:
        return True
    if created and created <= end:
        if due is None:
            return True
        if due >= start:
            return True
    return False


def _filter_attention_for_period(
    rows: list[dict],
    start: date,
    end: date,
) -> list[dict]:
    out: list[dict] = []
    for r in rows:
        if r.get("attentionType") in ("blocked", "overdue_high_priority"):
            out.append(r)
            continue
        due_s = (r.get("dueDate") or "").strip()
        if not due_s:
            continue
        try:
            d = date.fromisoformat(due_s[:10])
        except ValueError:
            continue
        if start <= d <= end:
            out.append(r)
    return out


def _task_user_ids(task: Task, task_assignees: dict[str, list[str]]) -> list[str]:
    uids: set[str] = set(task_assignees.get(task.id, []))
    if task.assigned_to:
        uids.add(task.assigned_to)
    return list(uids)


def _project_status_label(overdue: int, blocked: int, high_priority: int) -> str:
    """Plain project status for UI — no numeric health score."""
    if overdue > 0 or blocked > 0:
        return "At Risk"
    if high_priority > 0:
        return "Needs Attention"
    return "On Track"


def _employee_contribution(
    user_id: str,
    all_tasks: list[Task],
    task_assignees: dict[str, list[str]],
    hours_by_user: dict[str, float],
    start_dt: date,
    end_dt: date,
    today: date,
) -> dict[str, float | int]:
    completed = 0
    priority_score = 0
    overdue_count = 0
    overdue_penalty = 0
    for t in all_tasks:
        if user_id not in _task_user_ids(t, task_assignees):
            continue
        if t.status == "completed" and _task_in_date_range(t, start_dt, end_dt):
            completed += 1
            priority_score += _priority_weight(t.priority)
        if _is_overdue_task(t, today):
            overdue_count += 1
            overdue_penalty += _priority_weight(t.priority)
    logged_h = hours_by_user.get(user_id, 0.0)
    contribution_score = max(
        0.0,
        round(priority_score * 10 + completed * 3 - overdue_penalty * 8 + min(logged_h, 80) * 0.25, 2),
    )
    return {
        "completedTasks": completed,
        "priorityScore": priority_score,
        "loggedHours": round(logged_h, 2),
        "overdueTasks": overdue_count,
        "contributionScore": contribution_score,
    }


def _needs_attention_today(
    active_tasks: list[Task],
    today: date,
    projects: dict[str, Project],
    task_assignees: dict[str, list[str]],
    users: dict[str, User],
) -> list[dict]:
    rows: list[dict] = []

    def _row(t: Task, attention_type: str) -> dict:
        proj = projects.get(t.project_id) if t.project_id else None
        uids = _task_user_ids(t, task_assignees)
        assignee = ", ".join(users[uid].name for uid in uids if uid in users) or "Unassigned"
        due = _parse_task_due(t.due_date)
        return {
            "id": t.id,
            "title": t.title,
            "priority": t.priority,
            "status": t.status,
            "dueDate": str(due or ""),
            "projectName": proj.name if proj else "—",
            "assigneeName": assignee,
            "attentionType": attention_type,
        }

    for t in active_tasks:
        if t.status == "in_progress" and _is_overdue_task(t, today):
            rows.append(_row(t, "blocked"))

    seen = {r["id"] for r in rows}
    for t in active_tasks:
        if t.id in seen:
            continue
        if _is_overdue_task(t, today) and t.priority and t.priority.strip().lower() in _HIGH_PRIORITIES:
            rows.append(_row(t, "overdue_high_priority"))
            seen.add(t.id)

    for t in active_tasks:
        if t.id in seen:
            continue
        due = _parse_task_due(t.due_date)
        if due == today:
            rows.append(_row(t, "due_today"))

    rows.sort(
        key=lambda r: (
            -_priority_weight(r["priority"]),
            r["dueDate"] or "9999",
        ),
    )
    return rows


# ── Helpers ───────────────────────────────────────────────────────────────────

def _hours(seconds: int) -> float:
    return round(seconds / 3600, 2)


def _week_label(d: date) -> str:
    """Cross-platform short week label (e.g. '5 Jun') — avoids %-d which fails on Windows."""
    return f"{d.day} {d.strftime('%b')}"


def _ts_entries_in_range(db: Db, start_date: str, end_date: str):
    return analytics_crud.timesheet_entries_in_range(db, start_date, end_date)


def _user_map(db: Db) -> dict[str, User]:
    return {u.id: u for u in analytics_crud.list_active_users(db)}


def _project_map(db: Db, project_ids: list[str] | None = None) -> dict[str, Project]:
    if project_ids is not None:
        return {p.id: p for p in analytics_crud.get_projects_by_ids(db, project_ids)}
    return {p.id: p for p in analytics_crud.list_all_projects(db)}


def _visible_project_ids(db: Db, requesting_user: User) -> set[str]:
    """Projects the viewer may see — matches /projects list rules."""
    if requesting_user.role == "superadmin":
        return {p.id for p in analytics_crud.list_all_projects(db)}
    return {p.id for p in projects_crud.list_for_member(db, requesting_user.id)}


def _visible_user_ids(db: Db, project_ids: set[str], requesting_user: User) -> set[str]:
    """Active users who belong to at least one visible project."""
    if requesting_user.role == "superadmin":
        return {u.id for u in analytics_crud.list_active_users(db)}
    if not project_ids:
        return {requesting_user.id}
    members = analytics_crud.list_project_members_for_projects(db, list(project_ids))
    visible = {m.user_id for m in members}
    visible.add(requesting_user.id)
    return visible


def _section_map(db: Db, section_ids: list[str] | None = None) -> dict[str, Section]:
    if section_ids is not None:
        return {s.id: s for s in analytics_crud.get_sections_by_ids(db, section_ids)}
    return {s.id: s for s in analytics_crud.list_all_sections(db)}


# ── Working capacity ─────────────────────────────────────────────────────────
# 9h/day × 5 days = 45 h/week (approximation; no holiday calendar)

def _capacity_hours(start_date: str, end_date: str) -> float:
    """Total working hours in a date range (Mon–Fri, 9 h/day)."""
    start = date.fromisoformat(start_date)
    end = date.fromisoformat(end_date)
    days = (end - start).days + 1
    work_days = sum(
        1 for i in range(days) if (start + timedelta(days=i)).weekday() < 5
    )
    return work_days * 9.0


# ── Organisation Tree ─────────────────────────────────────────────────────────

def _build_org_node(
    user: User,
    all_users: dict[str, User],
    hours_by_user: dict[str, float],
    active_tasks_count_by_user: dict[str, int],
    projects_by_user: dict[str, set[str]],
    children_map: dict[str, list[str]],
    capacity_h: float,
    depth: int = 0,
) -> dict:
    uid = user.id
    total_h = hours_by_user.get(uid, 0.0)
    utilization = round(total_h / capacity_h * 100, 1) if capacity_h else 0.0
    active_tasks_count = active_tasks_count_by_user.get(uid, 0)
    active_projects = projects_by_user.get(uid, set())

    # Recurse into reports
    child_ids = children_map.get(uid, [])
    child_nodes = [
        _build_org_node(
            all_users[cid], all_users, hours_by_user, active_tasks_count_by_user,
            projects_by_user, children_map, capacity_h, depth + 1,
        )
        for cid in child_ids
        if cid in all_users
    ]

    # Aggregate team size (self + all descendants)
    def _team_size(node: dict) -> int:
        return 1 + sum(_team_size(c) for c in node["children"])

    node: dict[str, Any] = {
        "id": uid,
        "name": user.name,
        "email": user.email,
        "orgRole": (user.role or "employee").upper(),
        "jobTitle": user.job_title or "",
        "managerName": all_users[user.manager_id].name if user.manager_id and user.manager_id in all_users else None,
        "metrics": {
            "teamSize": sum(_team_size(c) for c in child_nodes),
            "utilizationPercent": utilization,
            "activeTasks": active_tasks_count,
            "activeProjects": len(active_projects),
            "assignedHours": total_h,
        },
        "children": child_nodes,
    }
    return node


def get_organization_tree(db: Db, start_date: str, end_date: str, requesting_user: User) -> dict:
    """Return the org hierarchy with workforce metrics."""
    users = _user_map(db)
    entries = _ts_entries_in_range(db, start_date, end_date)
    capacity_h = _capacity_hours(start_date, end_date)

    hours_by_user: dict[str, float] = defaultdict(float)
    for e in entries:
        hours_by_user[e.user_id] += _hours(e.seconds)

    # Scoped: get active task counts directly from database
    active_tasks_count_by_user = analytics_crud.list_active_tasks_counts_by_user(db)

    # Scoped: Projects each user is a member of (only for active users)
    all_members = analytics_crud.list_project_members_for_users(db, list(users.keys()))
    projects_by_user: dict[str, set[str]] = defaultdict(set)
    for m in all_members:
        projects_by_user[m.user_id].add(m.project_id)

    # Build children map (manager_id → list of user ids)
    children_map: dict[str, list[str]] = defaultdict(list)
    for u in users.values():
        if u.manager_id:
            children_map[u.manager_id].append(u.id)

    # Root nodes: users with no manager (or manager not in active users)
    roots = [u for u in users.values() if not u.manager_id or u.manager_id not in users]

    # Role-gate: employees see only themselves; managers see their subtree; admins see all
    if requesting_user.role == "employee":
        # Return a pseudo-tree with just themselves
        roots = [u for u in roots if u.id == requesting_user.id]
        # Also check if the requesting user IS a root; if not, just wrap them
        if not roots:
            me = users.get(requesting_user.id)
            roots = [me] if me else []

    elif requesting_user.role == "manager":
        # Only show the subtree rooted at the manager
        roots = [u for u in roots if u.id == requesting_user.id]
        if not roots:
            # Manager is not a root — just show them and their reports
            me = users.get(requesting_user.id)
            roots = [me] if me else []

    tree = [
        _build_org_node(r, users, hours_by_user, active_tasks_count_by_user, projects_by_user, children_map, capacity_h)
        for r in roots
        if r is not None
    ]

    # Flat manager list for the "Managers" section
    managers = [
        {
            "id": u.id,
            "name": u.name,
            "directReports": len(children_map.get(u.id, [])),
            "metrics": {
                "teamSize": len(children_map.get(u.id, [])),
                "utilizationPercent": round(hours_by_user.get(u.id, 0) / capacity_h * 100, 1) if capacity_h else 0,
            },
        }
        for u in users.values()
        if u.role in ("manager",)
    ]

    total_users = list(users.values())
    return {
        "summary": {
            "totalEmployees": len(total_users),
            "ceos": 0,
            "managers": sum(1 for u in total_users if u.role == "manager"),
            "employees": sum(1 for u in total_users if u.role == "employee"),
        },
        "tree": tree,
        "managers": managers,
    }


# ── Employee Performance ──────────────────────────────────────────────────────

def get_employee_performance(
    db: Db,
    employee_id: str,
    requesting_user: User,
    start_date: str,
    end_date: str,
) -> dict:
    """Return hours, tasks, and project contributions for a given employee."""
    target = analytics_crud.get_active_user(db, employee_id)
    if not target:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Employee not found")

    entries = analytics_crud.timesheet_entries_for_user_in_range(
        db, employee_id, start_date, end_date
    )

    total_seconds = sum(e.seconds for e in entries)
    billable_seconds = sum(e.seconds for e in entries if e.billable)
    capacity_h = _capacity_hours(start_date, end_date)
    total_h = _hours(total_seconds)
    billable_h = _hours(billable_seconds)
    utilization_rate = round(total_h / capacity_h * 100, 1) if capacity_h else 0.0

    # Tasks
    tasks = analytics_crud.tasks_for_user_assignee(db, employee_id)[:20]
    task_total = len(tasks)

    # Hours by project
    pids = {e.project_id for e in entries if e.project_id} | {t.project_id for t in tasks if t.project_id}
    sids = {e.section_id for e in entries if e.section_id}
    project_map = _project_map(db, list(pids))
    section_map = _section_map(db, list(sids))
    hours_by_project: dict[str, dict] = {}
    for e in entries:
        proj = project_map.get(e.project_id)
        proj_name = proj.name if proj else "Unknown"
        key = e.project_id
        if key not in hours_by_project:
            hours_by_project[key] = {
                "projectId": key,
                "projectName": proj_name,
                "clientName": None,
                "totalHours": 0.0,
                "tasks": {},
            }
        hours_by_project[key]["totalHours"] += _hours(e.seconds)
        # Group by section as "task" approximation
        sec = section_map.get(e.section_id)
        sec_name = sec.name if sec else "General"
        tid = e.section_id or "general"
        if tid not in hours_by_project[key]["tasks"]:
            hours_by_project[key]["tasks"][tid] = {
                "taskId": tid,
                "taskName": sec_name,
                "loggedHours": 0.0,
                "descriptions": [],
            }
        hours_by_project[key]["tasks"][tid]["loggedHours"] += _hours(e.seconds)
        if e.description and e.description not in hours_by_project[key]["tasks"][tid]["descriptions"]:
            hours_by_project[key]["tasks"][tid]["descriptions"].append(e.description)

    project_contributions = []
    for proj_data in hours_by_project.values():
        proj_data["tasks"] = list(proj_data["tasks"].values())
        proj_data["totalHours"] = round(proj_data["totalHours"], 2)
        project_contributions.append(proj_data)
    recent_tasks = [
        {
            "id": t.id,
            "title": t.title,
            "status": t.status,
            "dueDate": t.due_date,
            "projectName": project_map.get(t.project_id, None) and project_map[t.project_id].name,
            "dependsOnTitle": None,
        }
        for t in tasks[:10]
    ]

    return {
        "employee": {"id": target.id, "name": target.name, "email": target.email},
        "hours": {
            "totalHours": total_h,
            "billableHours": billable_h,
            "utilizationRate": utilization_rate,
            "capacityHours": capacity_h,
        },
        "tasks": {"total": task_total, "recent": recent_tasks},
        "projectContributions": project_contributions,
    }


# ── Employee Roster ───────────────────────────────────────────────────────────

def get_employee_roster(
    db: Db,
    start_date: str,
    end_date: str,
    requesting_user: User,
    manager_id: str | None = None,
) -> list[dict]:
    """Return employee list with utilization metrics."""
    users = _user_map(db)
    entries = _ts_entries_in_range(db, start_date, end_date)
    capacity_h = _capacity_hours(start_date, end_date)

    hours_by_user: dict[str, float] = defaultdict(float)
    billable_by_user: dict[str, float] = defaultdict(float)
    for e in entries:
        hours_by_user[e.user_id] += _hours(e.seconds)
        if e.billable:
            billable_by_user[e.user_id] += _hours(e.seconds)

    # Filter by role
    visible_users = list(users.values())
    if requesting_user.role == "employee":
        visible_users = [u for u in visible_users if u.id == requesting_user.id]
    elif requesting_user.role == "manager":
        # Self + direct reports
        visible_users = [
            u for u in visible_users
            if u.id == requesting_user.id or u.manager_id == requesting_user.id
        ]

    if manager_id:
        visible_users = [u for u in visible_users if u.manager_id == manager_id]

    result = []
    for u in visible_users:
        total_h = hours_by_user.get(u.id, 0.0)
        billable_h = billable_by_user.get(u.id, 0.0)
        utilization = round(total_h / capacity_h * 100, 1) if capacity_h else 0.0
        manager = users.get(u.manager_id) if u.manager_id else None
        result.append({
            "employeeId": u.id,
            "employeeName": u.name,
            "email": u.email,
            "role": u.role,
            "jobTitle": u.job_title,
            "isActive": u.is_active,
            "managerId": u.manager_id,
            "managerName": manager.name if manager else None,
            "totalHours": round(total_h, 2),
            "billableHours": round(billable_h, 2),
            "utilizationRate": utilization,
            "capacityHours": capacity_h,
            "rank": 0,  # will be set below
        })

    # Sort by total hours descending and assign rank
    result.sort(key=lambda r: r["totalHours"], reverse=True)
    for i, row in enumerate(result):
        row["rank"] = i + 1

    return result


# ── Client Hours ──────────────────────────────────────────────────────────────

def get_client_hours(db: Db, start_date: str, end_date: str) -> list[dict]:
    """Aggregate time entries by client (project.description carries client name by convention).
    
    ZET's Project model does not have a dedicated client field, so we group by project 
    and expose one card per project (acting as client grouping).
    Projects can optionally prefix their name with 'ClientName / ProjectName'.
    """
    entries = _ts_entries_in_range(db, start_date, end_date)
    projects = _project_map(db)
    users = _user_map(db)

    # Group entries by project
    by_project: dict[str, dict] = {}
    total_all_hours = 0.0

    for e in entries:
        proj = projects.get(e.project_id)
        if not proj:
            continue
        h = _hours(e.seconds)
        total_all_hours += h
        pid = proj.id

        if pid not in by_project:
            # Try to extract "Client / Project" pattern from project name
            parts = proj.name.split(" / ", 1)
            client_name = parts[0].strip() if len(parts) == 2 else proj.name
            project_name = parts[1].strip() if len(parts) == 2 else proj.name

            by_project[pid] = {
                "clientId": pid,
                "clientName": client_name,
                "projectName": project_name,
                "totalHours": 0.0,
                "billableHours": 0.0,
                "contributionPercent": 0.0,
                "employeeCount": 0,
                "activeProjects": 1,
                "_employees": set(),
            }
        by_project[pid]["totalHours"] += h
        if e.billable:
            by_project[pid]["billableHours"] += h
        by_project[pid]["_employees"].add(e.user_id)

    results = []
    for data in by_project.values():
        data["employeeCount"] = len(data.pop("_employees"))
        data["totalHours"] = round(data["totalHours"], 2)
        data["billableHours"] = round(data["billableHours"], 2)
        data["contributionPercent"] = (
            round(data["totalHours"] / total_all_hours * 100, 1) if total_all_hours else 0.0
        )
        results.append(data)

    results.sort(key=lambda r: r["totalHours"], reverse=True)
    return results


# ── Who's Working On What ─────────────────────────────────────────────────────

def get_wip_data(
    db: Db,
    start_date: str,
    end_date: str,
    requesting_user: User,
    manager_id: str | None = None,
) -> dict:
    """Return per-task rows showing who is working on what."""
    users = _user_map(db)
    projects = _project_map(db)
    sections = _section_map(db)

    # Startup mode: all authenticated users see the full team on WIP.
    visible_user_ids = set(users.keys())

    if manager_id:
        team_ids = {u.id for u in users.values() if u.manager_id == manager_id} | {manager_id}
        visible_user_ids &= team_ids

    entries = analytics_crud.timesheet_entries_for_users_in_range(
        db, list(visible_user_ids), start_date, end_date
    )

    # Batch-retrieve tasks for all visible users to avoid N+1 queries
    tasks = analytics_crud.latest_tasks_for_users(db, list(visible_user_ids))
    latest_task_map: dict[tuple[str, str], Task] = {}
    for t in tasks:
        if not t.section_id or not t.assigned_to:
            continue
        t_key = (t.section_id, t.assigned_to)
        if t_key not in latest_task_map:
            latest_task_map[t_key] = t
        else:
            existing = latest_task_map[t_key]
            if (t.created_at or "") > (existing.created_at or ""):
                latest_task_map[t_key] = t

    # Build aggregated rows: (user, section/task, project) → hours
    key_map: dict[tuple, dict] = {}
    for e in entries:
        user = users.get(e.user_id)
        proj = projects.get(e.project_id)
        sec = sections.get(e.section_id)
        if not user or not proj:
            continue

        key = (e.user_id, e.project_id, e.section_id)
        if key not in key_map:
            # Try to find a task assigned to this user in this section
            task = latest_task_map.get((e.section_id, e.user_id)) if e.section_id else None
            key_map[key] = {
                "employeeName": user.name,
                "employeeId": user.id,
                "clientName": proj.name.split(" / ", 1)[0].strip(),
                "projectName": proj.name,
                "taskTitle": task.title if task else (sec.name if sec else "—"),
                "taskStatus": task.status if task else "in_progress",
                "loggedHours": 0.0,
                "billable": e.billable,
            }
        key_map[key]["loggedHours"] += _hours(e.seconds)

    rows = list(key_map.values())
    for r in rows:
        r["loggedHours"] = round(r["loggedHours"], 2)

    rows.sort(key=lambda r: (r["employeeName"], r["projectName"]))

    # Summary stats
    active_employees = len({r["employeeId"] for r in rows})
    total_hours = round(sum(r["loggedHours"] for r in rows), 2)
    clients_served = len({r["clientName"] for r in rows})
    projects_in_flight = len({r["projectName"] for r in rows})

    return {
        "summary": {
            "activeEmployees": active_employees,
            "totalHours": total_hours,
            "clientsServed": clients_served,
            "projectsInFlight": projects_in_flight,
        },
        "rows": rows,
    }


# ── Overview Dashboard ────────────────────────────────────────────────────────

def get_overview_dashboard(
    db: Db,
    start_date: str,
    end_date: str,
    requesting_user: User,
    project_id: str | None = None,
) -> dict:
    """
    Task-first executive snapshot: KPIs, project attention ranking, high-priority pending work.
    Manager/admin only — enforced at the route layer.
    Scoped to projects the viewer belongs to (admin: all projects).
    Optional project_id narrows every metric to that one project.
    """
    visible_pids = _visible_project_ids(db, requesting_user)
    if project_id:
        if project_id not in visible_pids:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Not a member of this project")
        visible_pids = {project_id}
        members = analytics_crud.list_project_members_for_projects(db, [project_id])
        visible_uids = {m.user_id for m in members}
        visible_uids.add(requesting_user.id)
    else:
        visible_uids = _visible_user_ids(db, visible_pids, requesting_user)
    all_users = _user_map(db)
    users = {uid: u for uid, u in all_users.items() if uid in visible_uids}

    entries = [
        e for e in _ts_entries_in_range(db, start_date, end_date)
        if e.project_id in visible_pids
    ]
    start_dt = date.fromisoformat(start_date)
    end_dt = date.fromisoformat(end_date)
    today = date.today()
    as_of = end_dt if end_dt < today else today

    total_h = round(_hours(sum(e.seconds for e in entries)), 2)

    all_tasks = [
        t for t in analytics_crud.list_tasks_for_overview(db, start_date, end_date)
        if t.project_id in visible_pids
    ]
    period_tasks = [t for t in all_tasks if _task_relevant_to_period(t, start_dt, end_dt)]

    pids = {t.project_id for t in period_tasks if t.project_id} | {e.project_id for e in entries if e.project_id}
    projects = _project_map(db, list(pids))

    # Scoped assignees query
    assignee_rows = analytics_crud.list_task_assignees_for_tasks(db, [t.id for t in period_tasks])
    task_assignees: dict[str, list[str]] = defaultdict(list)
    for ta in assignee_rows:
        task_assignees[ta.task_id].append(ta.user_id)

    def _assignee_names(task_id: str) -> str:
        uids = task_assignees.get(task_id, [])
        return ", ".join(users[uid].name for uid in uids if uid in users) or "Unassigned"

    active_tasks = [t for t in period_tasks if _is_active_task(t)]
    overdue_tasks = [t for t in active_tasks if _is_overdue_task(t, as_of)]
    high_priority_pending = [
        t for t in active_tasks
        if t.priority and t.priority.strip().lower() in _HIGH_PRIORITIES
    ]
    high_priority_pending.sort(
        key=lambda t: (-_priority_weight(t.priority), _parse_task_due(t.due_date) or date.max),
    )

    completed_in_period = [
        t for t in period_tasks
        if t.status == "completed" and _task_in_date_range(t, start_dt, end_dt)
    ]

    on_time = 0
    tasks_with_due = [t for t in period_tasks if t.due_date and t.status == "completed"]
    for t in tasks_with_due:
        due = _parse_task_due(t.due_date)
        if not due:
            continue
        completed = date.fromisoformat(str(t.completed_at)[:10]) if t.completed_at else today
        if completed <= due:
            on_time += 1
    on_time_pct = round(on_time / len(tasks_with_due) * 100, 1) if tasks_with_due else 100.0

    project_task_map: dict[str, list[Task]] = defaultdict(list)
    for t in period_tasks:
        if t.project_id:
            project_task_map[t.project_id].append(t)

    project_hours: dict[str, float] = defaultdict(float)
    hours_by_user: dict[str, float] = defaultdict(float)
    for e in entries:
        hours_by_user[e.user_id] += _hours(e.seconds)
        if e.project_id:
            project_hours[e.project_id] += _hours(e.seconds)

    project_cards = []
    for p in projects.values():
        tasks = project_task_map.get(p.id, [])
        if not tasks:
            continue
        total_t = len(tasks)
        done_t = sum(1 for t in tasks if t.status == "completed")
        active_t = sum(1 for t in tasks if _is_active_task(t))
        overdue_t = sum(1 for t in tasks if _is_overdue_task(t, as_of))
        progress = round(done_t / total_t * 100) if total_t else 0
        priority_score = sum(_priority_weight(t.priority) for t in tasks if _is_active_task(t))
        blocked_t = sum(
            1 for t in tasks
            if _is_active_task(t) and t.status == "in_progress" and _is_overdue_task(t, as_of)
        )
        project_cards.append({
            "id": p.id,
            "name": p.name,
            "progress": progress,
            "totalTasks": total_t,
            "completedTasks": done_t,
            "activeTasks": active_t,
            "overdueTasks": overdue_t,
            "blockedTasks": blocked_t,
            "highPriorityPending": sum(
                1 for t in tasks
                if _is_active_task(t) and t.priority and t.priority.strip().lower() in _HIGH_PRIORITIES
            ),
            "loggedHours": round(project_hours.get(p.id, 0.0), 2),
            "priorityScore": priority_score,
            "attentionScore": round(project_hours.get(p.id, 0.0) + priority_score, 2),
            "atRisk": overdue_t > 0 or blocked_t > 0,
            "statusLabel": _project_status_label(
                overdue_t,
                blocked_t,
                sum(
                    1 for t in tasks
                    if _is_active_task(t) and t.priority and t.priority.strip().lower() in _HIGH_PRIORITIES
                ),
            ),
        })
    project_cards.sort(key=lambda x: x["attentionScore"], reverse=True)

    top_projects = [
        {
            "projectId": c["id"],
            "projectName": c["name"],
            "loggedHours": c["loggedHours"],
            "activeTasks": c["activeTasks"],
            "overdueTasks": c["overdueTasks"],
            "attentionScore": c["attentionScore"],
        }
        for c in project_cards[:8]
    ]

    high_priority_rows = []
    for t in high_priority_pending[:12]:
        proj = projects.get(t.project_id) if t.project_id else None
        high_priority_rows.append({
            "id": t.id,
            "title": t.title,
            "priority": t.priority,
            "status": t.status,
            "dueDate": str(_parse_task_due(t.due_date) or ""),
            "projectName": proj.name if proj else "—",
            "assigneeName": _assignee_names(t.id),
        })

    total_tasks = len(period_tasks)
    completion_rate = len([t for t in period_tasks if t.status == "completed"]) / total_tasks * 100 if total_tasks else 100
    overdue_ratio = len(overdue_tasks) / max(len(active_tasks), 1) * 100
    on_track_score = max(0.0, 100.0 - overdue_ratio)
    health_score = round(
        completion_rate * 0.35 + on_time_pct * 0.35 + on_track_score * 0.30
    )

    weekly_trend = []
    for w in range(6, -1, -1):
        week_end = end_dt - timedelta(weeks=w)
        week_start = week_end - timedelta(days=6)
        week_entries = [
            e for e in entries
            if str(week_start) <= str(e.work_date) <= str(week_end)
        ]
        wh = round(sum(_hours(e.seconds) for e in week_entries), 2)
        completed_week = sum(
            1 for t in period_tasks
            if t.status == "completed"
            and _task_in_date_range(t, week_start, week_end)
        )
        weekly_trend.append({
            "weekLabel": _week_label(week_start),
            "completedTasks": completed_week,
            "loggedHours": wh,
        })

    top_contributors = []
    for u in users.values():
        stats = _employee_contribution(
            u.id, period_tasks, task_assignees, hours_by_user, start_dt, end_dt, as_of,
        )
        if stats["contributionScore"] <= 0 and stats["completedTasks"] == 0 and stats["loggedHours"] == 0:
            continue
        top_contributors.append({
            "userId": u.id,
            "name": u.name,
            **stats,
        })
    top_contributors.sort(key=lambda x: x["contributionScore"], reverse=True)

    needs_attention_today = _filter_attention_for_period(
        _needs_attention_today(active_tasks, as_of, projects, task_assignees, users),
        start_dt,
        end_dt,
    )

    return {
        "healthScore": health_score,
        "kpis": {
            "totalLoggedHours": total_h,
            "activeTasks": len(active_tasks),
            "completedTasks": len(completed_in_period),
            "overdueTasks": len(overdue_tasks),
            "highPriorityPending": len(high_priority_pending),
            "activeProjects": len([p for p in project_cards if p["activeTasks"] > 0]),
            "onTimeCompletionPct": on_time_pct,
            "totalTeam": len(users),
        },
        "weeklyTrend": weekly_trend,
        "topContributors": top_contributors[:5],
        "needsAttentionToday": needs_attention_today[:20],
        "topProjectsByAttention": top_projects,
        "highPriorityPending": high_priority_rows,
        "projectProgress": project_cards[:12],
    }


# ── Timesheet Analytics ───────────────────────────────────────────────────────

def get_timesheet_analytics(
    db: Db,
    start_date: str,
    end_date: str,
    requesting_user: User,
    target_user_id: str | None = None,
) -> dict:
    """
    Per-user analytics over a date range:
    - Weekly hours trend
    - Billable vs non-billable by day
    - Day-of-week distribution
    - Project contribution
    - Overtime detection (>9h/day)
    - Summary KPIs
    """
    # Scope resolution — startup mode: any authenticated user may view any employee.
    uid = target_user_id or requesting_user.id
    entries = analytics_crud.timesheet_entries_for_user_in_range(
        db, uid, start_date, end_date
    )

    projects = _project_map(db)
    capacity_h = _capacity_hours(start_date, end_date)

    total_h = _hours(sum(e.seconds for e in entries))
    billable_h = _hours(sum(e.seconds for e in entries if e.billable))
    non_billable_h = round(total_h - billable_h, 2)

    # ── Day breakdown ──────────────────────────────────────────────────────────
    hours_by_day: dict[str, dict] = {}
    hours_by_dow: dict[int, float] = defaultdict(float)  # 0=Mon…6=Sun
    project_hours: dict[str, float] = defaultdict(float)
    project_names: dict[str, str] = {}

    for e in entries:
        d = e.work_date
        h = _hours(e.seconds)
        if d not in hours_by_day:
            hours_by_day[d] = {"date": d, "totalHours": 0.0, "billableHours": 0.0, "overtime": False}
        hours_by_day[d]["totalHours"] += h
        if e.billable:
            hours_by_day[d]["billableHours"] += h
        # day-of-week
        try:
            dow = date.fromisoformat(str(d)).weekday()
            hours_by_dow[dow] += h
        except (ValueError, TypeError):
            pass
        # project
        if e.project_id:
            project_hours[e.project_id] += h
            if e.project_id not in project_names:
                proj = projects.get(e.project_id)
                project_names[e.project_id] = proj.name if proj else "Unknown"

    # Mark overtime days (>9h)
    overtime_days = []
    for day_data in hours_by_day.values():
        if day_data["totalHours"] > 9.0:
            day_data["overtime"] = True
            overtime_days.append({
                "date": day_data["date"],
                "hours": round(day_data["totalHours"], 2),
                "overtime": round(day_data["totalHours"] - 9.0, 2),
            })
        day_data["totalHours"] = round(day_data["totalHours"], 2)
        day_data["billableHours"] = round(day_data["billableHours"], 2)

    daily_list = sorted(hours_by_day.values(), key=lambda x: x["date"])

    # ── Weekly trend ───────────────────────────────────────────────────────────
    end_dt = date.fromisoformat(end_date)
    start_dt = date.fromisoformat(start_date)
    weekly_trend = []
    cur = start_dt
    while cur <= end_dt:
        week_end = min(cur + timedelta(days=6), end_dt)
        week_entries = [e for e in entries if str(cur) <= str(e.work_date) <= str(week_end)]
        wh = _hours(sum(e.seconds for e in week_entries))
        wb = _hours(sum(e.seconds for e in week_entries if e.billable))
        weekly_trend.append({
            "weekStart": str(cur),
            "weekLabel": _week_label(cur),
            "totalHours": round(wh, 2),
            "billableHours": round(wb, 2),
            "nonBillableHours": round(wh - wb, 2),
        })
        cur += timedelta(weeks=1)

    # ── Day of week distribution ───────────────────────────────────────────────
    dow_labels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    dow_distribution = [
        {"day": dow_labels[i], "hours": round(hours_by_dow.get(i, 0.0), 2)}
        for i in range(7)
    ]

    # ── Project contribution ───────────────────────────────────────────────────
    project_contribution = sorted(
        [
            {
                "projectId": pid,
                "projectName": project_names.get(pid, pid),
                "hours": round(h, 2),
                "pct": round(h / total_h * 100, 1) if total_h else 0.0,
            }
            for pid, h in project_hours.items()
        ],
        key=lambda x: x["hours"],
        reverse=True,
    )

    avg_daily = round(total_h / max(len(hours_by_day), 1), 2)
    utilization_rate = round(total_h / capacity_h * 100, 1) if capacity_h else 0.0

    return {
        "summary": {
            "totalHours": round(total_h, 2),
            "billableHours": round(billable_h, 2),
            "nonBillableHours": non_billable_h,
            "billablePct": round(billable_h / total_h * 100, 1) if total_h else 0.0,
            "avgDailyHours": avg_daily,
            "utilizationRate": utilization_rate,
            "capacityHours": round(capacity_h, 2),
            "overtimeDays": len(overtime_days),
        },
        "dailyBreakdown": daily_list,
        "weeklyTrend": weekly_trend,
        "dowDistribution": dow_distribution,
        "projectContribution": project_contribution,
        "overtimeDays": overtime_days,
    }


# ── Delivery Risk ─────────────────────────────────────────────────────────────

def get_delivery_risk(db: Db, requesting_user: User) -> dict:
    """
    Project status: overdue tasks, blockers, single-person projects, progress by project.
    Manager/admin only — enforced at the route layer.
    """
    today = date.today()
    users = _user_map(db)

    # Scoped: get project progress stats directly from SQL group-by
    progress_stats = analytics_crud.get_project_progress_stats(db, str(today))

    # Scoped: get only tasks requiring attention (overdue or high priority)
    attention_tasks = analytics_crud.get_attention_tasks(db, str(today))

    # Scoped: get assignees for attention tasks only
    assignee_rows = analytics_crud.list_task_assignees_for_tasks(db, [t.id for t in attention_tasks])
    task_assignees: dict[str, list[str]] = defaultdict(list)
    for ta in assignee_rows:
        task_assignees[ta.task_id].append(ta.user_id)

    # Scoped: get projects referenced by stats or attention tasks
    pids = {stats["project_id"] for stats in progress_stats if stats["project_id"]} | {t.project_id for t in attention_tasks if t.project_id}
    projects = _project_map(db, list(pids))

    def _assignee_names(task_id: str) -> str:
        uids = task_assignees.get(task_id, [])
        return ", ".join(users[uid].name for uid in uids if uid in users) or "Unassigned"

    def _task_row(t: Task, days_overdue: int) -> dict:
        return {
            "id": t.id,
            "title": t.title,
            "dueDate": str(_parse_task_due(t.due_date) or ""),
            "assigneeName": _assignee_names(t.id),
            "status": t.status,
            "priority": t.priority,
            "daysOverdue": days_overdue,
        }

    overdue = []
    for t in attention_tasks:
        due = _parse_task_due(t.due_date)
        if due and due < today:
            overdue.append(_task_row(t, (today - due).days))
    overdue.sort(key=lambda x: x["daysOverdue"], reverse=True)

    blocked = [row for row in overdue if row["status"] == "in_progress"]

    high_priority_pending = []
    for t in attention_tasks:
        if t.priority and t.priority.strip().lower() in _HIGH_PRIORITIES:
            proj = projects.get(t.project_id) if t.project_id else None
            high_priority_pending.append({
                "id": t.id,
                "title": t.title,
                "priority": t.priority,
                "status": t.status,
                "dueDate": str(_parse_task_due(t.due_date) or ""),
                "projectName": proj.name if proj else "—",
                "assigneeName": _assignee_names(t.id),
                "isOverdue": _is_overdue_task(t, today),
            })
    high_priority_pending.sort(
        key=lambda x: (-_priority_weight(x["priority"]), x["dueDate"] or "9999"),
    )

    proj_contributors: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    start30 = str(today - timedelta(days=30))
    recent_entries = _ts_entries_in_range(db, start30, str(today))
    for e in recent_entries:
        if e.project_id:
            proj_contributors[e.project_id][e.user_id] += _hours(e.seconds)

    dependency_risks = []
    for proj_id, contrib in proj_contributors.items():
        proj = projects.get(proj_id)
        if not proj or len(contrib) > 1:
            continue
        sole_uid, sole_hours = list(contrib.items())[0]
        sole_name = users.get(sole_uid, type("U", (), {"name": "Unknown"})()).name
        total = sum(contrib.values())
        dependency_risks.append({
            "projectId": proj_id,
            "projectName": proj.name,
            "soleContributor": sole_name,
            "loggedHours": round(sole_hours, 2),
            "contributionPercent": 100.0,
            "totalHours": round(total, 2),
        })
    dependency_risks.sort(key=lambda x: x["loggedHours"], reverse=True)

    project_progress = []
    for stats in progress_stats:
        p = projects.get(stats["project_id"])
        if not p:
            continue
        total_t = stats["total_tasks"]
        done_t = stats["completed_tasks"]
        active_t = stats["active_tasks"]
        overdue_t = stats["overdue_tasks"]
        blocked_t = stats["blocked_tasks"]
        high_pri = stats["high_priority_pending"]
        project_progress.append({
            "id": p.id,
            "name": p.name,
            "progress": round(done_t / total_t * 100) if total_t else 0,
            "totalTasks": total_t,
            "completedTasks": done_t,
            "activeTasks": active_t,
            "overdueTasks": overdue_t,
            "blockedTasks": blocked_t,
            "highPriorityPending": high_pri,
            "atRisk": overdue_t > 0 or blocked_t > 0,
            "statusLabel": _project_status_label(overdue_t, blocked_t, high_pri),
        })
    project_progress.sort(key=lambda x: (x["overdueTasks"], x["highPriorityPending"]), reverse=True)

    # Scoped: count total active tasks in the system
    active_tasks_count = analytics_crud.count_active_tasks(db)

    needs_attention_today = _needs_attention_today(
        attention_tasks, today, projects, task_assignees, users,
    )

    return {
        "summary": {
            "overdueTasks": len(overdue),
            "blockedTasks": len(blocked),
            "dependencyRisks": len(dependency_risks),
            "activeTasks": active_tasks_count,
            "highPriorityPending": len(high_priority_pending),
            "projectsInProgress": len([p for p in project_progress if p["activeTasks"] > 0]),
        },
        "needsAttentionToday": needs_attention_today[:20],
        "overdueTasks": overdue[:15],
        "blockedTasks": blocked[:10],
        "dependencyRisks": dependency_risks[:10],
        "highPriorityPending": high_priority_pending[:15],
        "projectProgress": project_progress[:20],
    }
