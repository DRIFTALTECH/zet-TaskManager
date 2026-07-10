"""
task_forecast_logic.py — Task due-date forecast (no LLM, no project completion).

Per employee: incomplete assigned tasks sorted by due date, sequential schedule.
Risk when assignee is still occupied past a task's due date.
Reassignment suggestions for high/critical slip only.
"""
from __future__ import annotations

import random
from collections import defaultdict
from datetime import date, timedelta
from typing import Any

import crud.analytics as analytics_crud
import crud.skills as skills_crud
from database.database import Db
from database.models import Project, Task, TaskAssignee, User
from logic.analytics_logic import (
    _HIGH_PRIORITIES,
    _is_active_task,
    _parse_task_due,
    _priority_weight,
    _task_user_ids,
    _user_map,
    _visible_project_ids,
    _visible_user_ids,
)

RISK_HEALTHY = "healthy"
RISK_MODERATE = "moderate"
RISK_HIGH = "high"
RISK_CRITICAL = "critical"

_LOW_PRIORITIES = frozenset({"low", "medium"})
_REASSIGN_NEVER_STATUSES = frozenset({"completed", "cancelled", "done", "blocked"})
_REASSIGN_PREFER_STATUSES = frozenset({"backlog", "todo"})
_HEAVY_TASK_THRESHOLD = 6
_HEAVY_HIGH_CRITICAL_THRESHOLD = 2
_AVAILABLE_TASK_THRESHOLD = 3

_RISK_ORDER = (RISK_HEALTHY, RISK_MODERATE, RISK_HIGH, RISK_CRITICAL)

_DISPLAY_RISK = {
    RISK_HEALTHY: "Healthy",
    RISK_MODERATE: "Moderate",
    RISK_HIGH: "High",
    RISK_CRITICAL: "Critical",
}

_PREDICTED_ON_TRACK = "On Track"
_PREDICTED_AT_RISK = "At Risk"
_PREDICTED_DELAYED = "Delayed"

# ── Recommendation engine (extensible scoring) ────────────────────────────────

_FACTOR_SKILL = "skill"
_FACTOR_AVAILABILITY = "availability"

# Inactive placeholders — wire weights when implemented; UI reads factors[] as-is.
_FUTURE_FACTORS: tuple[tuple[str, str], ...] = (
    ("pastProjectExperience", "Past Project Experience"),
    ("performanceScore", "Performance Score"),
    ("clientExperience", "Client Experience"),
    ("certifications", "Certifications"),
)

_ACTIVE_FACTOR_WEIGHTS: dict[str, float] = {
    _FACTOR_AVAILABILITY: 0.50,
    _FACTOR_SKILL: 0.50,
}


def _infer_skills_from_text(
    title: str,
    description: str,
    known_skills: list[str],
) -> list[str]:
    """Match org skill names that appear in the task title or description."""
    text = f"{title or ''} {description or ''}".lower()
    if not text.strip() or not known_skills:
        return []

    matched: list[str] = []
    seen: set[str] = set()
    for skill in sorted(known_skills, key=len, reverse=True):
        key = skill.strip().lower()
        if len(key) < 2 or key in seen:
            continue
        if key in text:
            matched.append(skill.strip())
            seen.add(key)
    return matched


def _resolve_task_required_skills(
    task_id: str,
    title: str,
    description: str,
    *,
    task_skills_map: dict[str, list[str]] | None = None,
    known_skills: list[str] | None = None,
) -> list[str]:
    """Use explicit task required skills when set; otherwise infer from text."""
    explicit = (task_skills_map or {}).get(task_id) or []
    if explicit:
        return list(explicit)
    return _infer_skills_from_text(title, description, known_skills or [])


def _skill_match_parts(
    user_skills: list[str],
    required_skills: list[str],
) -> tuple[int | None, list[str], list[str]]:
    """Return (skill match %, matched names, missing names).

    When no skills can be identified for the task, returns None — never assume a match.
    """
    if not required_skills:
        return None, [], []
    user_set = {s.strip().lower() for s in user_skills if s and s.strip()}
    matched = [s for s in required_skills if s.strip().lower() in user_set]
    missing = [s for s in required_skills if s.strip().lower() not in user_set]
    percent = round(len(matched) / len(required_skills) * 100)
    return percent, matched, missing


def _availability_percent(
    *,
    slip_days: int,
    load: int,
    free_before_due: date | None,
    due: date | None,
    today: date,
) -> int:
    """0–100 score from schedule capacity (slip, queue load, free window)."""
    slip_score = max(0, 100 - slip_days * 18)
    load_penalty = min(25, load * 4)
    early_bonus = 0
    if free_before_due is not None and due is not None and free_before_due <= due:
        days_early = max(0, (due - free_before_due).days)
        early_bonus = min(15, days_early * 3)
    if free_before_due is not None and free_before_due <= today:
        early_bonus = max(early_bonus, 10)
    return max(0, min(100, slip_score - load_penalty + early_bonus))


def _overall_match_label(overall: int) -> str:
    if overall >= 80:
        return "Excellent Match"
    if overall >= 60:
        return "Good Match"
    return "Fair Match"


def _availability_breakdown(
    *,
    slip_days: int,
    load: int,
    free_before_due: date | None,
    due: date | None,
    today: date,
) -> list[str]:
    """Short, plain lines explaining the availability score."""
    lines: list[str] = []
    if slip_days == 0:
        lines.append("Can finish on time")
    else:
        day_word = "day" if slip_days == 1 else "days"
        lines.append(f"Would finish {slip_days} {day_word} late")
    if load > 0:
        task_word = "task" if load == 1 else "tasks"
        lines.append(f"Already busy with {load} other {task_word}")
    if free_before_due is not None and due is not None and free_before_due <= due:
        days_early = max(0, (due - free_before_due).days)
        if free_before_due <= today:
            lines.append("Free right now")
        elif days_early > 0:
            day_word = "day" if days_early == 1 else "days"
            lines.append(f"Free {days_early} {day_word} before it's due")
    return lines


