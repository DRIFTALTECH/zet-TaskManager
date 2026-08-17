from typing import Literal

from pydantic import BaseModel, EmailStr, Field, field_validator


# Minimum password length, applied everywhere a password is set or changed.
MIN_PASSWORD_LENGTH = 10


def _validate_password_strength(value: str) -> str:
    """Length plus a character-class mix. Long-but-simple beats short-but-clever,
    so length carries most of the weight and we only require two classes."""
    if len(value) < MIN_PASSWORD_LENGTH:
        raise ValueError(f"Password must be at least {MIN_PASSWORD_LENGTH} characters")
    classes = sum([
        any(c.islower() for c in value),
        any(c.isupper() for c in value),
        any(c.isdigit() for c in value),
        any(not c.isalnum() for c in value),
    ])
    if classes < 2:
        raise ValueError(
            "Password must mix at least two of: lower case, upper case, digits, symbols"
        )
    return value


class LoginBody(BaseModel):
    # Login does NOT validate strength — an existing weaker password must still
    # be able to sign in. Only setting a password enforces the rules.
    email: EmailStr
    password: str
    remember_me: bool = False


class RegisterBody(BaseModel):
    """Self-service sign-up. Role is NOT accepted from the client: every account
    is created as an inactive employee and only a superadmin can activate it or
    change its role."""

    name: str = Field(..., min_length=1, max_length=200)
    email: EmailStr
    password: str = Field(..., max_length=256)
    job_title: str = Field(default="", max_length=200)
    experience_months: int = Field(default=0, ge=0)

    @field_validator("password")
    @classmethod
    def _password_strength(cls, v: str) -> str:
        return _validate_password_strength(v)


class MicrosoftAuthBody(BaseModel):
    id_token: str = Field(
        ...,
        min_length=100,
        description="Microsoft Entra ID token from MSAL (JWT: header.payload.signature).",
    )
    remember_me: bool = False
    job_title: str = Field(default="", max_length=200)
    experience_months: int = Field(default=0, ge=0)


class RegistrationPending(BaseModel):
    """Sign-up succeeded but produced no session: the account is inactive until a
    superadmin approves it. `status` is what the frontend branches on."""

    status: Literal["pending_approval"] = "pending_approval"
    message: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


# ── Personal access tokens (MCP / programmatic access) ────────────────────────

class PersonalAccessTokenCreate(BaseModel):
    name: str = Field("MCP token", max_length=120)


class PersonalAccessTokenOut(BaseModel):
    id: str
    name: str
    prefix: str
    createdAt: str
    lastUsedAt: str | None = None
    expiresAt: str | None = None


class PersonalAccessTokenCreated(PersonalAccessTokenOut):
    """Returned only once, at creation — includes the raw token."""
    token: str


class UserOut(BaseModel):
    id: str
    name: str
    email: str
    role: str
    avatar: str
    projectIds: list[str]
    jobTitle: str = ""
    experienceMonths: int = 0
    joinedAt: str = ""
    currentExperienceMonths: int = 0
    isActive: bool = True
    managerId: str | None = None
    skills: list[str] = Field(default_factory=list)


class SkillOut(BaseModel):
    id: str
    name: str
    createdAt: str


class SkillCreate(BaseModel):
    name: str


class UserSkillsUpdate(BaseModel):
    skillIds: list[str] = Field(default_factory=list)


class CvSkillsOut(BaseModel):
    """Returned by the CV-parse endpoint — preview only, nothing is persisted."""
    skills: list[str] = Field(default_factory=list)


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


# ── Superadmin console ────────────────────────────────────────────────────────
# The superadmin is a normal user row holding role="superadmin"; they sign in
# through /auth/login like anyone else. There is no separate console password.

class SuperadminRoleUpdate(BaseModel):
    role: Literal["employee", "manager", "superadmin"]


class SuperadminPasswordReset(BaseModel):
    new_password: str = Field(..., max_length=256)

    @field_validator("new_password")
    @classmethod
    def _password_strength(cls, v: str) -> str:
        return _validate_password_strength(v)


class SuperadminProjectsUpdate(BaseModel):
    project_ids: list[str] = Field(default_factory=list)


class SuperadminManagerUpdate(BaseModel):
    managerId: str | None = None


class SuperadminUserDelete(BaseModel):
    # When the user owns work (tasks/assignments/timesheets), a reassign target is
    # required; otherwise the delete is rejected so nothing is silently orphaned.
    reassign_to: str | None = None


class SuperadminProjectOut(BaseModel):
    id: str
    name: str
    memberIds: list[str] = Field(default_factory=list)


class ProfileUpdate(BaseModel):
    name: str | None = None
    avatar: str | None = None


class PasswordUpdate(BaseModel):
    current_password: str
    new_password: str = Field(..., max_length=256)

    @field_validator("new_password")
    @classmethod
    def _password_strength(cls, v: str) -> str:
        return _validate_password_strength(v)


class SectionOut(BaseModel):
    id: str
    name: str
    projectId: str


