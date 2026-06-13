"""
Zani agent tools — PROPOSE mode + PERSONAL DATA tools.

create_project / create_section / create_task / add_member_to_project
  → Do NOT write to the DB. Instead they return a PROPOSED: <json> string.
    The frontend renders a confirm card; the user must Accept before anything
    is written.  Duplicate names are caught here and return ALREADY_EXISTS:.

list_projects / list_users
  → Execute immediately (read-only, safe).

get_my_tasks / get_my_tasks_due_today / get_my_overdue_tasks /
get_my_stats / get_my_timesheet_this_week / get_my_projects
  → Personal data tools — query DB for the current user's data.
    Return "CARDS: <json-array>" to render rich cards in the UI.

Return prefixes:
  "PROPOSED: <json>"       – action queued for user approval
  "ALREADY_EXISTS: <msg>"  – duplicate found; use the existing item's ID
  "ACCESS DENIED: <msg>"   – manager-only tool called by employee
  "CARDS: <json-array>"    – data cards for the current user
  "SUCCESS: <msg>"         – read-only result with plain text
  "ERROR: <msg>"           – unexpected error
"""

from __future__ import annotations
import json as _json
from datetime import date, timedelta

from sqlalchemy.orm import Session
from langchain_core.tools import tool

from database.models import (
    User,
    Project as ProjectModel,
    Section as SectionModel,
    Task as TaskModel,
    TaskAssignee,
    TimesheetEntry,
    ProjectMember,
)