def _build_recommendation_score(
    *,
    skill_match: int | None,
    availability: int,
    has_skill_requirements: bool,
    availability_reasons: list[str] | None = None,
) -> dict[str, Any]:
    """Compose overall match and factor breakdown for API + UI."""
    avail_weight = _ACTIVE_FACTOR_WEIGHTS[_FACTOR_AVAILABILITY]
    skill_weight = _ACTIVE_FACTOR_WEIGHTS[_FACTOR_SKILL]
    avail_contrib = round(availability * avail_weight)
    skill_active = has_skill_requirements and skill_match is not None
    skill_contrib = round(skill_match * skill_weight) if skill_active else 0

    active_factors: list[dict[str, Any]] = [
        {
            "key": _FACTOR_AVAILABILITY,
            "label": "How free they are",
            "percent": availability,
            "weight": avail_weight,
            "contribution": avail_contrib,
            "active": True,
            "reasons": availability_reasons or [],
        },
        {
            "key": _FACTOR_SKILL,
            "label": "Skills fit",
            "percent": skill_match if skill_active else 0,
            "weight": skill_weight if skill_active else 0.0,
            "contribution": skill_contrib,
            "active": skill_active,
            "reasons": [],
        },
    ]
    for key, label in _FUTURE_FACTORS:
        active_factors.append({
            "key": key,
            "label": label,
            "percent": 0,
            "weight": 0.0,
            "contribution": 0,
            "active": False,
            "reasons": [],
        })

    if skill_active:
        overall = avail_contrib + skill_contrib
        overall_formula = (
            f"({availability}% × 50%) + ({skill_match}% × 50%) = {overall}%"
        )
    else:
        overall = availability
        overall_formula = (
            f"Only how free they are ({availability}%). "
            "We don't know what skills this task needs."
        )

    return {
        "overallMatch": overall,
        "overallLabel": _overall_match_label(overall),
        "overallFormula": overall_formula,
        "skillMatch": skill_match,
        "skillApplicable": skill_active,
        "availability": availability,
        "factors": active_factors,
    }


def _recommendation_why_bullets(
    *,
    required_skills: list[str],
    matched_skills: list[str],
    missing_skills: list[str],
    slip_days: int,
    free_before_due: date | None,
    due: date | None,
    today: date,
) -> list[str]:
    bullets: list[str] = []
    if required_skills:
        bullets.append(
            f"Has {len(matched_skills)} of {len(required_skills)} required skills"
        )
        if missing_skills:
            bullets.append(f"Missing: {', '.join(missing_skills[:4])}")

    if slip_days == 0:
        bullets.append("Has enough free time")
        if free_before_due is not None and due is not None and free_before_due <= due:
            if free_before_due <= today:
                bullets.append("Can start this task soon")
            else:
                bullets.append("Can take this before the due date")
    else:
        bullets.append("Has more free time than the current owner")

    return bullets


def _assignee_id_from_candidate(candidate: dict[str, Any]) -> str:
    return str(
        candidate.get("suggestedAssigneeId")
        or candidate.get("recommendedAssigneeId")
        or ""
    )


def _recommendation_tier_key(candidate: dict[str, Any]) -> tuple[int, int, int, int]:
    """Rank: overall match → skill → availability → lighter load."""
    score = candidate.get("score") or {}
    skill = score.get("skillMatch")
    return (
        int(score.get("overallMatch", 0)),
        int(skill) if skill is not None else -1,
        int(score.get("availability", 0)),
        -int(candidate.get("load", 999)),
    )


def _rank_recommendation_pick(a: dict[str, Any], b: dict[str, Any]) -> bool:
    """True if *a* is strictly better than *b* (overall, then skill, then availability, then load)."""
    return _recommendation_tier_key(a) > _recommendation_tier_key(b)


def _score_recommendation_candidate(
    *,
    assignee_id: str,
    required_skills: list[str],
    user_skills: dict[str, list[str]],
    slip_days: int,
    load: int,
    free_before_due: date,
    due: date,
    today: date,
) -> dict[str, Any]:
    """Skill + availability scores and bullet reasons for one candidate."""
    skills = user_skills.get(assignee_id, [])
    skill_pct, matched, missing = _skill_match_parts(skills, required_skills)
    availability = _availability_percent(
        slip_days=slip_days,
        load=load,
        free_before_due=free_before_due,
        due=due,
        today=today,
    )
    avail_reasons = _availability_breakdown(
        slip_days=slip_days,
        load=load,
        free_before_due=free_before_due,
        due=due,
        today=today,
    )
    score = _build_recommendation_score(
        skill_match=skill_pct,
        availability=availability,
        has_skill_requirements=bool(required_skills),
        availability_reasons=avail_reasons,
    )
    why_bullets = _recommendation_why_bullets(
        required_skills=required_skills,
        matched_skills=matched,
        missing_skills=missing,
        slip_days=slip_days,
        free_before_due=free_before_due,
        due=due,
        today=today,
    )
    return {
        "requiredSkills": required_skills,
        "matchedSkills": matched,
        "missingSkills": missing,
        "score": score,
        "whyBullets": why_bullets,
        "skillFitScore": round(skill_pct / 100, 3) if skill_pct is not None else None,
    }


def _finalize_recommendation_pick(
    base: dict[str, Any],
    scored: dict[str, Any],
) -> dict[str, Any]:
    return {**base, **scored}


