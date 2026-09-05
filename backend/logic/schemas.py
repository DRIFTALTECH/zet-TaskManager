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
    description: str = ""
    projectId: str
    sectionId: str
    assignedTo: str
    assigneeIds: list[str]
    assignedBy: str
    createdBy: str
    dueDate: str
    sprint: str = ""
    priority: str
    status: str
    isStarted: bool
    startedAt: str | None = None
    completedAt: str | None = None
    approvedByManager: bool
    timeTracked: int
    minLogMinutes: int = 1
    estimatedHours: float | None = None
    tags: list[str]
    createdAt: str
    timeLog: dict[str, int] = Field(default_factory=dict)
    customFields: dict[str, str] | None = None
    userStoryId: str | None = None
    parentTaskId: str | None = None


class TaskCreate(BaseModel):
    title: str
    description: str = ""
    projectId: str
    sectionId: str
    # Empty = unassigned (assigned_to stores creator as placeholder; assigneeIds stays []).
    assigneeIds: list[str] = Field(default_factory=list)
    assignedBy: str
    createdBy: str
    dueDate: str
    sprint: str = ""
    priority: str
    status: str | None = None
    tags: list[str] = []
    minLogMinutes: int | None = None
    estimatedHours: float | None = None
    userStoryId: str | None = None
    parentTaskId: str | None = None


class TaskPatch(BaseModel):
    title: str | None = None
    description: str | None = None
    priority: str | None = None
    status: str | None = None
    projectId: str | None = None
    sectionId: str | None = None
    assigneeIds: list[str] | None = None
    customFields: dict[str, str] | None = None
    dueDate: str | None = None
    sprint: str | None = None
    tags: list[str] | None = None
    startedAt: str | None = None
    completedAt: str | None = None
    minLogMinutes: int | None = None
    estimatedHours: float | None = None
    actualHours: float | None = None
    userStoryId: str | None = None
    parentTaskId: str | None = None


class UserStoryOut(BaseModel):
    id: str
    projectId: str
    sectionId: str | None = None
    parentStoryId: str | None = None
    title: str
    description: str
    acceptanceCriteria: str
    priority: str
    status: str
    assigneeId: str | None = None
    assigneeIds: list[str] = Field(default_factory=list)
    reporterId: str
    estimatedHours: float | None = None
    actualHours: float = 0.0
    storyPoints: float | None = None
    startDate: str | None = None
    dueDate: str | None = None
    sprint: str = ""
    tags: list[str] = Field(default_factory=list)
    approvedByManager: bool = False
    createdAt: str
    updatedAt: str
    progressPercent: float = 0.0
    taskCount: int = 0
    completedTaskCount: int = 0
    subtaskCount: int = 0
    completedSubtaskCount: int = 0


class UserStoryCreate(BaseModel):
    projectId: str
    sectionId: str | None = None
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
    sprint: str = ""
    tags: list[str] = Field(default_factory=list)


class UserStoryPatch(BaseModel):
    title: str | None = None
    projectId: str | None = None
    # "" detaches the story back to the top level; None leaves it alone.
    parentStoryId: str | None = None
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
    sprint: str | None = None
    tags: list[str] | None = None


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
    assigneeIds: list[str] = Field(default_factory=list)
    sectionId: str | None = None


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
    # Filled by the PRD chain when the model matches an existing project/section.
    projectId: str | None = None
    sectionId: str | None = None
    projectName: str | None = None
    sectionName: str | None = None
    estimatedHours: float | None = None
    storyPoints: float | None = None
    startDate: str | None = None
    dueDate: str | None = None
    sprint: str = ""
    tags: list[str] = Field(default_factory=list)


class ExtractStoriesPreviewOut(BaseModel):
    stories: list[ExtractedStoryPreview] = Field(default_factory=list)


class TempTaskPatch(BaseModel):
    title: str | None = None
    description: str | None = None
    acceptanceCriteria: str | None = None
    projectId: str | None = None
    sectionId: str | None = None
    priority: str | None = None
    assigneeIds: list[str] | None = None
    estimatedHours: float | None = None
    storyPoints: float | None = None
    startDate: str | None = None
    dueDate: str | None = None
    sprint: str | None = None
    tags: list[str] | None = None


class TempTaskCreateBody(BaseModel):
    parentId: str | None = None
    title: str = "Untitled"
    description: str = ""


class PrdDraftTaskOut(BaseModel):
    id: str
    title: str
    description: str = ""
    priority: str = "Medium"
    position: int = 0
    projectId: str | None = None
    sectionId: str | None = None
    assigneeIds: list[str] = Field(default_factory=list)


class PrdDraftStoryOut(BaseModel):
    id: str
    title: str
    description: str = ""
    acceptanceCriteria: str = ""
    priority: str = "Medium"
    projectId: str | None = None
    sectionId: str | None = None
    position: int = 0
    assigneeIds: list[str] = Field(default_factory=list)
    estimatedHours: float | None = None
    storyPoints: float | None = None
    startDate: str | None = None
    dueDate: str | None = None
    sprint: str = ""
    tags: list[str] = Field(default_factory=list)
    tasks: list[PrdDraftTaskOut] = Field(default_factory=list)


class PrdDraftOut(BaseModel):
    importId: str | None = None
    sourceText: str = ""
    stories: list[PrdDraftStoryOut] = Field(default_factory=list)


