from sqlalchemy import Boolean, Column, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import relationship

from database.database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    email = Column(String, unique=True, nullable=False, index=True)
    password_hash = Column(String, nullable=False)
    role = Column(String, nullable=False)  # manager | employee
    avatar = Column(String, nullable=False, default="")
    job_title = Column(String, nullable=False, default="")
    # Total months of experience at the time of signup; combined with joined_at to compute current experience
    experience_months = Column(Integer, nullable=False, default=0)
    joined_at = Column(String, nullable=False, default="")  # ISO datetime of account creation
    # Admin can deactivate accounts: deactivated users keep their data but cannot log in.
    is_active = Column(Boolean, nullable=False, default=True)
    # Optional line manager for timesheet approval routing.
    manager_id = Column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)


class AppSetting(Base):
    """Tiny key/value store for app-level config (e.g. admin password override)."""

    __tablename__ = "app_settings"

    key = Column(String, primary_key=True)
    value = Column(Text, nullable=False, default="")


class Project(Base):
    __tablename__ = "projects"

    id = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    description = Column(String, nullable=False, default="")
    client_id = Column(String, ForeignKey("clients.id", ondelete="RESTRICT"), nullable=True)
    created_by = Column(String, ForeignKey("users.id"), nullable=False)
    created_at = Column(String, nullable=False)
    # Optional background image (URL or data URL) + accent hex derived from it.
    background_image = Column(Text, nullable=False, default="")
    accent_color = Column(String, nullable=False, default="")
    # Optional project image/photo (replaces the folder icon).
    project_image = Column(Text, nullable=False, default="")

    client = relationship("Client", back_populates="projects")
    sections = relationship("Section", back_populates="project", cascade="all, delete-orphan")
    members = relationship("ProjectMember", back_populates="project", cascade="all, delete-orphan")


class Client(Base):
    __tablename__ = "clients"

    id = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    created_at = Column(String, nullable=False)

    projects = relationship("Project", back_populates="client")


class Skill(Base):
    __tablename__ = "skills"

    id = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    created_at = Column(String, nullable=False)


class UserSkill(Base):
    __tablename__ = "user_skills"

    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    skill_id = Column(String, ForeignKey("skills.id", ondelete="CASCADE"), primary_key=True)


class ProjectMember(Base):
    __tablename__ = "project_members"

    project_id = Column(String, ForeignKey("projects.id"), primary_key=True)
    user_id = Column(String, ForeignKey("users.id"), primary_key=True)

    project = relationship("Project", back_populates="members")


class Section(Base):
    __tablename__ = "sections"

    id = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    project_id = Column(String, ForeignKey("projects.id"), nullable=False)

    project = relationship("Project", back_populates="sections")


class UserStory(Base):
    """Additive epic-style work item: Section → User Story → Task → Subtask."""

    __tablename__ = "user_stories"

    id = Column(String, primary_key=True)
    project_id = Column(String, ForeignKey("projects.id"), nullable=False, index=True)
    section_id = Column(String, ForeignKey("sections.id"), nullable=True, index=True)
    # Additive: a story may sit under another (epic → story). NULL = top level.
    parent_story_id = Column(
        String, ForeignKey("user_stories.id", ondelete="SET NULL"), nullable=True, index=True
    )
    title = Column(String, nullable=False)
    description = Column(Text, nullable=False, default="")
    acceptance_criteria = Column(Text, nullable=False, default="")
    priority = Column(String, nullable=False, default="Medium")
    status = Column(String, nullable=False, default="backlog")
    # Denormalized primary assignee (first of user_story_assignees); kept for backward compat.
    assignee_id = Column(String, ForeignKey("users.id"), nullable=True)
    reporter_id = Column(String, ForeignKey("users.id"), nullable=False)
    estimated_hours = Column(String, nullable=True)  # store as string for dialect simplicity
    story_points = Column(String, nullable=True)
    start_date = Column(String, nullable=True)
    due_date = Column(String, nullable=True)
    sprint = Column(String, nullable=False, default="")
    tags_json = Column(Text, nullable=False, default="[]")
    approved_by_manager = Column(Boolean, nullable=False, default=False)
    created_at = Column(String, nullable=False)
    updated_at = Column(String, nullable=False)

    assignees = relationship(
        "UserStoryAssignee", back_populates="story", cascade="all, delete-orphan"
    )