def _pick_best_recommendation(
    candidates: list[dict[str, Any]],
    *,
    assignment_counts: dict[str, int] | None = None,
    task_id: str | None = None,
    today: date | None = None,
) -> dict[str, Any] | None:
    """Pick best candidate; spread ties via skill-first ranking, load balance, then random."""
    if not candidates:
        return None
    assignment_counts = assignment_counts or {}
    ref_day = today or date.today()
    rng = random.Random(hash((task_id or "", ref_day.isoformat())) & 0xFFFFFFFF)

    best_tier = max(_recommendation_tier_key(c) for c in candidates)
    tier_candidates = [c for c in candidates if _recommendation_tier_key(c) == best_tier]

    min_assigned = min(
        assignment_counts.get(_assignee_id_from_candidate(c), 0) for c in tier_candidates
    )
    pool = [
        c for c in tier_candidates
        if assignment_counts.get(_assignee_id_from_candidate(c), 0) == min_assigned
    ]
    return rng.choice(pool)


def _collect_reassignment_candidates(
    *,
    task_id: str,
    task_row: dict[str, Any],
    due: date,
    current_slip: int,
    current_user_id: str,
    candidate_ids: set[str],
    queues: dict[str, list[dict[str, Any]]],
    today: date,
    required_skills: list[str],
    user_skills: dict[str, list[str]],
    must_improve_slip: bool = True,
    must_zero_slip: bool = False,
    must_free_before_due: bool = False,
    assignee_id_key: str = "suggestedAssigneeId",
    slip_key: str = "suggestedSlipDays",
) -> list[dict[str, Any]]:
    """Evaluate every eligible teammate and return scored candidate picks."""
    candidates: list[dict[str, Any]] = []
    for cid in candidate_ids:
        if cid == current_user_id:
            continue
        cand_q = list(queues.get(cid, []))
        if any(x["taskId"] == task_id for x in cand_q):
            continue

        pre_free, _ = _simulate_queue(cand_q, today)
        if must_free_before_due and pre_free > due:
            continue

        trial = cand_q + [{
            "taskId": task_id,
            "title": task_row.get("title", ""),
            "due": due,
            "priority": task_row.get("priority"),
            "status": task_row.get("status"),
            "projectId": task_row.get("projectId"),
            "assignedTo": cid,
        }]
        trial.sort(key=lambda x: (x["due"], -_priority_weight(x["priority"])))
        new_slip = _slip_for_task_in_queue(task_id, trial, today)

        if must_zero_slip and new_slip > 0:
            continue
        if must_improve_slip and new_slip >= current_slip:
            continue

        load = len(cand_q)
        scored = _score_recommendation_candidate(
            assignee_id=cid,
            required_skills=required_skills,
            user_skills=user_skills,
            slip_days=new_slip,
            load=load,
            free_before_due=pre_free,
            due=due,
            today=today,
        )
        base = {
            assignee_id_key: cid,
            slip_key: new_slip,
            "improvementDays": current_slip - new_slip,
            "load": load,
            "recommendedOwnerFreeBeforeDue": str(pre_free),
        }
        if assignee_id_key == "recommendedAssigneeId":
            post_free, _ = _simulate_queue(trial, today)
            base["recommendedOwnerNextAvailable"] = str(post_free)
        candidates.append(_finalize_recommendation_pick(base, scored))
    return candidates


def _predicted_status(due: date, slip: int, today: date) -> str:
    if due < today:
        return _PREDICTED_DELAYED
    if slip > 0:
        return _PREDICTED_AT_RISK
    return _PREDICTED_ON_TRACK


def _on_track_reason(owner_name: str, due: date, today: date) -> str:
    days = (due - today).days
    if days <= 1:
        return f"{owner_name} has enough capacity to finish before the deadline."
    return f"{owner_name} is on schedule to complete this before the due date ({due})."


def _display_risk(risk: str) -> str:
    return _DISPLAY_RISK.get(risk, "Healthy")


def _worst_risk(risks: list[str]) -> str:
    if not risks:
        return RISK_HEALTHY
    return max(risks, key=lambda r: _RISK_ORDER.index(r) if r in _RISK_ORDER else 0)


def _delay_reason(
    owner_name: str,
    slip: int,
    due: date,
    today: date,
    status: str,
    blocking: list[str],
    queue_size: int,
) -> str:
    if due < today:
        return f"This task is already past its due date ({due})."
    if status == "in_progress" and slip > 0 and blocking:
        names = ", ".join(blocking[:2])
        extra = f" and {len(blocking) - 2} more" if len(blocking) > 2 else ""
        return (
            f"{owner_name} is stuck on earlier work ({names}{extra}) "
            f"and cannot finish this in-progress task on time."
        )
    if blocking:
        names = ", ".join(blocking[:2])
        extra = f" and {len(blocking) - 2} more" if len(blocking) > 2 else ""
        return f"{owner_name} is still busy with earlier tasks ({names}{extra}) before this one."
    if queue_size >= 5 and slip > 0:
        return f"{owner_name} has {queue_size} open tasks lined up and is about {slip} day(s) behind on this due date."
    if slip > 0:
        return f"{owner_name}'s schedule is full until after this due date — about {slip} day(s) late."
    return ""


def _suggest_assignee(
    task_row: dict[str, Any],
    owner_id: str,
    current_slip: int,
    candidate_ids: set[str],
    queues: dict[str, list[dict[str, Any]]],
    users: dict[str, User],
    today: date,
    *,
    task_description: str = "",
    task_skills_map: dict[str, list[str]] | None = None,
    user_skills: dict[str, list[str]] | None = None,
    known_skills: list[str] | None = None,
    assignment_counts: dict[str, int] | None = None,
) -> dict[str, Any] | None:
    pick = _best_reassignment(
        task_row,
        owner_id,
        candidate_ids,
        queues,
        today,
        task_description=task_description,
        task_skills_map=task_skills_map,
        user_skills=user_skills,
        known_skills=known_skills,
        assignment_counts=assignment_counts,
    )
    if not pick:
        return None
    user = users.get(pick["suggestedAssigneeId"])
    if not user:
        return None
    return {
        **pick,
        "suggestedAssigneeName": user.name,
    }


