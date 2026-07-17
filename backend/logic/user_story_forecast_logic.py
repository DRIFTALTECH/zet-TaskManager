"""
user_story_forecast_logic.py — User-story due-date forecast (separate from task forecast).

Same scheduling / risk / reassignment conditions as task_forecast_logic, but the work
unit is user stories (not tasks). Endpoints and UI stay separate so the two do not overlap.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta
from typing import Any

import crud.analytics as analytics_crud
import crud.skills as skills_crud
import crud.user_stories as stories_crud
import crud.user_story_assignees as story_assignees_crud
from database.database import Db
from database.models import User, UserStory
from logic.analytics_logic import (
    _parse_task_due,
    _priority_weight,
    _user_map,
    _visible_project_ids,
    _visible_user_ids,
)
from logic.task_forecast_logic import (
    RISK_CRITICAL,
    RISK_HEALTHY,
    RISK_HIGH,
    RISK_MODERATE,
    _build_deadline_forecast,
    _build_workload_reassignments,
    _dedupe_rows_by_work_item,
    _employee_workload_profile,
    _simulate_queue,
)


def _scoped_active_stories(
    db: Db, requesting_user: User
) -> tuple[set[str], set[str], list[UserStory]]:
    visible_pids = _visible_project_ids(db, requesting_user)
    visible_uids = _visible_user_ids(db, visible_pids, requesting_user)
    active_stories = stories_crud.list_active_for_projects(db, list(visible_pids))
    return visible_pids, visible_uids, active_stories


def _story_user_ids(story: UserStory, story_assignees: dict[str, list[str]]) -> list[str]:
    uids: set[str] = set(story_assignees.get(story.id, []))
    if story.assignee_id:
        uids.add(story.assignee_id)
    return list(uids)


def _queue_for_user(
    user_id: str,
    active_stories: list[UserStory],
    story_assignees: dict[str, list[str]],
) -> list[dict[str, Any]]:
    """Build a schedule queue; keys match task helpers (taskId = story id)."""
    items: list[dict[str, Any]] = []
    for s in active_stories:
        if user_id not in _story_user_ids(s, story_assignees):
            continue
        due = _parse_task_due(s.due_date)
        if due is None:
            continue
        items.append({
            "taskId": s.id,
            "title": s.title,
            "due": due,
            "priority": s.priority,
            "status": s.status,
            "projectId": s.project_id,
            "sectionId": s.section_id,
            "assignedTo": s.assignee_id,
        })
    items.sort(key=lambda x: (x["due"], -_priority_weight(x["priority"])))
    return items


def _story_as_task_compat(story: UserStory) -> Any:
    """Duck-type adapter so workload reassignment helpers can read story fields."""

    class _Compat:
        id = story.id
        title = story.title
        description = story.description or ""
        status = story.status
        priority = story.priority
        due_date = story.due_date
        assigned_to = story.assignee_id
        is_started = False

    return _Compat()


def _relabel_task_wording(text: str) -> str:
    if not text:
        return text
    return (
        text.replace("earlier tasks", "earlier user stories")
        .replace("open tasks", "open user stories")
        .replace("in-progress task", "in-progress user story")
        .replace("This task", "This user story")
        .replace("this task", "this user story")
        .replace("this one", "this user story")
    )


def _relabel_forecast_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """Keep response shape identical to task forecast; fix user-facing reason copy."""
    for deadline in payload.get("deadlines") or []:
        for detail in deadline.get("tasks") or []:
            if detail.get("reason"):
                detail["reason"] = _relabel_task_wording(detail["reason"])
        for detail in deadline.get("delayedTaskDetails") or []:
            if detail.get("reason"):
                detail["reason"] = _relabel_task_wording(detail["reason"])
    return payload


def get_user_story_due_forecast(
    db: Db,
    requesting_user: User,
    start_date: str | None = None,
    end_date: str | None = None,
) -> dict[str, Any]:
    """Same conditions as get_task_due_forecast; work items are user stories only."""
    today = date.today()
    try:
        start_dt = date.fromisoformat(start_date) if start_date else today - timedelta(days=30)
    except ValueError:
        start_dt = today - timedelta(days=30)
    try:
        end_dt = date.fromisoformat(end_date) if end_date else today + timedelta(days=30)
    except ValueError:
        end_dt = today + timedelta(days=30)
    if end_dt < start_dt:
        start_dt, end_dt = end_dt, start_dt

    users = _user_map(db)
    visible_pids, visible, active_stories = _scoped_active_stories(db, requesting_user)
    active_stories = [
        s for s in active_stories
        if (due := _parse_task_due(s.due_date)) is not None and start_dt <= due <= end_dt
    ]
    known_skills = [sk.name for sk in skills_crud.list_all(db)]
    user_skills = skills_crud.skill_names_by_user_ids(db, list(visible))
    # No story-level required-skills table yet — infer from title/description only.
    story_skills_map: dict[str, list[str]] = {}
    story_descriptions = {s.id: (s.description or "") for s in active_stories}

    active_pids = {s.project_id for s in active_stories if s.project_id} & visible_pids
    projects = {p.id: p for p in analytics_crud.get_projects_by_ids(db, list(active_pids))}
    section_ids = list({s.section_id for s in active_stories if s.section_id})
    sections = {s.id: s for s in analytics_crud.get_sections_by_ids(db, section_ids)}

    story_assignees = story_assignees_crud.map_user_ids_for_stories(
        db, [s.id for s in active_stories]
    )

    queues: dict[str, list[dict[str, Any]]] = {}
    for uid in visible:
        queues[uid] = _queue_for_user(uid, active_stories, story_assignees)

    employees: list[dict[str, Any]] = []
    all_story_rows: list[dict[str, Any]] = []
    profiles: dict[str, dict[str, Any]] = {}

    for uid in sorted(visible, key=lambda i: users[i].name if i in users else i):
        user = users.get(uid)
        if not user:
            continue
        q = queues[uid]
        if not q:
            profiles[uid] = _employee_workload_profile(uid, [], [], today)
            employees.append({
                "userId": uid,
                "name": user.name,
                "role": user.role,
                "nextAvailableDate": str(today),
                "taskCount": 0,
                "highCriticalCount": 0,
                "dueTomorrow": 0,
                "workloadStatus": "Available",
                "tasks": [],
            })
            continue
        next_available, simulated = _simulate_queue(q, today)
        profiles[uid] = _employee_workload_profile(uid, q, simulated, today)
        story_rows: list[dict[str, Any]] = []
        for row in simulated:
            proj = projects.get(row["projectId"]) if row.get("projectId") else None
            sec = sections.get(row["sectionId"]) if row.get("sectionId") else None
            tr = {
                "taskId": row["taskId"],
                "title": row["title"],
                "dueDate": str(row["due"]),
                "projectId": row.get("projectId"),
                "projectName": proj.name if proj else None,
                "sectionId": row.get("sectionId"),
                "sectionName": sec.name if sec else None,
                "priority": row["priority"],
                "status": row["status"],
                "scheduledStartDate": row["scheduledStartDate"],
                "predictedCompletionDate": row["predictedCompletionDate"],
                "slipDays": row["slipDays"],
                "risk": row["risk"],
                "assigneeId": uid,
                "assigneeName": user.name,
            }
            story_rows.append(tr)
            all_story_rows.append(tr)

        employees.append({
            "userId": uid,
            "name": user.name,
            "role": user.role,
            "nextAvailableDate": str(next_available),
            "taskCount": len(story_rows),
            "highCriticalCount": profiles[uid]["highCriticalCount"],
            "dueTomorrow": profiles[uid]["dueTomorrow"],
            "workloadStatus": (
                "Overloaded" if profiles[uid]["isOverloaded"]
                else "Available" if profiles[uid]["isAvailable"]
                else "Balanced"
            ),
            "tasks": story_rows,
        })

    unique_story_rows = _dedupe_rows_by_work_item(all_story_rows)

    deadlines, deadline_summary = _build_deadline_forecast(
        unique_story_rows, queues, visible, users, today,
        task_descriptions=story_descriptions,
        task_skills_map=story_skills_map,
        user_skills=user_skills,
        known_skills=known_skills,
    )

    available_ids = {uid for uid, p in profiles.items() if p["isAvailable"]}
    compat_stories = [_story_as_task_compat(s) for s in active_stories]
    reassignments = _build_workload_reassignments(
        compat_stories, unique_story_rows, profiles, available_ids, queues, users, today,
        task_skills_map=story_skills_map,
        user_skills=user_skills,
        known_skills=known_skills,
    )

    heavy_workload = [
        {
            "userId": uid,
            "name": users[uid].name,
            "taskCount": profiles[uid]["taskCount"],
            "highCriticalCount": profiles[uid]["highCriticalCount"],
            "dueTomorrow": profiles[uid]["dueTomorrow"],
            "maxSlipDays": profiles[uid]["maxSlipDays"],
        }
        for uid in sorted(visible, key=lambda i: users[i].name if i in users else i)
        if uid in users and profiles.get(uid, {}).get("isOverloaded")
    ]
    next_available_by_user = {e["userId"]: e["nextAvailableDate"] for e in employees}
    available_capacity = [
        {
            "userId": uid,
            "name": users[uid].name,
            "taskCount": profiles[uid]["taskCount"],
            "nextAvailableDate": next_available_by_user.get(uid, str(today)),
        }
        for uid in sorted(visible, key=lambda i: users[i].name if i in users else i)
        if uid in users and profiles.get(uid, {}).get("isAvailable")
    ]

    counts = {RISK_HEALTHY: 0, RISK_MODERATE: 0, RISK_HIGH: 0, RISK_CRITICAL: 0}
    for tr in unique_story_rows:
        counts[tr["risk"]] = counts.get(tr["risk"], 0) + 1

    on_track = deadline_summary["onTrackTasks"]
    at_risk = deadline_summary["atRiskTasks"]
    delayed = deadline_summary["delayedTasks"]

    import crud.forecast_visibility as fv_crud
    hidden_ids = fv_crud.list_hidden_entities(db, requesting_user.id, "user_story")

    for d in deadlines:
        for t in d.get("tasks", []) or d.get("delayedTaskDetails", []):
            t["hidden"] = t.get("taskId") in hidden_ids
    for r in reassignments:
        r["hidden"] = r.get("taskId") in hidden_ids

    payload = {
        "asOf": str(today),
        "level": "user_story",
        "dateRange": {"startDate": str(start_dt), "endDate": str(end_dt)},
        "summary": {
            "totalTasks": len(unique_story_rows),
            "healthy": counts[RISK_HEALTHY],
            "moderate": counts[RISK_MODERATE],
            "high": counts[RISK_HIGH],
            "critical": counts[RISK_CRITICAL],
            "atRisk": at_risk,
            "onTrackTasks": on_track,
            "reassignmentCount": len(reassignments),
            "reassignmentSuggestions": len(reassignments),
            "upcomingDeadlines": deadline_summary["deadlinesTracked"],
            "heavyWorkloadCount": len(heavy_workload),
            "availableCapacityCount": len(available_capacity),
            **deadline_summary,
        },
        "prediction": {
            "onTrackTasks": on_track,
            "atRiskTasks": at_risk,
            "delayedTasks": delayed,
            "upcomingDeadlines": deadline_summary["deadlinesTracked"],
            "deadlinesAtRisk": deadline_summary["deadlinesAtRisk"],
        },
        "workload": {
            "heavy": heavy_workload,
            "available": available_capacity,
        },
        "employees": employees,
        "deadlines": deadlines,
        "reassignments": reassignments,
    }
    return _relabel_forecast_payload(payload)