class ClientOut(BaseModel):
    id: str
    name: str
    createdAt: str


class ClientCreate(BaseModel):
    name: str


class ProjectOut(BaseModel):
    id: str
    name: str
    description: str
    clientId: str | None = None
    clientName: str | None = None
    createdBy: str
    members: list[str]
    sections: list[SectionOut]
    createdAt: str
    isPersonal: bool = False
    backgroundImage: str = ""
    accentColor: str = ""
    projectImage: str = ""


class ProjectCreate(BaseModel):
    name: str
    description: str = ""
    clientId: str


class ProjectAppearancePatch(BaseModel):
    backgroundImage: str | None = None
    accentColor: str | None = None
    projectImage: str | None = None


class ProjectClientPatch(BaseModel):
    clientId: str | None = None


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
    minLogMinutes: int = 1
    tags: list[str]
    createdAt: str
    timeLog: dict[str, int] = Field(default_factory=dict)
    customFields: dict[str, str] | None = None
    # Additive hierarchy (optional — NULL/omitted for legacy tasks)
    userStoryId: str | None = None
    parentTaskId: str | None = None


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
    minLogMinutes: int | None = None
    userStoryId: str | None = None
    parentTaskId: str | None = None


class TaskPatch(BaseModel):
    title: str | None = None
    description: str | None = None
    priority: str | None = None
    status: str | None = None
    sectionId: str | None = None
    assigneeIds: list[str] | None = None
    customFields: dict[str, str] | None = None
    dueDate: str | None = None
    minLogMinutes: int | None = None
    userStoryId: str | None = None
    parentTaskId: str | None = None


class UserStoryOut(BaseModel):
    id: str
    projectId: str
    sectionId: str
    title: str
    description: str
    acceptanceCriteria: str
    priority: str
    status: str
    assigneeId: str | None = None
    assigneeIds: list[str] = Field(default_factory=list)
    reporterId: str
    estimatedHours: float | None = None
    storyPoints: float | None = None
    startDate: str | None = None
    dueDate: str | None = None
    createdAt: str
    updatedAt: str
    progressPercent: float = 0.0
    taskCount: int = 0
    completedTaskCount: int = 0
    subtaskCount: int = 0
    completedSubtaskCount: int = 0


class UserStoryCreate(BaseModel):
    projectId: str
    sectionId: str
    title: str
    description: str = ""
    acceptanceCriteria: str = ""
    priority: str = "Medium"
    status: str = "backlog"
    assigneeId: str | None = None
    assigneeIds: list[str] | None = None
    estimatedHours: float | None = None
    storyPoints: float | None = None
    startDate: str | None = None
    dueDate: str | None = None


class UserStoryPatch(BaseModel):
    title: str | None = None
    description: str | None = None
    acceptanceCriteria: str | None = None
    priority: str | None = None
    status: str | None = None
    sectionId: str | None = None
    assigneeId: str | None = None
    assigneeIds: list[str] | None = None
    estimatedHours: float | None = None
    storyPoints: float | None = None
    startDate: str | None = None
    dueDate: str | None = None


class UserStoryGenerateBody(BaseModel):
    """Optional: used when confirming creation after preview."""
    replaceGenerated: bool = False


class GeneratedSubtaskPreview(BaseModel):
    key: str
    title: str
    description: str = ""


class GeneratedTaskPreview(BaseModel):
    key: str
    title: str
    description: str = ""
    priority: str = "Medium"
    subtasks: list[GeneratedSubtaskPreview] = Field(default_factory=list)
    # When False, task is still created under the story but left unassigned.
    assign: bool = False


class UserStoryGeneratePreviewOut(BaseModel):
    storyId: str
    tasks: list[GeneratedTaskPreview] = Field(default_factory=list)


class UserStoryConfirmGenerateBody(BaseModel):
    replaceGenerated: bool = False
    tasks: list[GeneratedTaskPreview] = Field(default_factory=list)


class ExtractedStoryPreview(BaseModel):
    key: str
    title: str
    description: str = ""
    acceptanceCriteria: str = ""
    priority: str = "Medium"
    assigneeIds: list[str] = Field(default_factory=list)
    # Nested work items from document split (created on bulk confirm).
    tasks: list[GeneratedTaskPreview] = Field(default_factory=list)


class ExtractStoriesPreviewOut(BaseModel):
    stories: list[ExtractedStoryPreview] = Field(default_factory=list)


class BulkCreateStoriesBody(BaseModel):
    projectId: str
    sectionId: str
    stories: list[ExtractedStoryPreview] = Field(default_factory=list)


class TaskMoveBody(BaseModel):
    status: str


class LogTimeBody(BaseModel):
    date: str
    seconds: int


class TimerRunOut(BaseModel):
    taskId: str
    startedAt: str  # ISO-8601 UTC


class TimerStopBody(BaseModel):
    # Client's Date.getTimezoneOffset() (minutes, UTC − local) for local wall-clock times.
    tzOffset: int = 0