def _build_deadline_forecast(
    all_task_rows: list[dict[str, Any]],
    queues: dict[str, list[dict[str, Any]]],
    visible: set[str],
    users: dict[str, User],
    today: date,
    *,
    task_descriptions: dict[str, str] | None = None,
    task_skills_map: dict[str, list[str]] | None = None,
    user_skills: dict[str, list[str]] | None = None,
    known_skills: list[str] | None = None,
) -> tuple[list[dict[str, Any]], dict[str, int]]:
    by_due: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for tr in all_task_rows:
        by_due[tr["dueDate"]].append(tr)

    deadlines: list[dict[str, Any]] = []
    total_on_track = 0
    total_at_risk = 0
    total_delayed = 0
    total_reassign = 0
    at_risk_dates = 0
    assignment_counts: dict[str, int] = defaultdict(int)

    for due_s in sorted(by_due.keys()):
        rows = sorted(
            by_due[due_s],
            key=lambda r: (-_priority_weight(r.get("priority")), r["dueDate"]),
        )
        due = date.fromisoformat(due_s)
        task_details: list[dict[str, Any]] = []
        group_on_track = 0
        group_at_risk = 0
        group_delayed = 0

        for tr in rows:
            slip = int(tr["slipDays"])
            owner_id = tr["assigneeId"]
            owner_queue = queues.get(owner_id, [])
            blocking = _blocking_titles_before(tr["taskId"], owner_queue)
            queue_size = len(owner_queue)
            predicted = _predicted_status(due, slip, today)

            if predicted == _PREDICTED_DELAYED:
                reason = f"This task is past its due date ({due}) and is still incomplete."
                group_delayed += 1
            elif predicted == _PREDICTED_AT_RISK:
                effective_slip = slip
                reason = _delay_reason(
                    tr["assigneeName"],
                    effective_slip,
                    due,
                    today,
                    tr["status"],
                    blocking,
                    queue_size,
                )
                group_at_risk += 1
            else:
                reason = _on_track_reason(tr["assigneeName"], due, today)
                group_on_track += 1

            suggested_name = None
            suggested_id = None
            recommendation_score = None
            why_bullets: list[str] = []
            required_skills: list[str] = []
            matched_skills: list[str] = []
            missing_skills: list[str] = []
            free_before_due = None
            if predicted in (_PREDICTED_AT_RISK, _PREDICTED_DELAYED):
                effective_slip = slip if slip > 0 else max(0, (today - due).days)
                suggestion = _suggest_assignee(
                    tr,
                    owner_id,
                    effective_slip,
                    visible,
                    queues,
                    users,
                    today,
                    task_description=(task_descriptions or {}).get(tr["taskId"], ""),
                    task_skills_map=task_skills_map,
                    user_skills=user_skills,
                    known_skills=known_skills,
                    assignment_counts=assignment_counts,
                )
                if suggestion:
                    total_reassign += 1
                    suggested_name = suggestion["suggestedAssigneeName"]
                    suggested_id = suggestion["suggestedAssigneeId"]
                    assignment_counts[suggested_id] = assignment_counts.get(suggested_id, 0) + 1
                    recommendation_score = suggestion.get("score")
                    why_bullets = suggestion.get("whyBullets", [])
                    required_skills = suggestion.get("requiredSkills", [])
                    matched_skills = suggestion.get("matchedSkills", [])
                    missing_skills = suggestion.get("missingSkills", [])
                    free_before_due = suggestion.get("recommendedOwnerFreeBeforeDue")

            task_details.append({
                "taskName": tr["title"],
                "owner": tr["assigneeName"],
                "dueDate": due_s,
                "priority": tr.get("priority"),
                "predictedStatus": predicted,
                "expectedDelayDays": slip if slip > 0 else max(0, (today - due).days),
                "reason": reason,
                "suggestedAssignee": suggested_name,
                "suggestedAssigneeId": suggested_id,
                "score": recommendation_score,
                "whyBullets": why_bullets,
                "requiredSkills": required_skills,
                "matchedSkills": matched_skills,
                "missingSkills": missing_skills,
                "recommendedOwnerFreeBeforeDue": free_before_due,
            })

        total_on_track += group_on_track
        total_at_risk += group_at_risk
        total_delayed += group_delayed
        if group_at_risk > 0 or group_delayed > 0:
            at_risk_dates += 1

        task_risks = [tr["risk"] for tr in rows]
        group_risk = _display_risk(_worst_risk(task_risks))

        deadlines.append({
            "dueDate": due_s,
            "totalTasks": len(rows),
            "onTrackTasks": group_on_track,
            "atRiskTasks": group_at_risk,
            "delayedTasks": group_delayed,
            "risk": group_risk,
            "tasks": task_details,
            "delayedTaskDetails": task_details,
        })

    summary_counts = {
        "deadlinesTracked": len(deadlines),
        "deadlinesAtRisk": at_risk_dates,
        "onTrackTasks": total_on_track,
        "atRiskTasks": total_at_risk,
        "delayedTasks": total_delayed,
        "reassignmentSuggestions": total_reassign,
    }
    return deadlines, summary_counts


def _scoped_active_tasks(db: Db, requesting_user: User) -> tuple[set[str], set[str], list[Task]]:
    """Visible project + user ids and active tasks limited to those projects."""
    visible_pids = _visible_project_ids(db, requesting_user)
    visible_uids = _visible_user_ids(db, visible_pids, requesting_user)
    active_tasks = [
        t for t in analytics_crud.list_active_tasks(db)
        if t.project_id in visible_pids
    ]
    return visible_pids, visible_uids, active_tasks