class UserStoryAssignee(Base):
    """Mirrors task_assignees — multi-assignee for user stories."""

    __tablename__ = "user_story_assignees"

    user_story_id = Column(
        String, ForeignKey("user_stories.id", ondelete="CASCADE"), primary_key=True, nullable=False
    )
    user_id = Column(
        String, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True, nullable=False
    )
    position = Column(Integer, nullable=False, default=0)

    story = relationship("UserStory", back_populates="assignees")


class Task(Base):
    __tablename__ = "tasks"

    id = Column(String, primary_key=True)
    title = Column(String, nullable=False)
    description = Column(String, nullable=False, default="")
    project_id = Column(String, ForeignKey("projects.id"), nullable=False)
    section_id = Column(String, ForeignKey("sections.id"), nullable=False)
    # Additive: optional link to a user story (NULL = legacy / standalone task).
    user_story_id = Column(String, ForeignKey("user_stories.id", ondelete="SET NULL"), nullable=True, index=True)
    # Additive: self-referencing subtask parent (NULL = top-level task). Checklists unchanged.
    parent_task_id = Column(String, ForeignKey("tasks.id", ondelete="CASCADE"), nullable=True, index=True)
    assigned_to = Column(String, ForeignKey("users.id"), nullable=False)
    assigned_by = Column(String, ForeignKey("users.id"), nullable=False)
    created_by = Column(String, ForeignKey("users.id"), nullable=False)
    due_date = Column(String, nullable=False)
    sprint = Column(String, nullable=False, default="")
    priority = Column(String, nullable=False)
    status = Column(String, nullable=False)
    is_started = Column(Boolean, nullable=False, default=False)
    started_at = Column(String, nullable=True)
    completed_at = Column(String, nullable=True)
    approved_by_manager = Column(Boolean, nullable=False, default=False)
    time_tracked = Column(Integer, nullable=False, default=0)
    min_log_minutes = Column(Integer, nullable=False, default=1)
    estimated_hours = Column(String, nullable=True)
    tags_json = Column(Text, nullable=False, default="[]")
    custom_fields_json = Column(Text, nullable=False, default="{}")
    created_at = Column(String, nullable=False)

    assignees = relationship("TaskAssignee", back_populates="task", cascade="all, delete-orphan")


class TempTask(Base):
    """Staging row for the PRD import chain. kind=user_story | task.
    Tasks point at a story via parent_id. Cleared after commit into real tables."""

    __tablename__ = "temp_tasks"

    id = Column(String, primary_key=True)
    import_id = Column(String, nullable=False, index=True)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    kind = Column(String, nullable=False)  # user_story | task
    parent_id = Column(String, nullable=True, index=True)
    title = Column(String, nullable=False)
    description = Column(Text, nullable=False, default="")
    acceptance_criteria = Column(Text, nullable=False, default="")
    project_id = Column(String, nullable=True)
    section_id = Column(String, nullable=True)
    priority = Column(String, nullable=False, default="Medium")
    position = Column(Integer, nullable=False, default=0)
    source_text = Column(Text, nullable=False, default="")
    assignee_ids = Column(Text, nullable=False, default="[]")
    extra_json = Column(Text, nullable=False, default="{}")
    created_at = Column(String, nullable=False)
    updated_at = Column(String, nullable=False)


class TaskAssignee(Base):
    __tablename__ = "task_assignees"

    task_id = Column(String, ForeignKey("tasks.id", ondelete="CASCADE"), primary_key=True, nullable=False)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True, nullable=False)
    position = Column(Integer, nullable=False, default=0)

    task = relationship("Task", back_populates="assignees")


class TaskTimerRun(Base):
    """A live, server-tracked work timer: one running session per (user, task).
    Persisted so a running timer survives reloads and is consistent across devices.
    On stop, elapsed time is computed server-side from started_at and the row removed."""

    __tablename__ = "task_timer_runs"

    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True, nullable=False)
    task_id = Column(String, ForeignKey("work_items.id", ondelete="CASCADE"), primary_key=True, nullable=False)
    started_at = Column(String, nullable=False)  # ISO-8601 UTC timestamp


class TaskTimeLog(Base):
    __tablename__ = "task_time_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    task_id = Column(String, ForeignKey("work_items.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    log_date = Column(String, nullable=False)
    seconds = Column(Integer, nullable=False, default=0)

    __table_args__ = (UniqueConstraint("task_id", "log_date", "user_id", name="uq_task_time_user_date"),)