def build_tools(db: Session, current_user: User) -> list:

    # ── 1. create_project ─────────────────────────────────────────────────────

    @tool
    def create_project(name: str, description: str = "") -> str:
        """
        Propose creating a brand-new project (MANAGERS ONLY).
        Returns PROPOSED: JSON — the user must Accept before the project is created.
        If a project with this name already exists, returns ALREADY_EXISTS: instead.

        Args:
            name: Short project name (required)
            description: Optional description
        """
        if current_user.role != "manager":
            return "ACCESS DENIED: Only managers can create projects."

        existing = db.query(ProjectModel).filter(
            ProjectModel.name.ilike(name.strip())
        ).first()
        if existing:
            return (
                f"ALREADY_EXISTS: A project named '{name}' already exists "
                f"(ID: {existing.id}). Use this existing project."
            )

        payload = _json.dumps({
            "type": "create_project",
            "name": name.strip(),
            "description": description.strip(),
        })
        return f"PROPOSED: {payload}"

    # ── 2. create_section ─────────────────────────────────────────────────────

    @tool
    def create_section(project_id: str, section_name: str) -> str:
        """
        Propose adding a section to a project.
        Returns PROPOSED: JSON — the user must Accept before the section is created.
        If a section with this name already exists in the project, returns ALREADY_EXISTS:.

        Args:
            project_id: ID of the target project
            section_name: Name for the new section
        """
        project = db.get(ProjectModel, project_id)
        if not project:
            return f"ERROR: Project {project_id} not found."

        existing = db.query(SectionModel).filter(
            SectionModel.project_id == project_id,
            SectionModel.name.ilike(section_name.strip()),
        ).first()
        if existing:
            return (
                f"ALREADY_EXISTS: Section '{section_name}' already exists in "
                f"project '{project.name}' (ID: {existing.id}). Use this existing section."
            )

        payload = _json.dumps({
            "type": "create_section",
            "project_id": project_id,
            "project_name": project.name,
            "section_name": section_name.strip(),
        })
        return f"PROPOSED: {payload}"

    # ── 3. create_task ────────────────────────────────────────────────────────

    @tool
    def create_task(
        title: str,
        project_id: str,
        section_id: str,
        assignee_id: str,
        description: str = "",
        due_date: str = "",
        priority: str = "Medium",
        tags: str = "",
    ) -> str:
        """
        Propose creating a task assigned to a team member.
        Returns PROPOSED: JSON — the user must Accept before the task is created.
        The assignee must already be a member of the project; use add_member_to_project first if not.

        Args:
            title: Short, actionable task title (required)
            project_id: Project ID (required)
            section_id: Section ID within that project (required)
            assignee_id: User ID of the person to assign to (required)
            description: Detailed description of what needs to be done
            due_date: ISO 8601 date (YYYY-MM-DD) or empty string
            priority: Urgent / High / Medium / Low  (default Medium)
            tags: Comma-separated tags e.g. 'frontend,bug'
        """
        # Validate every ID before proposing — prevents hallucinated IDs silently passing through
        project = db.get(ProjectModel, project_id)
        if not project:
            return f"ERROR: project_id '{project_id}' not found. Call list_projects to get valid IDs."

        section = db.get(SectionModel, section_id)
        if not section:
            return f"ERROR: section_id '{section_id}' not found. Call list_projects to get valid section IDs."
        if section.project_id != project_id:
            return f"ERROR: section '{section.name}' does not belong to project '{project.name}'. Use a section from the correct project."

        assignee = db.get(User, assignee_id)
        if not assignee:
            return f"ERROR: assignee_id '{assignee_id}' not found. Call list_users to get valid user IDs."

        tag_list = [t.strip() for t in tags.split(",") if t.strip()] if tags else []

        payload = _json.dumps({
            "type": "create_task",
            "title": title.strip(),
            "description": description.strip(),
            "project_id": project_id,
            "project_name": project.name if project else None,
            "section_id": section_id,
            "section_name": section.name if section else None,
            "assignee_id": assignee_id,
            "assignee_name": assignee.name if assignee else None,
            "due_date": due_date.strip(),
            "priority": priority.strip() or "Medium",
            "tags": tag_list,
        })
        return f"PROPOSED: {payload}"

    # ── 4. add_member_to_project ──────────────────────────────────────────────

    @tool
    def add_member_to_project(project_id: str, user_id: str) -> str:
        """
        Propose adding a user to a project (MANAGERS ONLY).
        Returns PROPOSED: JSON — the user must Accept before the member is added.
        If the user is already a member, returns ALREADY_EXISTS:.

        Args:
            project_id: ID of the project
            user_id: ID of the user to add
        """
        if current_user.role != "manager":
            return "ACCESS DENIED: Only managers can add members to projects."

        project = db.get(ProjectModel, project_id)
        user = db.get(User, user_id)

        if not project:
            return f"ERROR: Project {project_id} not found."
        if not user:
            return f"ERROR: User {user_id} not found."

        # Check if already a member
        already_member = any(m.user_id == user_id for m in project.members)
        if already_member:
            return (
                f"ALREADY_EXISTS: {user.name} is already a member of "
                f"'{project.name}'. No need to add again."
            )

        payload = _json.dumps({
            "type": "add_member",
            "project_id": project_id,
            "project_name": project.name,
            "user_id": user_id,
            "user_name": user.name,
        })
        return f"PROPOSED: {payload}"

    # ── 5. list_projects ──────────────────────────────────────────────────────

    @tool
    def list_projects() -> str:
        """
        Get the current list of all projects with sections and member IDs.
        Executes immediately — no user confirmation needed.
        Use this to look up IDs before proposing actions.
        """
        try:
            from logic import project_logic
            projects = project_logic.list_projects(db, current_user.id)
            if not projects:
                return "SUCCESS: No projects found."
            lines = []
            for p in projects:
                sec_str = (
                    ", ".join(f"{s.name}(ID:{s.id})" for s in p.sections)
                    if p.sections else "no sections"
                )
                lines.append(
                    f"- {p.name} (ID:{p.id}) | sections: {sec_str} | members: {', '.join(p.members)}"
                )
            return "SUCCESS: Found " + str(len(projects)) + " project(s)\n" + "\n".join(lines)
        except Exception as e:
            return f"ERROR: {e}"

    # ── 6. list_users ─────────────────────────────────────────────────────────

    @tool
    def list_users() -> str:
        """
        Get the current list of all team members with IDs, job titles, and experience.
        Executes immediately — no user confirmation needed.
        Use this to look up user IDs before proposing task assignments.
        """
        try:
            from logic import user_logic
            users = user_logic.list_users(db, current_user.id)
            if not users:
                return "SUCCESS: No users found."
            lines = []
            for u in users:
                exp = u.currentExperienceMonths or 0
                exp_str = f"{exp // 12}y {exp % 12}m" if exp else "no experience listed"
                lines.append(
                    f"- {u.name} (ID:{u.id}) | {u.jobTitle or 'no title'} | {exp_str} | role: {u.role}"
                )
            return "SUCCESS: Found " + str(len(users)) + " user(s)\n" + "\n".join(lines)
        except Exception as e:
            return f"ERROR: {e}"

    # ── 7. get_my_tasks ───────────────────────────────────────────────────────

    @tool
    def get_my_tasks(status_filter: str = "", priority_filter: str = "") -> str:
        """
        Get tasks currently assigned to me. Optionally filter by status or priority.
        Use this when the user asks: 'what are my tasks?', 'show my work', 'what do I have?'

        Args:
            status_filter: Optional keyword to filter by status, e.g. 'done', 'progress', 'backlog'. Empty = all tasks.
            priority_filter: Optional priority to filter by: 'Urgent', 'High', 'Medium', 'Low'. Empty = all priorities.
        """
        try:
            today = date.today().isoformat()
            assignee_rows = db.query(TaskAssignee).filter(TaskAssignee.user_id == current_user.id).all()
            task_ids = [r.task_id for r in assignee_rows]
            if not task_ids:
                return "SUCCESS: You have no tasks assigned to you."

            tasks = db.query(TaskModel).filter(TaskModel.id.in_(task_ids)).all()

            if status_filter:
                sf = status_filter.lower()
                tasks = [t for t in tasks if sf in t.status.lower()]
            if priority_filter:
                tasks = [t for t in tasks if t.priority.lower() == priority_filter.lower()]

            if not tasks:
                return "SUCCESS: No tasks match your filters."

            cards = []
            for t in tasks:
                project = db.get(ProjectModel, t.project_id)
                section = db.get(SectionModel, t.section_id)
                cards.append({
                    "type": "task",
                    "id": t.id,
                    "title": t.title,
                    "priority": t.priority,
                    "status": t.status,
                    "due_date": t.due_date or "",
                    "is_overdue": bool(t.due_date and t.due_date < today and not t.approved_by_manager and not t.completed_at),
                    "project_name": project.name if project else None,
                    "section_name": section.name if section else None,
                    "project_id": t.project_id,
                })
            return f"CARDS: {_json.dumps(cards)}"
        except Exception as e:
            return f"ERROR: {e}"

    # ── 8. get_my_tasks_due_today ─────────────────────────────────────────────

    @tool
    def get_my_tasks_due_today() -> str:
        """
        Get tasks assigned to me that are due today.
        Use for: 'what's due today?', 'my tasks for today', 'what do I need to finish today?'
        """
        try:
            today = date.today().isoformat()
            assignee_rows = db.query(TaskAssignee).filter(TaskAssignee.user_id == current_user.id).all()
            task_ids = [r.task_id for r in assignee_rows]
            if not task_ids:
                return "SUCCESS: You have no tasks assigned to you."

            tasks = db.query(TaskModel).filter(
                TaskModel.id.in_(task_ids),
                TaskModel.due_date == today,
            ).all()

            if not tasks:
                return f"SUCCESS: No tasks are due today ({today})."

            cards = []
            for t in tasks:
                project = db.get(ProjectModel, t.project_id)
                section = db.get(SectionModel, t.section_id)
                cards.append({
                    "type": "task",
                    "id": t.id,
                    "title": t.title,
                    "priority": t.priority,
                    "status": t.status,
                    "due_date": t.due_date or "",
                    "is_overdue": False,
                    "project_name": project.name if project else None,
                    "section_name": section.name if section else None,
                    "project_id": t.project_id,
                })
            return f"CARDS: {_json.dumps(cards)}"
        except Exception as e:
            return f"ERROR: {e}"

    # ── 9. get_my_overdue_tasks ───────────────────────────────────────────────

    @tool
    def get_my_overdue_tasks() -> str:
        """
        Get tasks assigned to me that are past their due date and not yet completed.
        Use for: 'what's overdue?', 'what have I missed?', 'late tasks'.
        """
        try:
            today = date.today().isoformat()
            assignee_rows = db.query(TaskAssignee).filter(TaskAssignee.user_id == current_user.id).all()
            task_ids = [r.task_id for r in assignee_rows]
            if not task_ids:
                return "SUCCESS: You have no tasks assigned to you."

            tasks = db.query(TaskModel).filter(
                TaskModel.id.in_(task_ids),
                TaskModel.due_date < today,
                TaskModel.approved_by_manager == False,  # noqa: E712
                TaskModel.completed_at == None,          # noqa: E711
            ).all()

            if not tasks:
                return "SUCCESS: Great news — no overdue tasks!"

            cards = []
            for t in tasks:
                project = db.get(ProjectModel, t.project_id)
                section = db.get(SectionModel, t.section_id)
                cards.append({
                    "type": "task",
                    "id": t.id,
                    "title": t.title,
                    "priority": t.priority,
                    "status": t.status,
                    "due_date": t.due_date or "",
                    "is_overdue": True,
                    "project_name": project.name if project else None,
                    "section_name": section.name if section else None,
                    "project_id": t.project_id,
                })
            return f"CARDS: {_json.dumps(cards)}"
        except Exception as e:
            return f"ERROR: {e}"

    # ── 10. get_my_stats ──────────────────────────────────────────────────────

    @tool
    def get_my_stats() -> str:
        """
        Get a summary of my work stats: total tasks assigned, completed this week,
        overdue tasks, and tasks in progress.
        Use for: 'how am I doing?', 'my stats', 'weekly summary', 'how many tasks did I complete?'
        """
        try:
            today = date.today()
            today_str = today.isoformat()
            monday_str = (today - timedelta(days=today.weekday())).isoformat()

            assignee_rows = db.query(TaskAssignee).filter(TaskAssignee.user_id == current_user.id).all()
            task_ids = [r.task_id for r in assignee_rows]

            if not task_ids:
                card = {
                    "type": "stat",
                    "assigned_total": 0, "in_progress": 0,
                    "completed_this_week": 0, "overdue": 0,
                }
                return f"CARDS: {_json.dumps([card])}"

            tasks = db.query(TaskModel).filter(TaskModel.id.in_(task_ids)).all()

            assigned_total = len(tasks)
            in_progress = sum(1 for t in tasks if t.is_started and not t.approved_by_manager and not t.completed_at)
            completed_this_week = sum(
                1 for t in tasks
                if t.completed_at and t.completed_at[:10] >= monday_str
            )
            overdue = sum(
                1 for t in tasks
                if t.due_date and t.due_date < today_str and not t.approved_by_manager and not t.completed_at
            )

            card = {
                "type": "stat",
                "assigned_total": assigned_total,
                "in_progress": in_progress,
                "completed_this_week": completed_this_week,
                "overdue": overdue,
            }
            return f"CARDS: {_json.dumps([card])}"
        except Exception as e:
            return f"ERROR: {e}"

    # ── 11. get_my_timesheet_this_week ────────────────────────────────────────

    @tool
    def get_my_timesheet_this_week() -> str:
        """
        Get a summary of hours I've logged in the timesheet this week, broken down by project.
        Use for: 'how many hours did I log?', 'my timesheet this week', 'what did I track?'
        """
        try:
            today = date.today()
            monday = today - timedelta(days=today.weekday())
            week_start = monday.isoformat()
            week_end = today.isoformat()

            entries = db.query(TimesheetEntry).filter(
                TimesheetEntry.user_id == current_user.id,
                TimesheetEntry.work_date >= week_start,
                TimesheetEntry.work_date <= week_end,
            ).all()

            if not entries:
                return f"SUCCESS: No timesheet entries logged this week ({week_start} – {week_end})."

            total_seconds = sum(e.seconds for e in entries)
            by_project: dict[str, dict] = {}
            for e in entries:
                project = db.get(ProjectModel, e.project_id)
                pname = project.name if project else e.project_id
                if pname not in by_project:
                    by_project[pname] = {"project_name": pname, "seconds": 0, "entry_count": 0}
                by_project[pname]["seconds"] += e.seconds
                by_project[pname]["entry_count"] += 1

            by_project_list = sorted(
                [{"project_name": v["project_name"], "hours": round(v["seconds"] / 3600, 1), "entry_count": v["entry_count"]}
                 for v in by_project.values()],
                key=lambda x: x["hours"],
                reverse=True,
            )

            card = {
                "type": "timesheet_summary",
                "week_start": week_start,
                "week_end": week_end,
                "total_hours": round(total_seconds / 3600, 1),
                "total_entries": len(entries),
                "by_project": by_project_list,
            }
            return f"CARDS: {_json.dumps([card])}"
        except Exception as e:
            return f"ERROR: {e}"

    # ── 12. get_my_projects ───────────────────────────────────────────────────

    @tool
    def get_my_projects() -> str:
        """
        Get all projects I am a member of, with task counts and completion stats.
        Use for: 'what projects am I on?', 'show my projects', 'project list'.
        """
        try:
            memberships = db.query(ProjectMember).filter(ProjectMember.user_id == current_user.id).all()
            if not memberships:
                return "SUCCESS: You are not a member of any projects yet."

            assignee_rows = db.query(TaskAssignee).filter(TaskAssignee.user_id == current_user.id).all()
            my_task_ids = {r.task_id for r in assignee_rows}

            cards = []
            for m in memberships:
                project = db.get(ProjectModel, m.project_id)
                if not project:
                    continue
                project_tasks = db.query(TaskModel).filter(
                    TaskModel.project_id == project.id,
                    TaskModel.id.in_(my_task_ids),
                ).all() if my_task_ids else []

                total = len(project_tasks)
                completed = sum(1 for t in project_tasks if t.approved_by_manager or t.completed_at)

                cards.append({
                    "type": "project",
                    "id": project.id,
                    "name": project.name,
                    "description": project.description or "",
                    "total_tasks": total,
                    "completed_tasks": completed,
                    "section_count": len(project.sections),
                })
            return f"CARDS: {_json.dumps(cards)}"
        except Exception as e:
            return f"ERROR: {e}"

    return [
        create_project,
        create_section,
        create_task,
        add_member_to_project,
        list_projects,
        list_users,
        get_my_tasks,
        get_my_tasks_due_today,
        get_my_overdue_tasks,
        get_my_stats,
        get_my_timesheet_this_week,
        get_my_projects,
    ]