def _classify_risk(slip_days: int, due: date, today: date) -> str:
    if due < today:
        return RISK_CRITICAL
    if slip_days > 7:
        return RISK_CRITICAL
    if slip_days >= 3:
        return RISK_HIGH
    if slip_days >= 1:
        return RISK_MODERATE
    return RISK_HEALTHY


def _simulate_queue(
    items: list[dict[str, Any]],
    today: date,
) -> tuple[date, list[dict[str, Any]]]:
    # ponytail: one task at a time, occupy through due; add hour estimates if slip is too coarse
    next_free = today
    rows: list[dict[str, Any]] = []

    for item in items:
        due: date = item["due"]
        slip = max(0, (next_free - due).days)
        risk = _classify_risk(slip, due, today)
        scheduled_start = next_free
        predicted_completion = due if slip == 0 else next_free
        busy_through = max(next_free, due) if slip == 0 else next_free

        rows.append({
            **item,
            "scheduledStartDate": str(scheduled_start),
            "predictedCompletionDate": str(predicted_completion),
            "slipDays": slip,
            "risk": risk,
            "busyThroughDate": str(busy_through),
        })
        next_free = busy_through + timedelta(days=1)

    return next_free, rows


def _queue_for_user(
    user_id: str,
    active_tasks: list[Task],
    task_assignees: dict[str, list[str]],
) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for t in active_tasks:
        if user_id not in _task_user_ids(t, task_assignees):
            continue
        due = _parse_task_due(t.due_date)
        if due is None:
            continue
        items.append({
            "taskId": t.id,
            "title": t.title,
            "due": due,
            "priority": t.priority,
            "status": t.status,
            "projectId": t.project_id,
            "assignedTo": t.assigned_to,
        })
    items.sort(key=lambda x: (x["due"], -_priority_weight(x["priority"])))
    return items


def _slip_for_task_in_queue(
    task_id: str,
    items: list[dict[str, Any]],
    today: date,
) -> int:
    _, rows = _simulate_queue(items, today)
    for r in rows:
        if r["taskId"] == task_id:
            return int(r["slipDays"])
    return 999


def _best_reassignment(
    task_row: dict[str, Any],
    current_user_id: str,
    candidate_ids: set[str],
    queues: dict[str, list[dict[str, Any]]],
    today: date,
    *,
    task_description: str = "",
    task_skills_map: dict[str, list[str]] | None = None,
    user_skills: dict[str, list[str]] | None = None,
    known_skills: list[str] | None = None,
    assignment_counts: dict[str, int] | None = None,
) -> dict[str, Any] | None:
    current_slip = int(task_row["slipDays"])
    if current_slip <= 0:
        return None

    task_id = task_row["taskId"]
    due = date.fromisoformat(task_row["dueDate"])
    required = _resolve_task_required_skills(
        task_id,
        task_row.get("title", ""),
        task_description,
        task_skills_map=task_skills_map,
        known_skills=known_skills,
    )
    candidates = _collect_reassignment_candidates(
        task_id=task_id,
        task_row=task_row,
        due=due,
        current_slip=current_slip,
        current_user_id=current_user_id,
        candidate_ids=candidate_ids,
        queues=queues,
        today=today,
        required_skills=required,
        user_skills=user_skills or {},
        must_improve_slip=True,
    )
    return _pick_best_recommendation(
        candidates,
        assignment_counts=assignment_counts,
        task_id=task_id,
        today=today,
    )


def _is_high_critical_priority(priority: str | None) -> bool:
    return bool(priority and priority.strip().lower() in _HIGH_PRIORITIES)


def _blocking_titles_before(task_id: str, items: list[dict[str, Any]]) -> list[str]:
    titles: list[str] = []
    for item in items:
        if item["taskId"] == task_id:
            break
        titles.append(item["title"])
    return titles


def _is_reassignable_task(task: Task, today: date) -> bool:
    """Prefer low/medium backlog or not-started tasks; never critical in-progress or imminently due."""
    if not _is_active_task(task):
        return False
    status = (task.status or "").strip().lower()
    if status in _REASSIGN_NEVER_STATUSES:
        return False
    priority = (task.priority or "").strip().lower()
    if priority in ("critical", "urgent") and status == "in_progress":
        return False
    due = _parse_task_due(task.due_date)
    if due is not None:
        if due <= today and status == "in_progress":
            return False
        if priority in ("critical", "urgent") and due <= today + timedelta(days=1) and status == "in_progress":
            return False
    if status in _REASSIGN_PREFER_STATUSES:
        return priority in _LOW_PRIORITIES or priority == "medium"
    if priority == "low" and status != "in_progress":
        return True
    if priority == "medium" and not bool(getattr(task, "is_started", False)) and status != "in_progress":
        return True
    return False


def _employee_workload_profile(
    uid: str,
    queue: list[dict[str, Any]],
    simulated: list[dict[str, Any]],
    today: date,
) -> dict[str, Any]:
    high_critical = sum(1 for r in simulated if _is_high_critical_priority(r.get("priority")))
    due_tomorrow = sum(
        1 for r in simulated
        if (r["due"] - today).days == 1
    )
    due_this_week = sum(
        1 for r in simulated
        if 0 <= (r["due"] - today).days <= 7
    )
    slip_count = sum(1 for r in simulated if int(r.get("slipDays", 0)) > 0)
    max_slip = max((int(r.get("slipDays", 0)) for r in simulated), default=0)
    return {
        "taskCount": len(simulated),
        "highCriticalCount": high_critical,
        "dueTomorrow": due_tomorrow,
        "dueThisWeek": due_this_week,
        "slipCount": slip_count,
        "maxSlipDays": max_slip,
        "isOverloaded": (
            len(simulated) >= _HEAVY_TASK_THRESHOLD
            or high_critical >= _HEAVY_HIGH_CRITICAL_THRESHOLD
            or due_tomorrow >= 3
            or slip_count > 0
        ),
        "isAvailable": (
            len(simulated) <= _AVAILABLE_TASK_THRESHOLD
            and high_critical <= 1
            and slip_count == 0
        ),
    }