class KanbanColumn(Base):
    __tablename__ = "kanban_columns"

    id = Column(String, primary_key=True)
    label = Column(String, nullable=False)
    position = Column(Integer, nullable=False, default=0)
    # Palette key (see logic/kanban_logic.COLUMN_COLORS), not a raw hex value —
    # the frontend maps it to light/dark tokens.
    color = Column(String, nullable=False, default="slate")


class TimesheetSubmission(Base):
    """Weekly timesheet approval state — one row per (user, week). Absence = draft."""

    __tablename__ = "timesheet_submissions"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    week_start = Column(String, nullable=False, index=True)  # Monday YYYY-MM-DD
    status = Column(String, nullable=False)  # submitted | approved | rejected
    submitted_at = Column(String, nullable=False)
    reviewer_id = Column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    reviewed_at = Column(String, nullable=True)
    rejection_note = Column(Text, nullable=False, default="")
    # JSON array of ISO work dates (YYYY-MM-DD) included in this submission batch.
    submitted_dates = Column(Text, nullable=False, default="[]")

    __table_args__ = (UniqueConstraint("user_id", "week_start", name="uq_timesheet_submission_user_week"),)


class TimesheetEntry(Base):
    """Manual per-day work rows: project, section, description, time range (user-owned)."""

    __tablename__ = "timesheet_entries"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    work_date = Column(String, nullable=False, index=True)
    project_id = Column(String, ForeignKey("projects.id"), nullable=False)
    section_id = Column(String, ForeignKey("sections.id"), nullable=False)
    # Set when the row came from a task (timer stop, or the hours entered at Done).
    # NULL for hand-written rows and Clockify imports.
    task_id = Column(String, ForeignKey("work_items.id", ondelete="SET NULL"), nullable=True, index=True)
    description = Column(Text, nullable=False, default="")
    time_from = Column(String, nullable=False)
    time_to = Column(String, nullable=False)
    seconds = Column(Integer, nullable=False)
    # Whether this logged time is billable to the client. Defaults to billable.
    billable = Column(Boolean, nullable=False, default=True)
    created_at = Column(String, nullable=False)


