from typing import Literal

from pydantic import BaseModel, Field


class LoginBody(BaseModel):
    email: str
    password: str
    remember_me: bool = False


class RegisterBody(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    email: str
    password: str = Field(..., min_length=6, max_length=256)
    role: Literal["employee", "manager"] = "employee"


class MicrosoftAuthBody(BaseModel):
    id_token: str = Field(..., min_length=20)
    remember_me: bool = False
    """Role for new accounts only; existing users keep their role."""
    role: Literal["employee", "manager"] | None = None


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserOut(BaseModel):
    id: str
    name: str
    email: str
    role: str
    avatar: str
    projectIds: list[str]


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class ProfileUpdate(BaseModel):
    name: str | None = None
    avatar: str | None = None


class PasswordUpdate(BaseModel):
    current_password: str
    new_password: str


class SectionOut(BaseModel):
    id: str
    name: str
    projectId: str


class ProjectOut(BaseModel):
    id: str
    name: str
    description: str
    createdBy: str
    members: list[str]
    sections: list[SectionOut]
    createdAt: str
    isPersonal: bool = False


class ProjectCreate(BaseModel):
    name: str
    description: str = ""


class SectionCreate(BaseModel):
    name: str


class MemberBody(BaseModel):
    user_id: str


class TaskOut(BaseModel):
    id: str
    title: str
    description: str
    projectId: str
    sectionId: str
    assignedTo: str
    assigneeIds: list[str]
    assignedBy: str
    createdBy: str
    dueDate: str
    priority: str
    status: str
    isStarted: bool
    startedAt: str | None = None
    completedAt: str | None = None
    approvedByManager: bool
    timeTracked: int
    tags: list[str]
    createdAt: str
    timeLog: dict[str, int] = Field(default_factory=dict)
    customFields: dict[str, str] | None = None


class TaskCreate(BaseModel):
    title: str
    description: str = ""
    projectId: str
    sectionId: str
    assigneeIds: list[str] = Field(..., min_length=1)
    assignedBy: str
    createdBy: str
    dueDate: str
    priority: str
    tags: list[str] = []


class TaskPatch(BaseModel):
    title: str | None = None
    description: str | None = None
    priority: str | None = None
    status: str | None = None
    sectionId: str | None = None
    assigneeIds: list[str] | None = None
    customFields: dict[str, str] | None = None


class TaskMoveBody(BaseModel):
    status: str


class LogTimeBody(BaseModel):
    date: str
    seconds: int


class KanbanColumnOut(BaseModel):
    id: str
    label: str


class KanbanColumnCreate(BaseModel):
    label: str


class KanbanColumnRename(BaseModel):
    label: str


class KanbanReorderBody(BaseModel):
    ids: list[str]


class TimesheetEntryOut(BaseModel):
    id: str
    userId: str
    workDate: str
    projectId: str
    sectionId: str
    description: str
    timeFrom: str
    timeTo: str
    seconds: int
    createdAt: str


class TimesheetEntryCreate(BaseModel):
    workDate: str
    projectId: str
    sectionId: str
    description: str = ""
    timeFrom: str
    timeTo: str


class TimesheetEntryPatch(BaseModel):
    workDate: str | None = None
    projectId: str | None = None
    sectionId: str | None = None
    description: str | None = None
    timeFrom: str | None = None
    timeTo: str | None = None


class TaskFeedbackOut(BaseModel):
    id: str
    taskId: str
    userId: str
    authorName: str
    message: str
    createdAt: str
    updatedAt: str


class TaskFeedbackCreate(BaseModel):
    message: str = Field(..., min_length=1, max_length=8000)


class TaskFeedbackPatch(BaseModel):
    message: str = Field(..., min_length=1, max_length=8000)


# ── Checklists ────────────────────────────────────────────────────────────────

class TaskChecklistOut(BaseModel):
    id: str
    taskId: str
    title: str
    priority: str
    isDone: bool
    position: int
    createdBy: str
    createdAt: str


class TaskChecklistCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=500)
    priority: str = "Medium"


class TaskChecklistPatch(BaseModel):
    title: str | None = None
    priority: str | None = None
    isDone: bool | None = None


# ── Attachments ───────────────────────────────────────────────────────────────

class TaskAttachmentOut(BaseModel):
    id: str
    taskId: str
    filename: str
    contentType: str
    sizeBytes: int
    uploadedBy: str
    uploaderName: str
    createdAt: str


# ── Audit Log ─────────────────────────────────────────────────────────────────

class AuditLogOut(BaseModel):
    id: int
    userId: str
    userName: str
    action: str
    entityType: str
    entityId: str
    entityName: str
    details: dict
    createdAt: str