def _pick_available_assignee(
    task_row: dict[str, Any],
    owner_id: str,
    available_ids: set[str],
    queues: dict[str, list[dict[str, Any]]],
    today: date,
    *,
    task_description: str = "",
    task_skills_map: dict[str, list[str]] | None = None,
    user_skills: dict[str, list[str]] | None = None,
    known_skills: list[str] | None = None,
    assignment_counts: dict[str, int] | None = None,
) -> dict[str, Any] | None:
    due = date.fromisoformat(task_row["dueDate"])
    required = _resolve_task_required_skills(
        task_row["taskId"],
        task_row.get("title", ""),
        task_description,
        task_skills_map=task_skills_map,
        known_skills=known_skills,
    )
    candidates = _collect_reassignment_candidates(
        task_id=task_row["taskId"],
        task_row=task_row,
        due=due,
        current_slip=int(task_row.get("slipDays", 0)),
        current_user_id=owner_id,
        candidate_ids=available_ids,
        queues=queues,
        today=today,
        required_skills=required,
        user_skills=user_skills or {},
        must_improve_slip=False,
        must_zero_slip=True,
    )
    return _pick_best_recommendation(
        candidates,
        assignment_counts=assignment_counts,
        task_id=task_row["taskId"],
        today=today,
    )


def _build_workload_reassignments(
    active_tasks: list[Task],
    all_task_rows: list[dict[str, Any]],
    profiles: dict[str, dict[str, Any]],
    available_ids: set[str],
    queues: dict[str, list[dict[str, Any]]],
    users: dict[str, User],
    today: date,
    *,
    task_skills_map: dict[str, list[str]] | None = None,
    user_skills: dict[str, list[str]] | None = None,
    known_skills: list[str] | None = None,
) -> list[dict[str, Any]]:
    task_by_id = {t.id: t for t in active_tasks}
    reassignments: list[dict[str, Any]] = []
    seen: set[str] = set()
    assignment_counts: dict[str, int] = defaultdict(int)

    for tr in all_task_rows:
        owner_id = tr["assigneeId"]
        profile = profiles.get(owner_id)
        if not profile or not profile["isOverloaded"]:
            continue
        task = task_by_id.get(tr["taskId"])
        if not task or not _is_reassignable_task(task, today):
            continue
        if tr["taskId"] in seen:
            continue

        pick = _pick_available_assignee(
            tr,
            owner_id,
            available_ids,
            queues,
            today,
            task_description=(task.description or "") if task else "",
            task_skills_map=task_skills_map,
            user_skills=user_skills,
            known_skills=known_skills,
            assignment_counts=assignment_counts,
        )
        if not pick:
            continue

        sug = users.get(pick["suggestedAssigneeId"])
        if not sug:
            continue

        assignment_counts[pick["suggestedAssigneeId"]] += 1

        owner = users.get(owner_id)
        reassignments.append({
            "taskId": tr["taskId"],
            "taskTitle": tr["title"],
            "dueDate": tr["dueDate"],
            "projectName": tr.get("projectName"),
            "priority": tr["priority"],
            "risk": tr["risk"],
            "currentAssigneeId": owner_id,
            "currentAssigneeName": owner.name if owner else tr["assigneeName"],
            "currentSlipDays": tr["slipDays"],
            "suggestedAssigneeId": pick["suggestedAssigneeId"],
            "suggestedAssigneeName": sug.name,
            "suggestedSlipDays": pick["suggestedSlipDays"],
            "improvementDays": pick["improvementDays"],
            "requiredSkills": pick.get("requiredSkills", []),
            "matchedSkills": pick.get("matchedSkills", []),
            "missingSkills": pick.get("missingSkills", []),
            "score": pick.get("score"),
            "whyBullets": pick.get("whyBullets", []),
            "skillFitScore": pick.get("skillFitScore", 0),
            "recommendedOwnerFreeBeforeDue": pick.get("recommendedOwnerFreeBeforeDue"),
        })
        seen.add(tr["taskId"])

    reassignments.sort(
        key=lambda r: (
            -(r.get("score") or {}).get("overallMatch", 0),
            -profiles.get(r["currentAssigneeId"], {}).get("maxSlipDays", 0),
            r["dueDate"],
        ),
    )
    return reassignments[:20]


def _pick_smart_reassignment(
    task: Task,
    due: date,
    owner_id: str,
    current_slip: int,
    owner_queue: list[dict[str, Any]],
    candidate_ids: set[str],
    queues: dict[str, list[dict[str, Any]]],
    today: date,
    *,
    task_skills_map: dict[str, list[str]] | None = None,
    user_skills: dict[str, list[str]] | None = None,
    known_skills: list[str] | None = None,
    assignment_counts: dict[str, int] | None = None,
) -> dict[str, Any] | None:
    if current_slip <= 0:
        return None

    required = _resolve_task_required_skills(
        task.id,
        task.title,
        task.description or "",
        task_skills_map=task_skills_map,
        known_skills=known_skills,
    )
    task_row = {
        "taskId": task.id,
        "title": task.title,
        "priority": task.priority,
        "status": task.status,
        "projectId": task.project_id,
    }
    candidates = _collect_reassignment_candidates(
        task_id=task.id,
        task_row=task_row,
        due=due,
        current_slip=current_slip,
        current_user_id=owner_id,
        candidate_ids=candidate_ids,
        queues=queues,
        today=today,
        required_skills=required,
        user_skills=user_skills or {},
        must_improve_slip=True,
        must_free_before_due=True,
        assignee_id_key="recommendedAssigneeId",
        slip_key="recommendedSlipDays",
    )
    return _pick_best_recommendation(
        candidates,
        assignment_counts=assignment_counts,
        task_id=task.id,
        today=today,
    )