class TaskFeedback(Base):
    __tablename__ = "task_feedback"

    id = Column(String, primary_key=True)
    task_id = Column(String, ForeignKey("work_items.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    message = Column(Text, nullable=False)
    created_at = Column(String, nullable=False)
    updated_at = Column(String, nullable=False)


class UserStoryFeedback(Base):
    """Comment thread on a user story; mirrors task_feedback."""

    __tablename__ = "user_story_feedback"

    id = Column(String, primary_key=True)
    user_story_id = Column(
        String, ForeignKey("work_items.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    message = Column(Text, nullable=False)
    created_at = Column(String, nullable=False)
    updated_at = Column(String, nullable=False)


class TaskChecklist(Base):
    __tablename__ = "task_checklists"

    id = Column(String, primary_key=True)
    task_id = Column(String, ForeignKey("work_items.id", ondelete="CASCADE"), nullable=False, index=True)
    title = Column(String, nullable=False)
    priority = Column(String, nullable=False, default="Medium")
    is_done = Column(Boolean, nullable=False, default=False)
    position = Column(Integer, nullable=False, default=0)
    created_by = Column(String, ForeignKey("users.id"), nullable=False)
    created_at = Column(String, nullable=False)


class TaskAttachment(Base):
    __tablename__ = "task_attachments"

    id = Column(String, primary_key=True)
    task_id = Column(String, ForeignKey("work_items.id", ondelete="CASCADE"), nullable=False, index=True)
    filename = Column(String, nullable=False)          # original user filename
    stored_name = Column(String, nullable=False)       # UUID-based filename on disk
    content_type = Column(String, nullable=False, default="application/octet-stream")
    size_bytes = Column(Integer, nullable=False, default=0)
    uploaded_by = Column(String, ForeignKey("users.id"), nullable=False)
    created_at = Column(String, nullable=False)


class UserStoryAttachment(Base):
    """Same storage layout as task_attachments; files share ATTACHMENTS_DIR on disk."""

    __tablename__ = "user_story_attachments"

    id = Column(String, primary_key=True)
    user_story_id = Column(
        String, ForeignKey("work_items.id", ondelete="CASCADE"), nullable=False, index=True
    )
    filename = Column(String, nullable=False)
    stored_name = Column(String, nullable=False)
    content_type = Column(String, nullable=False, default="application/octet-stream")
    size_bytes = Column(Integer, nullable=False, default=0)
    uploaded_by = Column(String, ForeignKey("users.id"), nullable=False)
    created_at = Column(String, nullable=False)


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    action = Column(String, nullable=False)        # e.g. "task.created", "checklist.done"
    entity_type = Column(String, nullable=False)   # "task" | "project" | "checklist" | "attachment"
    entity_id = Column(String, nullable=False)
    entity_name = Column(String, nullable=False, default="")
    details = Column(Text, nullable=False, default="{}")   # JSON blob
    created_at = Column(String, nullable=False)


class Notification(Base):
    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    # task_assigned | task_mentioned | task_status_changed | task_commented | task_approved
    type = Column(String, nullable=False)
    title = Column(String, nullable=False, default="")
    message = Column(String, nullable=False, default="")
    entity_type = Column(String, nullable=False, default="task")
    entity_id = Column(String, nullable=False, default="")
    is_read = Column(Boolean, nullable=False, default=False)
    triggered_by = Column(String, ForeignKey("users.id"), nullable=False)
    created_at = Column(String, nullable=False)


class OAuthClient(Base):
    """A dynamically-registered MCP OAuth client (persisted so it survives restarts)."""

    __tablename__ = "oauth_clients"

    client_id = Column(String, primary_key=True)
    data = Column(Text, nullable=False)  # JSON of OAuthClientInformationFull
    created_at = Column(String, nullable=False, default="")


class OAuthGrant(Base):
    """Short-lived OAuth artifacts: pending auth requests, auth codes, refresh tokens.
    One table keyed by value, distinguished by `kind`. Persisted so the flow survives
    server reloads/restarts and works across workers."""

    __tablename__ = "oauth_grants"

    key = Column(String, primary_key=True)      # request_id | code | refresh token
    kind = Column(String, nullable=False)       # 'pending' | 'code' | 'refresh'
    client_id = Column(String, nullable=False, default="")
    user_id = Column(String, nullable=False, default="")
    data = Column(Text, nullable=False, default="{}")  # JSON payload
    expires_at = Column(Float, nullable=True)


class PersonalAccessToken(Base):
    """Long-lived, revocable token for programmatic access (MCP server, scripts).
    Only the SHA-256 hash is stored; the raw token is shown once at creation."""

    __tablename__ = "personal_access_tokens"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String, nullable=False, default="MCP token")
    token_hash = Column(String, nullable=False, unique=True, index=True)
    prefix = Column(String, nullable=False, default="")  # first chars, for display only
    created_at = Column(String, nullable=False, default="")
    last_used_at = Column(String, nullable=True)
    revoked = Column(Boolean, nullable=False, default=False)
    # ISO-8601 UTC. Empty string means "never expires" (pre-existing rows only);
    # new tokens always get a real expiry. Checked in token_logic.resolve_user_id.
    expires_at = Column(String, nullable=False, default="")


class Scrum(Base):
    """One scrum / meeting entry. A day can hold many of these (standup, sync, etc.).
    Stores raw pasted text + the AI-parsed per-person breakdown."""

    __tablename__ = "scrums"

    id = Column(String, primary_key=True)
    work_date = Column(String, nullable=False, index=True)  # YYYY-MM-DD (NOT unique — many per day)
    title = Column(String, nullable=False, default="Scrum")
    position = Column(Integer, nullable=False, default=0)
    raw_text = Column(Text, nullable=False, default="")
    parsed_json = Column(Text, nullable=False, default="")  # JSON: {members:[{name,items[]}], summary}
    parse_status = Column(String, nullable=False, default="empty")  # empty|ok|failed
    updated_by = Column(String, ForeignKey("users.id"), nullable=True)
    updated_at = Column(String, nullable=False, default="")
    created_at = Column(String, nullable=False, default="")


class TeamsTranscriptImport(Base):
    """Dedup ledger for Teams meeting transcripts pulled into MOM. Keyed by the
    Graph transcript id so a poll/sync never creates the same scrum twice."""

    __tablename__ = "teams_transcript_imports"

    transcript_id = Column(String, primary_key=True)
    meeting_id = Column(String, nullable=False, default="")
    scrum_id = Column(String, ForeignKey("scrums.id", ondelete="SET NULL"), nullable=True)
    imported_by = Column(String, ForeignKey("users.id"), nullable=True)
    imported_at = Column(String, nullable=False, default="")


class ForecastVisibility(Base):
    __tablename__ = "forecast_visibility"

    id = Column(String, primary_key=True)
    entity_type = Column(String, nullable=False)
    entity_id = Column(String, nullable=False)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    hidden = Column(Boolean, nullable=False, default=False)
    hidden_at = Column(String, nullable=True)
    restored_at = Column(String, nullable=True)


# ---------------------------------------------------------------------------
# Unified work items
#
# `tasks` and `user_stories` are the same shape at two altitudes: of the twenty
# story columns, sixteen have a task twin, and the three join tables (assignees,
# feedback, attachments) are identical but for the name of their foreign key.
# The split also spreads one tree over three parent columns — user_story_id,
# parent_task_id, parent_story_id — so no single query can walk it, and it makes
# "this is really a story" a physical row move (see logic/convert_logic.py)
# rather than a field change.
#
# `work_items` collapses all of that: one row per piece of work, `type` saying
# which kind it is, one `parent_id` for the whole tree. Columns only one kind
# can hold stay nullable and are guarded in logic — a story never carries
# tracked time, a task never carries story points.
#
# These tables are additive. Nothing reads them until the cutover; the old
# tables stay in place and authoritative until then.
# ---------------------------------------------------------------------------

WORK_ITEM_TYPES = ("story", "task")


class WorkItem(Base):
    __tablename__ = "work_items"

    id = Column(String, primary_key=True)
    # "story" | "task". A subtask is NOT a third type — it is a task whose
    # parent is a task. Depth is a property of the edge, not of the row.
    type = Column(String, nullable=False, index=True)
    # The whole hierarchy, in one column: story→story, story→task, task→task.
    parent_id = Column(
        String, ForeignKey("work_items.id", ondelete="SET NULL"), nullable=True, index=True
    )
    project_id = Column(String, ForeignKey("projects.id"), nullable=False, index=True)
    section_id = Column(String, ForeignKey("sections.id"), nullable=True, index=True)

    title = Column(String, nullable=False)
    description = Column(Text, nullable=False, default="")
    priority = Column(String, nullable=False, default="Medium")
    status = Column(String, nullable=False, default="backlog")
    due_date = Column(String, nullable=True)
    sprint = Column(String, nullable=False, default="")
    tags_json = Column(Text, nullable=False, default="[]")
    estimated_hours = Column(String, nullable=True)
    approved_by_manager = Column(Boolean, nullable=False, default=False)
    created_by = Column(String, ForeignKey("users.id"), nullable=True)
    created_at = Column(String, nullable=False)
    updated_at = Column(String, nullable=True)

    # Task-only — NULL on a story.
    # Denormalized primary assignee. Not derived from work_item_assignees: an
    # unassigned task stores its creator here as a placeholder, so the two are
    # deliberately not the same thing.
    assigned_to = Column(String, ForeignKey("users.id"), nullable=True)
    assigned_by = Column(String, ForeignKey("users.id"), nullable=True)
    is_started = Column(Boolean, nullable=False, default=False)
    started_at = Column(String, nullable=True)
    completed_at = Column(String, nullable=True)
    time_tracked = Column(Integer, nullable=False, default=0)
    min_log_minutes = Column(Integer, nullable=False, default=1)
    custom_fields_json = Column(Text, nullable=False, default="{}")

    # Story-only — NULL on a task.
    acceptance_criteria = Column(Text, nullable=False, default="")
    story_points = Column(String, nullable=True)
    start_date = Column(String, nullable=True)


class WorkItemAssignee(Base):
    __tablename__ = "work_item_assignees"

    work_item_id = Column(
        String, ForeignKey("work_items.id", ondelete="CASCADE"), primary_key=True
    )
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    position = Column(Integer, nullable=False, default=0)


class WorkItemFeedback(Base):
    __tablename__ = "work_item_feedback"

    id = Column(String, primary_key=True)
    work_item_id = Column(
        String, ForeignKey("work_items.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    message = Column(Text, nullable=False, default="")
    created_at = Column(String, nullable=False)
    updated_at = Column(String, nullable=True)


class WorkItemAttachment(Base):
    __tablename__ = "work_item_attachments"

    id = Column(String, primary_key=True)
    work_item_id = Column(
        String, ForeignKey("work_items.id", ondelete="CASCADE"), nullable=False, index=True
    )
    filename = Column(String, nullable=False)
    stored_name = Column(String, nullable=False)
    content_type = Column(String, nullable=False, default="")
    size_bytes = Column(Integer, nullable=False, default=0)
    uploaded_by = Column(String, ForeignKey("users.id"), nullable=True)
    created_at = Column(String, nullable=False)
