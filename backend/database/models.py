from sqlalchemy import Boolean, Column, ForeignKey, Integer, String, Text, UniqueConstraint
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


class Project(Base):
    __tablename__ = "projects"

    id = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    description = Column(String, nullable=False, default="")
    created_by = Column(String, ForeignKey("users.id"), nullable=False)
    created_at = Column(String, nullable=False)

    sections = relationship("Section", back_populates="project", cascade="all, delete-orphan")
    members = relationship("ProjectMember", back_populates="project", cascade="all, delete-orphan")


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


class Task(Base):
    __tablename__ = "tasks"

    id = Column(String, primary_key=True)
    title = Column(String, nullable=False)
    description = Column(String, nullable=False, default="")
    project_id = Column(String, ForeignKey("projects.id"), nullable=False)
    section_id = Column(String, ForeignKey("sections.id"), nullable=False)
    assigned_to = Column(String, ForeignKey("users.id"), nullable=False)
    assigned_by = Column(String, ForeignKey("users.id"), nullable=False)
    created_by = Column(String, ForeignKey("users.id"), nullable=False)
    due_date = Column(String, nullable=False)
    priority = Column(String, nullable=False)
    status = Column(String, nullable=False)
    is_started = Column(Boolean, nullable=False, default=False)
    started_at = Column(String, nullable=True)
    completed_at = Column(String, nullable=True)
    approved_by_manager = Column(Boolean, nullable=False, default=False)
    time_tracked = Column(Integer, nullable=False, default=0)
    tags_json = Column(Text, nullable=False, default="[]")
    custom_fields_json = Column(Text, nullable=False, default="{}")
    created_at = Column(String, nullable=False)

    assignees = relationship("TaskAssignee", back_populates="task", cascade="all, delete-orphan")


class TaskAssignee(Base):
    __tablename__ = "task_assignees"

    task_id = Column(String, ForeignKey("tasks.id", ondelete="CASCADE"), primary_key=True, nullable=False)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True, nullable=False)
    position = Column(Integer, nullable=False, default=0)

    task = relationship("Task", back_populates="assignees")


class TaskTimeLog(Base):
    __tablename__ = "task_time_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    task_id = Column(String, ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    log_date = Column(String, nullable=False)
    seconds = Column(Integer, nullable=False, default=0)

    __table_args__ = (UniqueConstraint("task_id", "log_date", "user_id", name="uq_task_time_user_date"),)


class KanbanColumn(Base):
    __tablename__ = "kanban_columns"

    id = Column(String, primary_key=True)
    label = Column(String, nullable=False)
    position = Column(Integer, nullable=False, default=0)


class TimesheetEntry(Base):
    """Manual per-day work rows: project, section, description, time range (user-owned)."""

    __tablename__ = "timesheet_entries"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    work_date = Column(String, nullable=False, index=True)
    project_id = Column(String, ForeignKey("projects.id"), nullable=False)
    section_id = Column(String, ForeignKey("sections.id"), nullable=False)
    description = Column(Text, nullable=False, default="")
    time_from = Column(String, nullable=False)
    time_to = Column(String, nullable=False)
    seconds = Column(Integer, nullable=False)
    created_at = Column(String, nullable=False)


class TaskFeedback(Base):
    __tablename__ = "task_feedback"

    id = Column(String, primary_key=True)
    task_id = Column(String, ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    message = Column(Text, nullable=False)
    created_at = Column(String, nullable=False)
    updated_at = Column(String, nullable=False)


class TaskChecklist(Base):
    __tablename__ = "task_checklists"

    id = Column(String, primary_key=True)
    task_id = Column(String, ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False, index=True)
    title = Column(String, nullable=False)
    priority = Column(String, nullable=False, default="Medium")
    is_done = Column(Boolean, nullable=False, default=False)
    position = Column(Integer, nullable=False, default=0)
    created_by = Column(String, ForeignKey("users.id"), nullable=False)
    created_at = Column(String, nullable=False)


class TaskAttachment(Base):
    __tablename__ = "task_attachments"

    id = Column(String, primary_key=True)
    task_id = Column(String, ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False, index=True)
    filename = Column(String, nullable=False)          # original user filename
    stored_name = Column(String, nullable=False)       # UUID-based filename on disk
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