def get_smart_task_reassignment(db: Db, requesting_user: User) -> dict[str, Any]:
    """High/Critical incomplete tasks at risk → better assignee if schedule math improves slip."""
    today = date.today()
    users = _user_map(db)
    _visible_pids, visible, active_tasks = _scoped_active_tasks(db, requesting_user)
    known_skills = [s.name for s in skills_crud.list_all(db)]
    user_skills = skills_crud.skill_names_by_user_ids(db, list(visible))
    task_skills_map = skills_crud.skill_names_by_task_ids(db, [t.id for t in active_tasks])

    # Scoped assignees query
    assignee_rows = analytics_crud.list_task_assignees_for_tasks(db, [t.id for t in active_tasks])
    task_assignees: dict[str, list[str]] = defaultdict(list)
    for ta in assignee_rows:
        task_assignees[ta.task_id].append(ta.user_id)

    queues: dict[str, list[dict[str, Any]]] = {
        uid: _queue_for_user(uid, active_tasks, task_assignees) for uid in visible
    }

    recommendations: list[dict[str, Any]] = []
    assignment_counts: dict[str, int] = defaultdict(int)

    for t in active_tasks:
        if not _is_high_critical_priority(t.priority):
            continue
        due = _parse_task_due(t.due_date)
        if due is None:
            continue

        owner_id = t.assigned_to
        if owner_id not in visible:
            continue
        owner = users.get(owner_id)
        if not owner:
            continue

        owner_queue = queues[owner_id]
        if not any(x["taskId"] == t.id for x in owner_queue):
            owner_queue = owner_queue + [{
                "taskId": t.id,
                "title": t.title,
                "due": due,
                "priority": t.priority,
                "status": t.status,
                "projectId": t.project_id,
                "assignedTo": owner_id,
            }]
            owner_queue.sort(key=lambda x: (x["due"], -_priority_weight(x["priority"])))

        current_slip = _slip_for_task_in_queue(t.id, owner_queue, today)
        if current_slip <= 0:
            continue

        pick = _pick_smart_reassignment(
            t, due, owner_id, current_slip, owner_queue, visible, queues, today,
            task_skills_map=task_skills_map,
            user_skills=user_skills,
            known_skills=known_skills,
            assignment_counts=assignment_counts,
        )
        if not pick:
            continue

        rec_user = users.get(pick["recommendedAssigneeId"])
        if not rec_user:
            continue

        assignment_counts[pick["recommendedAssigneeId"]] += 1

        _, owner_sim = _simulate_queue(owner_queue, today)
        owner_row = next(r for r in owner_sim if r["taskId"] == t.id)
        owner_next, _ = _simulate_queue(owner_queue, today)
        blocking = _blocking_titles_before(t.id, owner_queue)

        recommendations.append({
            "task": t.title,
            "taskId": t.id,
            "dueDate": str(due),
            "priority": t.priority,
            "currentOwner": owner.name,
            "currentOwnerId": owner_id,
            "recommendedOwner": rec_user.name,
            "recommendedOwnerId": pick["recommendedAssigneeId"],
            "requiredSkills": pick.get("requiredSkills", []),
            "matchedSkills": pick.get("matchedSkills", []),
            "missingSkills": pick.get("missingSkills", []),
            "score": pick.get("score"),
            "whyBullets": pick.get("whyBullets", []),
            "skillFitScore": pick.get("skillFitScore", 0),
            "calculations": {
                "currentSlipDays": current_slip,
                "recommendedSlipDays": pick["recommendedSlipDays"],
                "improvementDays": pick["improvementDays"],
                "currentOwnerNextAvailable": str(owner_next),
                "currentOwnerBusyThrough": owner_row["busyThroughDate"],
                "recommendedOwnerNextAvailable": pick["recommendedOwnerNextAvailable"],
                "recommendedOwnerFreeBeforeDue": pick["recommendedOwnerFreeBeforeDue"],
                "blockingTasks": blocking,
            },
        })

    recommendations.sort(key=lambda r: (-r["calculations"]["improvementDays"], r["dueDate"]))

    at_risk_count = 0
    reviewed = 0
    for t in active_tasks:
        if not _is_high_critical_priority(t.priority):
            continue
        due = _parse_task_due(t.due_date)
        if not due or t.assigned_to not in visible:
            continue
        reviewed += 1
        q = queues.get(t.assigned_to, [])
        if _slip_for_task_in_queue(t.id, q, today) > 0:
            at_risk_count += 1

    return {
        "asOf": str(today),
        "module": "smart_task_reassignment",
        "summary": {
            "highCriticalTasksReviewed": reviewed,
            "atRiskCount": at_risk_count,
            "recommendationCount": len(recommendations),
        },
        "recommendations": recommendations,
    }