class MinTimerPersistOut(BaseModel):
    minutes: int


class MinTimerPersistBody(BaseModel):
    minutes: int


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
    billable: bool
    createdAt: str


class ClockifyImportSkip(BaseModel):
    """One row that did not import, with the spreadsheet line so it can be found."""

    line: int
    reason: str
    detail: str = ""


class ClockifyImportReport(BaseModel):
    filename: str
    totalRows: int
    imported: int
    duplicates: int
    skippedCount: int
    dateOrder: str
    skipped: list[ClockifyImportSkip] = Field(default_factory=list)


class TimesheetEntryCreate(BaseModel):
    workDate: str
    projectId: str
    sectionId: str
    description: str = ""
    timeFrom: str
    timeTo: str
    billable: bool = True


class TimesheetEntryPatch(BaseModel):
    workDate: str | None = None
    projectId: str | None = None
    sectionId: str | None = None
    description: str | None = None
    timeFrom: str | None = None
    timeTo: str | None = None
    billable: bool | None = None


class TimesheetSubmissionOut(BaseModel):
    id: str | None = None
    userId: str
    userName: str | None = None
    weekStart: str
    weekEnd: str
    status: Literal["draft", "submitted", "approved", "rejected"]
    submittedAt: str | None = None
    submittedDates: list[str] = Field(default_factory=list)
    reviewerId: str | None = None
    reviewerName: str | None = None
    reviewedAt: str | None = None
    rejectionNote: str | None = None


class TimesheetSubmitBody(BaseModel):
    """ISO work dates to submit. Empty / omitted = all 7 days in the week (legacy)."""
    dates: list[str] = Field(default_factory=list)


class TimesheetRejectBody(BaseModel):
    comment: str = ""


class TimesheetReviewEntryOut(BaseModel):
    id: str
    workDate: str
    projectId: str
    projectName: str
    sectionId: str
    sectionName: str
    description: str
    timeFrom: str
    timeTo: str
    seconds: int
    billable: bool


class TimesheetReviewDayOut(BaseModel):
    workDate: str
    entries: list[TimesheetReviewEntryOut]
    totalSeconds: int


class TimesheetSubmissionReviewOut(BaseModel):
    submission: TimesheetSubmissionOut
    days: list[TimesheetReviewDayOut]
    totalSeconds: int


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
    mentionedUserIds: list[str] = Field(default_factory=list)


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


class UserStoryAttachmentOut(BaseModel):
    id: str
    userStoryId: str
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


# ── Notifications ─────────────────────────────────────────────────────────────

class NotificationOut(BaseModel):
    id: int
    type: str
    title: str
    message: str
    entityType: str
    entityId: str
    isRead: bool
    triggeredBy: str
    triggeredByName: str
    triggeredByAvatar: str
    createdAt: str


# ── Scrums / meeting notes (MOM) ──────────────────────────────────────────────

class MomMemberOut(BaseModel):
    name: str
    items: list[str] = []


class ScrumCreate(BaseModel):
    title: str = Field("Scrum", max_length=120)
    rawText: str = Field("", max_length=20000)


class ScrumUpdate(BaseModel):
    """Either edit raw text (re-parses) or hand-edit the parsed members/summary."""
    title: str | None = Field(None, max_length=120)
    rawText: str | None = Field(None, max_length=20000)
    members: list[MomMemberOut] | None = None
    summary: str | None = Field(None, max_length=2000)


class ScrumOut(BaseModel):
    id: str
    date: str
    title: str
    rawText: str
    members: list[MomMemberOut] = []
    summary: str = ""
    parseStatus: str = "empty"  # empty | ok | failed
    updatedBy: str | None = None
    updatedByName: str = ""
    updatedAt: str = ""


class ScrumDaySummary(BaseModel):
    """Lightweight row for the calendar grid (no raw text)."""
    date: str
    scrumCount: int
    memberCount: int
    summary: str = ""
    parseStatus: str = "empty"
    updatedByName: str = ""


# ── Teams → MOM integration ─────────────────────────────────────────────────────

class TeamsImportBody(BaseModel):
    """Import one Teams meeting's transcript into MOM by its join link."""
    organizerEmail: str = Field(..., max_length=320)
    joinUrl: str = Field(..., max_length=2000)
    date: str | None = Field(None, max_length=10)   # YYYY-MM-DD; defaults to meeting/transcript date
    title: str | None = Field(None, max_length=120)


class TeamsSyncBody(BaseModel):
    """Pull every not-yet-imported transcript for an organizer (the automation)."""
    organizerEmail: str = Field(..., max_length=320)
    since: str | None = Field(None, max_length=10)  # YYYY-MM-DD lower bound (optional)


class TeamsStatusOut(BaseModel):
    configured: bool
    tenantConfigured: bool
    clientConfigured: bool
    secretConfigured: bool


class TeamsImportResult(BaseModel):
    imported: int
    skipped: int
    scrums: list[ScrumOut] = []
    message: str = ""