class PrdCommitOut(BaseModel):
    storiesCreated: int
    tasksCreated: int
    storyIds: list[str] = Field(default_factory=list)


class PrdCommitBody(BaseModel):
    storyIds: list[str] = Field(default_factory=list)
    taskIds: list[str] | None = None


class TaskMoveBody(BaseModel):
    status: str
    actualHours: float | None = None


class ApproveTaskBody(BaseModel):
    actualHours: float | None = None


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
    color: str


class KanbanColumnCreate(BaseModel):
    label: str
    color: str | None = None


class KanbanColumnRename(BaseModel):
    """Label and/or colour. Omitted fields keep their current value."""

    label: str | None = None
    color: str | None = None


class KanbanReorderBody(BaseModel):
    ids: list[str]


class TimesheetEntryOut(BaseModel):
    id: str
    userId: str
    workDate: str
    projectId: str
    sectionId: str
    taskId: str | None = None
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
    # Records the import created rather than skipping over. Surfaced so the
    # superadmin can see exactly what a file added to the workspace.
    createdProjects: list[str] = Field(default_factory=list)
    createdClients: list[str] = Field(default_factory=list)
    createdUsers: list[str] = Field(default_factory=list)
    membershipsAdded: int = 0
    skipped: list[ClockifyImportSkip] = Field(default_factory=list)


class TasksImportSkip(BaseModel):
    line: int
    reason: str
    detail: str = ""


class TasksImportReport(BaseModel):
    """Result of a superadmin delivery-sheet CSV → tasks import."""

    filename: str
    totalRows: int
    imported: int
    duplicates: int
    skippedCount: int
    dateOrder: str
    createdProjects: list[str] = Field(default_factory=list)
    createdUsers: list[str] = Field(default_factory=list)
    membershipsAdded: int = 0
    skipped: list[TasksImportSkip] = Field(default_factory=list)


class TimesheetEntryCreate(BaseModel):
    workDate: str
    projectId: str
    sectionId: str
    description: str = ""
    timeFrom: str
    timeTo: str
    billable: bool = True
    # Set by the task flows (timer stop, hours at Done) so the row can be revised.
    taskId: str | None = None


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


class UserStoryFeedbackOut(BaseModel):
    id: str
    userStoryId: str
    userId: str
    authorName: str
    message: str
    createdAt: str
    updatedAt: str


class UserStoryFeedbackCreate(BaseModel):
    message: str = Field(..., min_length=1, max_length=8000)
    mentionedUserIds: list[str] = Field(default_factory=list)


class UserStoryFeedbackPatch(BaseModel):
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


# --- Unified work items -----------------------------------------------------
# One shape for both kinds of work. Fields only one kind can hold are optional
# and stay None on the other, so a client reads a story and a task off the same
# row model instead of branching on which endpoint returned it.


class WorkItemOut(BaseModel):
    id: str
    type: str  # "story" | "task"
    parentId: str | None = None
    projectId: str
    sectionId: str | None = None
    title: str
    description: str = ""
    priority: str
    status: str
    dueDate: str | None = None
    sprint: str = ""
    tags: list[str] = Field(default_factory=list)
    estimatedHours: float | None = None
    approvedByManager: bool = False
    assigneeIds: list[str] = Field(default_factory=list)
    createdBy: str | None = None
    createdAt: str
    updatedAt: str | None = None
    # Task-only.
    assignedBy: str | None = None
    isStarted: bool = False
    startedAt: str | None = None
    completedAt: str | None = None
    timeTracked: int = 0
    minLogMinutes: int = 1
    customFields: dict[str, str] | None = None
    # Story-only.
    acceptanceCriteria: str = ""
    storyPoints: str | None = None
    startDate: str | None = None


class WorkItemCreate(BaseModel):
    type: str
    projectId: str
    title: str
    sectionId: str | None = None
    parentId: str | None = None
    description: str = ""
    priority: str = "Medium"
    status: str = "backlog"
    dueDate: str | None = None
    sprint: str = ""
    tags: list[str] = Field(default_factory=list)
    estimatedHours: float | None = None
    assigneeIds: list[str] = Field(default_factory=list)
    acceptanceCriteria: str = ""
    storyPoints: str | None = None
    startDate: str | None = None


class WorkItemPatch(BaseModel):
    # As elsewhere in this API, None means "not supplied, leave it alone".
    # Removing a parent is an explicit empty string, never null.
    title: str | None = None
    description: str | None = None
    sectionId: str | None = None
    parentId: str | None = None
    priority: str | None = None
    status: str | None = None
    dueDate: str | None = None
    sprint: str | None = None
    tags: list[str] | None = None
    estimatedHours: float | None = None
    assigneeIds: list[str] | None = None
    acceptanceCriteria: str | None = None
    storyPoints: str | None = None
    startDate: str | None = None


class PromptOut(BaseModel):
    """One editable instruction block, with the wording it shipped with."""

    key: str
    body: str
    defaultBody: str
    #: Names this prompt may use. Sent rather than inferred: they come from the
    #: whole template, and a caller reading only the system text would miss the
    #: ones declared in the human turn and reject wording the server accepts.
    placeholders: list[str]
    isCustom: bool
    updatedAt: str | None = None
    updatedBy: str | None = None


class PromptUpdate(BaseModel):
    body: str