def get_task_due_forecast(
    db: Db,
    requesting_user: User,
    start_date: str | None = None,
    end_date: str | None = None,
) -> dict[str, Any]:
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
    visible_pids, visible, active_tasks = _scoped_active_tasks(db, requesting_user)
    active_tasks = [
        t for t in active_tasks
        if (due := _parse_task_due(t.due_date)) is not None and start_dt <= due <= end_dt
    ]
    known_skills = [s.name for s in skills_crud.list_all(db)]
    user_skills = skills_crud.skill_names_by_user_ids(db, list(visible))
    task_skills_map = skills_crud.skill_names_by_task_ids(db, [t.id for t in active_tasks])
    task_descriptions = {t.id: (t.description or "") for t in active_tasks}
    task_skills_map = skills_crud.skill_names_by_task_ids(db, [t.id for t in active_tasks])

    # Scoped projects query
    active_pids = {t.project_id for t in active_tasks if t.project_id} & visible_pids
    projects = {p.id: p for p in analytics_crud.get_projects_by_ids(db, list(active_pids))}

    # Scoped assignees query
    assignee_rows = analytics_crud.list_task_assignees_for_tasks(db, [t.id for t in active_tasks])
    task_assignees: dict[str, list[str]] = defaultdict(list)
    for ta in assignee_rows:
        task_assignees[ta.task_id].append(ta.user_id)

    queues: dict[str, list[dict[str, Any]]] = {}
    for uid in visible:
        queues[uid] = _queue_for_user(uid, active_tasks, task_assignees)

    employees: list[dict[str, Any]] = []
    all_task_rows: list[dict[str, Any]] = []
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
        task_rows: list[dict[str, Any]] = []
        for row in simulated:
            proj = projects.get(row["projectId"]) if row.get("projectId") else None
            tr = {
                "taskId": row["taskId"],
                "title": row["title"],
                "dueDate": str(row["due"]),
                "projectId": row.get("projectId"),
                "projectName": proj.name if proj else None,
                "priority": row["priority"],
                "status": row["status"],
                "scheduledStartDate": row["scheduledStartDate"],
                "predictedCompletionDate": row["predictedCompletionDate"],
                "slipDays": row["slipDays"],
                "risk": row["risk"],
                "assigneeId": uid,
                "assigneeName": user.name,
            }
            task_rows.append(tr)
            all_task_rows.append(tr)

        employees.append({
            "userId": uid,
            "name": user.name,
            "role": user.role,
            "nextAvailableDate": str(next_available),
            "taskCount": len(task_rows),
            "highCriticalCount": profiles[uid]["highCriticalCount"],
            "dueTomorrow": profiles[uid]["dueTomorrow"],
            "workloadStatus": (
                "Overloaded" if profiles[uid]["isOverloaded"]
                else "Available" if profiles[uid]["isAvailable"]
                else "Balanced"
            ),
            "tasks": task_rows,
        })

    deadlines, deadline_summary = _build_deadline_forecast(
        all_task_rows, queues, visible, users, today,
        task_descriptions=task_descriptions,
        task_skills_map=task_skills_map,
        user_skills=user_skills,
        known_skills=known_skills,
    )

    available_ids = {uid for uid, p in profiles.items() if p["isAvailable"]}
    reassignments = _build_workload_reassignments(
        active_tasks, all_task_rows, profiles, available_ids, queues, users, today,
        task_skills_map=task_skills_map,
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
    for tr in all_task_rows:
        counts[tr["risk"]] = counts.get(tr["risk"], 0) + 1

    on_track = deadline_summary["onTrackTasks"]
    at_risk = deadline_summary["atRiskTasks"]
    delayed = deadline_summary["delayedTasks"]

    return {
        "asOf": str(today),
        "dateRange": {"startDate": str(start_dt), "endDate": str(end_dt)},
        "summary": {
            "totalTasks": len(all_task_rows),
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


def _demo() -> None:
    today = date(2026, 6, 1)
    items = [
        {"taskId": "a", "title": "A", "due": date(2026, 6, 5), "priority": "high", "status": "todo"},
        {"taskId": "b", "title": "B", "due": date(2026, 6, 3), "priority": "medium", "status": "todo"},
    ]
    items.sort(key=lambda x: (x["due"], -_priority_weight(x["priority"])))
    _, rows = _simulate_queue(items, today)
    by_id = {r["taskId"]: r for r in rows}
    assert by_id["b"]["slipDays"] == 0
    assert by_id["a"]["slipDays"] == 0
    items2 = [
        {"taskId": "y", "title": "Y", "due": date(2026, 6, 5), "priority": "high", "status": "todo"},
        {"taskId": "x", "title": "X", "due": date(2026, 6, 5), "priority": "low", "status": "todo"},
    ]
    items2.sort(key=lambda x: (x["due"], -_priority_weight(x["priority"])))
    _, rows2 = _simulate_queue(items2, today)
    assert rows2[1]["taskId"] == "x" and rows2[1]["slipDays"] > 0
    assert _classify_risk(0, date(2026, 5, 1), today) == RISK_CRITICAL
    assert _classify_risk(4, date(2026, 6, 20), today) == RISK_HIGH
    assert _predicted_status(date(2026, 5, 1), 0, today) == _PREDICTED_DELAYED
    assert _predicted_status(date(2026, 6, 10), 2, today) == _PREDICTED_AT_RISK
    assert _predicted_status(date(2026, 6, 10), 0, today) == _PREDICTED_ON_TRACK
    reason = _delay_reason("John", 3, date(2026, 6, 10), today, "todo", ["Task A"], 4)
    assert "earlier tasks" in reason
    assert _display_risk(RISK_HIGH) == "High"
    bullets = _recommendation_why_bullets(
        required_skills=["React", "TypeScript"],
        matched_skills=["React"],
        missing_skills=["TypeScript"],
        slip_days=0,
        free_before_due=date(2026, 6, 5),
        due=date(2026, 6, 10),
        today=today,
    )
    assert any("required skills" in b for b in bullets)
    score = _build_recommendation_score(skill_match=50, availability=90, has_skill_requirements=True)
    assert score["overallLabel"] in ("Excellent Match", "Good Match", "Fair Match")


if __name__ == "__main__":
    _demo()
    print("task_forecast_logic: ok")
