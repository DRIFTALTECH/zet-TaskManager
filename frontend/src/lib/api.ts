import type { AuditLog, ClockifyImportReport, Client, KanbanColumn, Notification, Project, Role, Skill, Task, TaskAttachment, TaskChecklist, TaskFeedback, TimesheetSubmission, TimesheetSubmissionReview, TimesheetWorkEntry, TasksImportReport, User } from '@/types';
import { getApiUrl } from '@/lib/env';

const TOKEN_KEY = 'tm_token';

/** Error carrying the HTTP status, so callers can distinguish "not authorised"
 *  from "could not reach the server". Losing that distinction is how a flaky
 *  connection ends up looking like a logout. */
export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

/** True when the failure means the session is genuinely no longer valid. */
export function isAuthError(e: unknown): boolean {
  return e instanceof ApiError && (e.status === 401 || e.status === 403);
}

/** Returned by sign-up when the account is created but not yet approved. */
export interface PendingApproval {
  status: 'pending_approval';
  message: string;
}

/** Narrows the register / Microsoft responses, which can be either shape. */
export function isPendingApproval(r: unknown): r is PendingApproval {
  return !!r && typeof r === 'object' && (r as PendingApproval).status === 'pending_approval';
}

function baseUrl(): string {
  return getApiUrl();
}

function headers(json = true): HeadersInit {
  const t = localStorage.getItem(TOKEN_KEY);
  const h: Record<string, string> = {};
  if (json) h['Content-Type'] = 'application/json';
  if (t) h['Authorization'] = `Bearer ${t}`;
  return h;
}

async function parseError(res: Response): Promise<string> {
  try {
    const j = await res.json();
    if (typeof j?.detail === 'string') return j.detail;
    if (Array.isArray(j?.detail)) return j.detail.map((x: { msg?: string }) => x.msg).filter(Boolean).join(', ');
  } catch {
    /* ignore */
  }
  return res.statusText || 'Request failed';
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: { ...headers(!(init?.body instanceof FormData)), ...init?.headers },
  });
  if (res.status === 401) {
    const detail = await parseError(res);
    // Microsoft exchange failures are not an expired ZET session — don't wipe auth UI.
    const isMicrosoftExchange = path === '/auth/microsoft';
    if (!isMicrosoftExchange) {
      localStorage.removeItem(TOKEN_KEY);
      if (typeof window !== 'undefined') {
        const p = window.location.pathname;
        if (p !== '/login' && p !== '/signup') {
          window.location.href = '/login';
        }
      }
    }
    throw new ApiError(detail || 'Unauthorized', 401);
  }
  if (!res.ok) throw new ApiError(await parseError(res), res.status);
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function clearStoredToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

/**
 * Timesheet wall-clock times (HH:MM + workDate) are stored and shown in the user's
 * local timezone. The dashboard timer already writes local times via tz offset;
 * do not convert to/from UTC here — that double-shifts display (e.g. 09:00 → 14:30 IST).
 */

export const api = {
  async login(email: string, password: string, rememberMe = false): Promise<{ access_token: string; user: User }> {
    return request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password, remember_me: rememberMe }),
    });
  },

  /** Sign-up never returns a session: the account waits for superadmin approval. */
  async register(
    name: string,
    email: string,
    password: string,
    jobTitle?: string,
    experienceMonths?: number,
  ): Promise<PendingApproval> {
    return request('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        name,
        email,
        password,
        job_title: jobTitle ?? '',
        experience_months: experienceMonths ?? 0,
      }),
    });
  },

  /**
   * Signs in a known Microsoft account. An unknown one is registered as an
   * inactive employee and comes back as PendingApproval instead of a session.
   */
  async loginMicrosoft(
    idToken: string,
    rememberMe = false,
    jobTitle?: string,
    experienceMonths?: number,
  ): Promise<{ access_token: string; user: User } | PendingApproval> {
    const body: Record<string, unknown> = {
      id_token: idToken,
      remember_me: rememberMe,
    };
    if (jobTitle) body.job_title = jobTitle;
    if (typeof experienceMonths === 'number') body.experience_months = experienceMonths;
    return request('/auth/microsoft', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  async getMe(): Promise<User> {
    return request('/users/me');
  },

  async getUsers(): Promise<User[]> {
    return request('/users');
  },

  async getProjects(): Promise<Project[]> {
    return request('/projects');
  },

  async getClients(): Promise<Client[]> {
    return request('/clients');
  },

  async getSkills(): Promise<Skill[]> {
    return request('/skills');
  },

  async createSkill(name: string): Promise<Skill> {
    return request('/skills', { method: 'POST', body: JSON.stringify({ name }) });
  },

  async updateUserSkills(userId: string, skillIds: string[]): Promise<User> {
    return request(`/users/${userId}/skills`, {
      method: 'PATCH',
      body: JSON.stringify({ skillIds }),
    });
  },

  async extractSkillsFromCv(userId: string, file: File): Promise<{ skills: string[] }> {
    const form = new FormData();
    form.append('file', file);
    return request(`/users/${userId}/cv-skills`, { method: 'POST', body: form });
  },

  /** Import a Clockify Detailed report CSV into timesheet entries (superadmin only). */
  async importClockifyCsv(file: File): Promise<ClockifyImportReport> {
    const form = new FormData();
    form.append('file', file);
    return request('/timesheet/import/clockify', { method: 'POST', body: form });
  },

  /** Import a delivery-sheet CSV into tasks (superadmin only). */
  async importTasksCsv(file: File): Promise<TasksImportReport> {
    const form = new FormData();
    form.append('file', file);
    return request('/tasks/import', { method: 'POST', body: form });
  },

  async createClient(name: string): Promise<Client> {
    return request('/clients', { method: 'POST', body: JSON.stringify({ name }) });
  },

  async createProject(name: string, description: string, clientId: string): Promise<Project> {
    return request('/projects', { method: 'POST', body: JSON.stringify({ name, description, clientId }) });
  },

  async addSection(projectId: string, name: string): Promise<Project> {
    return request(`/projects/${projectId}/sections`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
  },

  async setProjectAppearance(
    projectId: string,
    body: { backgroundImage?: string; accentColor?: string; projectImage?: string },
  ): Promise<Project> {
    return request(`/projects/${projectId}/appearance`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  },

  async updateProjectClient(projectId: string, clientId: string | null): Promise<Project> {
    return request(`/projects/${projectId}/client`, {
      method: 'PATCH',
      body: JSON.stringify({ clientId }),
    });
  },

  async uploadProjectMedia(
    projectId: string,
    kind: 'background' | 'project',
    file: Blob,
    accentColor = '',
  ): Promise<Project> {
    const form = new FormData();
    form.append('kind', kind);
    form.append('accent_color', accentColor);
    form.append('file', file, 'image.jpg');
    return request(`/projects/${projectId}/media`, { method: 'POST', body: form });
  },

  async deleteProjectSection(projectId: string, sectionId: string): Promise<Project> {
    return request(`/projects/${projectId}/sections/${sectionId}`, { method: 'DELETE' });
  },

  async deleteProject(projectId: string): Promise<{ ok: boolean }> {
    return request(`/projects/${projectId}`, { method: 'DELETE' });
  },

  async addProjectMember(projectId: string, userId: string): Promise<Project> {
    return request(`/projects/${projectId}/members`, {
      method: 'POST',
      body: JSON.stringify({ user_id: userId }),
    });
  },

  async removeProjectMember(projectId: string, userId: string): Promise<Project> {
    return request(`/projects/${projectId}/members/${userId}`, { method: 'DELETE' });
  },

  async getTasks(): Promise<Task[]> {
    return request('/tasks');
  },

  async getTasksVersion(): Promise<{ version: number }> {
    return request('/tasks/version');
  },

  async getSyncVersion(): Promise<{ tasks: number; projects: number; users: number }> {
    return request('/sync/version');
  },

  // ── Personal access tokens (MCP / developer) ─────────────────────────────
  async listAccessTokens(): Promise<import('@/types').PersonalAccessToken[]> {
    return request('/auth/tokens');
  },

  async createAccessToken(name: string): Promise<import('@/types').PersonalAccessTokenCreated> {
    return request('/auth/tokens', { method: 'POST', body: JSON.stringify({ name }) });
  },

  async revokeAccessToken(id: string): Promise<void> {
    await request(`/auth/tokens/${id}`, { method: 'DELETE' });
  },

  // ── Scrums / meeting notes (MOM) ─────────────────────────────────────────
  async getScrumDays(start: string, end: string): Promise<import('@/types').ScrumDaySummary[]> {
    return request(`/meeting-notes?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`);
  },

  async getScrumsForDay(date: string): Promise<import('@/types').Scrum[]> {
    return request(`/meeting-notes/day/${date}`);
  },

  async createScrum(date: string, title: string, rawText: string): Promise<import('@/types').Scrum> {
    return request(`/meeting-notes/day/${date}`, { method: 'POST', body: JSON.stringify({ title, rawText }) });
  },

  async updateScrum(
    id: string,
    patch: { title?: string; rawText?: string; members?: import('@/types').MomMember[]; summary?: string },
  ): Promise<import('@/types').Scrum> {
    return request(`/meeting-notes/scrum/${id}`, { method: 'PUT', body: JSON.stringify(patch) });
  },

  async reparseScrum(id: string): Promise<import('@/types').Scrum> {
    return request(`/meeting-notes/scrum/${id}/reparse`, { method: 'POST' });
  },

  async transcribeScrumAudio(file: File): Promise<{ text: string }> {
    const form = new FormData();
    form.append('file', file);
    // FormData body → request() omits Content-Type so the browser sets the multipart boundary.
    return request('/meeting-notes/transcribe', { method: 'POST', body: form });
  },

  async deleteScrum(id: string): Promise<{ ok: boolean }> {
    return request(`/meeting-notes/scrum/${id}`, { method: 'DELETE' });
  },

  // ── Teams → MOM integration ──────────────────────────────────────────────
  async teamsStatus(): Promise<{
    configured: boolean; tenantConfigured: boolean; clientConfigured: boolean; secretConfigured: boolean;
  }> {
    return request('/integrations/teams/status');
  },

  async teamsImport(body: { organizerEmail: string; joinUrl: string; date?: string; title?: string }): Promise<{
    imported: number; skipped: number; scrums: import('@/types').Scrum[]; message: string;
  }> {
    return request('/integrations/teams/import', { method: 'POST', body: JSON.stringify(body) });
  },

  async teamsSync(body: { organizerEmail: string; since?: string }): Promise<{
    imported: number; skipped: number; scrums: import('@/types').Scrum[]; message: string;
  }> {
    return request('/integrations/teams/sync', { method: 'POST', body: JSON.stringify(body) });
  },

  async createTask(body: {
    title: string;
    description: string;
    projectId: string;
    sectionId: string;
    assigneeIds: string[];
    assignedBy: string;
    createdBy: string;
    dueDate: string;
    sprint?: string;
    priority: string;
    status?: string;
    tags: string[];
    userStoryId: string;
    parentTaskId?: string | null;
  }): Promise<Task> {
    return request('/tasks', { method: 'POST', body: JSON.stringify(body) });
  },

  async deleteTask(taskId: string): Promise<void> {
    await request(`/tasks/${taskId}`, { method: 'DELETE' });
  },

  async patchTask(
    taskId: string,
    patch: Partial<{
      title: string;
      description: string;
      priority: string;
      status: string;
      projectId: string;
      sectionId: string;
      assigneeIds: string[];
      customFields: Record<string, string>;
      dueDate: string;
      sprint: string;
      tags: string[];
      startedAt: string | null;
      completedAt: string | null;
      minLogMinutes: number;
      userStoryId: string | null;
      parentTaskId: string | null;
    }>,
  ): Promise<Task> {
    return request(`/tasks/${taskId}`, { method: 'PATCH', body: JSON.stringify(patch) });
  },

  // ── User stories (additive hierarchy) ─────────────────────────────────────
  async listProjectUserStories(projectId: string): Promise<import('@/types').UserStory[]> {
    return request(`/projects/${projectId}/user-stories`);
  },

  async listSectionUserStories(sectionId: string): Promise<import('@/types').UserStory[]> {
    return request(`/sections/${sectionId}/user-stories`);
  },

  async createUserStory(body: {
    projectId: string;
    sectionId?: string | null;
    title: string;
    description?: string;
    acceptanceCriteria?: string;
    priority?: string;
    status?: string;
    assigneeId?: string | null;
    assigneeIds?: string[];
    estimatedHours?: number | null;
    storyPoints?: number | null;
    startDate?: string | null;
    dueDate?: string | null;
  }): Promise<import('@/types').UserStory> {
    return request('/user-stories', { method: 'POST', body: JSON.stringify(body) });
  },

  async getUserStory(storyId: string): Promise<import('@/types').UserStory> {
    return request(`/user-stories/${storyId}`);
  },

  async patchUserStory(
    storyId: string,
    patch: Partial<{
      title: string;
      description: string;
      acceptanceCriteria: string;
      priority: string;
      status: string;
      sectionId: string;
      assigneeId: string | null;
      assigneeIds: string[];
      estimatedHours: number | null;
      storyPoints: number | null;
      startDate: string | null;
      dueDate: string | null;
    }>,
  ): Promise<import('@/types').UserStory> {
    return request(`/user-stories/${storyId}`, { method: 'PATCH', body: JSON.stringify(patch) });
  },

  async deleteUserStory(storyId: string): Promise<void> {
    await request(`/user-stories/${storyId}`, { method: 'DELETE' });
  },

  async listUserStoryTasks(storyId: string): Promise<Task[]> {
    return request(`/user-stories/${storyId}/tasks`);
  },

  /** AI preview only — does not create tasks. */
  async generateUserStoryTasksPreview(
    storyId: string,
  ): Promise<import('@/types').UserStoryGeneratePreview> {
    return request(`/user-stories/${storyId}/generate-tasks`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  },

  async confirmGenerateUserStoryTasks(
    storyId: string,
    body: {
      replaceGenerated?: boolean;
      tasks: import('@/types').GeneratedTaskPreview[];
    },
  ): Promise<Task[]> {
    return request(`/user-stories/${storyId}/confirm-generate-tasks`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  async extractUserStories(
    projectId: string,
    opts: { text?: string; file?: File },
  ): Promise<{ stories: import('@/types').ExtractedStoryPreview[] }> {
    const form = new FormData();
    form.append('project_id', projectId);
    if (opts.text) form.append('text', opts.text);
    if (opts.file) form.append('file', opts.file);
    return request(`/projects/${projectId}/user-stories/extract`, { method: 'POST', body: form });
  },

  async bulkCreateUserStories(body: {
    projectId: string;
    sectionId?: string | null;
    stories: import('@/types').ExtractedStoryPreview[];
  }): Promise<import('@/types').UserStory[]> {
    return request('/user-stories/bulk', { method: 'POST', body: JSON.stringify(body) });
  },

  async getUserStoryAttachments(storyId: string): Promise<import('@/types').UserStoryAttachment[]> {
    return request(`/user-stories/${storyId}/attachments`);
  },

  async uploadUserStoryAttachment(
    storyId: string,
    file: File,
  ): Promise<import('@/types').UserStoryAttachment> {
    const form = new FormData();
    form.append('file', file);
    return request(`/user-stories/${storyId}/attachments`, { method: 'POST', body: form });
  },

  async deleteUserStoryAttachment(storyId: string, attachmentId: string): Promise<void> {
    await request(`/user-stories/${storyId}/attachments/${attachmentId}`, { method: 'DELETE' });
  },

  async startTask(taskId: string): Promise<Task> {
    return request(`/tasks/${taskId}/start`, { method: 'POST' });
  },

  // Server-tracked work timers (running state lives in the DB, not the browser).
  async getActiveTimers(): Promise<{ taskId: string; startedAt: string }[]> {
    return request('/tasks/timers/active');
  },

  async startTimer(taskId: string): Promise<{ taskId: string; startedAt: string }> {
    return request(`/tasks/${taskId}/timer/start`, { method: 'POST' });
  },

  async stopTimer(taskId: string, tzOffset: number): Promise<Task> {
    return request(`/tasks/${taskId}/timer/stop`, {
      method: 'POST',
      body: JSON.stringify({ tzOffset }),
    });
  },

  async moveTask(taskId: string, status: string): Promise<Task> {
    return request(`/tasks/${taskId}/move`, { method: 'POST', body: JSON.stringify({ status }) });
  },

  async approveTask(taskId: string): Promise<Task> {
    return request(`/tasks/${taskId}/approve`, { method: 'POST' });
  },

  async reopenTaskToBacklog(taskId: string): Promise<Task> {
    return request(`/tasks/${taskId}/reopen-to-backlog`, { method: 'POST' });
  },

  async logTime(taskId: string, date: string, seconds: number): Promise<Task> {
    return request(`/tasks/${taskId}/log-time`, {
      method: 'POST',
      body: JSON.stringify({ date, seconds }),
    });
  },

  async listTaskFeedback(taskId: string): Promise<TaskFeedback[]> {
    return request(`/tasks/${taskId}/feedback`);
  },

  async createTaskFeedback(taskId: string, message: string, mentionedUserIds: string[] = []): Promise<TaskFeedback> {
    return request(`/tasks/${taskId}/feedback`, { method: 'POST', body: JSON.stringify({ message, mentionedUserIds }) });
  },

  async patchTaskFeedback(taskId: string, feedbackId: string, message: string): Promise<TaskFeedback> {
    return request(`/tasks/${taskId}/feedback/${feedbackId}`, {
      method: 'PATCH',
      body: JSON.stringify({ message }),
    });
  },

  async deleteTaskFeedback(taskId: string, feedbackId: string): Promise<void> {
    await request(`/tasks/${taskId}/feedback/${feedbackId}`, { method: 'DELETE' });
  },

  async getTimesheetWorkEntries(start: string, end: string): Promise<TimesheetWorkEntry[]> {
    const q = new URLSearchParams({ start, end });
    return request<TimesheetWorkEntry[]>(`/timesheet/entries?${q.toString()}`);
  },

  /** Manager-only: another user's entries in the date range. */
  async getTimesheetWorkEntriesForUser(userId: string, start: string, end: string): Promise<TimesheetWorkEntry[]> {
    const q = new URLSearchParams({ start, end });
    return request<TimesheetWorkEntry[]>(`/timesheet/users/${userId}/entries?${q.toString()}`);
  },

  /** Manager/admin: every member's entries in the date range (visibility-scoped). */
  async getTeamTimesheetEntries(start: string, end: string): Promise<TimesheetWorkEntry[]> {
    const q = new URLSearchParams({ start, end });
    return request<TimesheetWorkEntry[]>(`/timesheet/entries/all?${q.toString()}`);
  },

  /** Manager-only: every timesheet entry logged against a project, across all members. */
  async getProjectTimesheetEntries(projectId: string): Promise<TimesheetWorkEntry[]> {
    return request<TimesheetWorkEntry[]>(`/timesheet/projects/${projectId}/entries`);
  },

  async createTimesheetWorkEntry(body: {
    workDate: string;
    projectId: string;
    sectionId: string;
    description: string;
    timeFrom: string;
    timeTo: string;
    billable?: boolean;
  }): Promise<TimesheetWorkEntry> {
    return request<TimesheetWorkEntry>('/timesheet/entries', { method: 'POST', body: JSON.stringify(body) });
  },

  async patchTimesheetWorkEntry(
    entryId: string,
    body: Partial<{
      workDate: string;
      projectId: string;
      sectionId: string;
      description: string;
      timeFrom: string;
      timeTo: string;
      billable: boolean;
    }>,
  ): Promise<TimesheetWorkEntry> {
    return request<TimesheetWorkEntry>(`/timesheet/entries/${entryId}`, { method: 'PATCH', body: JSON.stringify(body) });
  },

  async deleteTimesheetWorkEntry(entryId: string): Promise<void> {
    await request(`/timesheet/entries/${entryId}`, { method: 'DELETE' });
  },

  async getTimesheetSubmissionStatus(weekStart: string): Promise<TimesheetSubmission> {
    const q = new URLSearchParams({ week_start: weekStart });
    return request(`/timesheet/submissions/status?${q.toString()}`);
  },

  async submitTimesheetWeek(weekStart: string, dates?: string[]): Promise<TimesheetSubmission> {
    return request(`/timesheet/submissions/${encodeURIComponent(weekStart)}/submit`, {
      method: 'POST',
      body: JSON.stringify({ dates: dates ?? [] }),
    });
  },

  async getPendingTimesheetSubmissions(): Promise<TimesheetSubmission[]> {
    return request('/timesheet/submissions/pending');
  },

  async getManagerTimesheetSubmissions(params?: {
    status?: 'submitted' | 'approved' | 'rejected';
    userId?: string;
    /** Exact single week. Prefer weekFrom/weekTo for a range. */
    weekStart?: string;
    /** Inclusive range: every week starting inside it is returned. */
    weekFrom?: string;
    weekTo?: string;
  }): Promise<TimesheetSubmission[]> {
    const q = new URLSearchParams();
    if (params?.status) q.set('status', params.status);
    if (params?.userId) q.set('user_id', params.userId);
    if (params?.weekStart) q.set('week_start', params.weekStart);
    if (params?.weekFrom) q.set('week_from', params.weekFrom);
    if (params?.weekTo) q.set('week_to', params.weekTo);
    const qs = q.toString();
    return request(`/timesheet/submissions${qs ? `?${qs}` : ''}`);
  },

  async getTimesheetSubmissionReview(submissionId: string): Promise<TimesheetSubmissionReview> {
    return request<TimesheetSubmissionReview>(`/timesheet/submissions/${submissionId}/review`);
  },

  async approveTimesheetSubmission(submissionId: string): Promise<TimesheetSubmission> {
    return request(`/timesheet/submissions/${submissionId}/approve`, { method: 'POST' });
  },

  async rejectTimesheetSubmission(submissionId: string, comment = ''): Promise<TimesheetSubmission> {
    return request(`/timesheet/submissions/${submissionId}/reject`, {
      method: 'POST',
      body: JSON.stringify({ comment }),
    });
  },

  async reopenTimesheetSubmission(submissionId: string): Promise<TimesheetSubmission> {
    return request(`/timesheet/submissions/${submissionId}/reopen`, { method: 'POST' });
  },

  async getKanbanColumns(): Promise<KanbanColumn[]> {
    return request('/kanban/columns');
  },

  async addKanbanColumn(label: string): Promise<KanbanColumn[]> {
    return request('/kanban/columns', { method: 'POST', body: JSON.stringify({ label }) });
  },

  async renameKanbanColumn(columnId: string, label: string): Promise<KanbanColumn[]> {
    return request(`/kanban/columns/${columnId}`, {
      method: 'PATCH',
      body: JSON.stringify({ label }),
    });
  },

  async deleteKanbanColumn(columnId: string): Promise<KanbanColumn[]> {
    return request(`/kanban/columns/${columnId}`, { method: 'DELETE' });
  },

  async reorderKanbanColumns(ids: string[]): Promise<KanbanColumn[]> {
    return request('/kanban/columns/reorder', {
      method: 'PUT',
      body: JSON.stringify({ ids }),
    });
  },

  async patchProfile(name?: string, avatar?: string): Promise<User> {
    return request('/users/me', { method: 'PATCH', body: JSON.stringify({ name, avatar }) });
  },

  async changePassword(current_password: string, new_password: string): Promise<void> {
    await request('/users/me/password', {
      method: 'POST',
      body: JSON.stringify({ current_password, new_password }),
    });
  },

  // ── Checklists ──────────────────────────────────────────────────────────────
  async getChecklists(taskId: string): Promise<TaskChecklist[]> {
    return request(`/tasks/${taskId}/checklists`);
  },

  async createChecklist(taskId: string, title: string, priority = 'Medium'): Promise<TaskChecklist> {
    return request(`/tasks/${taskId}/checklists`, {
      method: 'POST',
      body: JSON.stringify({ title, priority }),
    });
  },

  async patchChecklist(taskId: string, itemId: string, patch: { title?: string; priority?: string; isDone?: boolean }): Promise<TaskChecklist> {
    return request(`/tasks/${taskId}/checklists/${itemId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  },

  async deleteChecklist(taskId: string, itemId: string): Promise<void> {
    await request(`/tasks/${taskId}/checklists/${itemId}`, { method: 'DELETE' });
  },

  // ── Attachments ─────────────────────────────────────────────────────────────
  async getAttachments(taskId: string): Promise<TaskAttachment[]> {
    return request(`/tasks/${taskId}/attachments`);
  },

  async uploadAttachment(taskId: string, file: File): Promise<TaskAttachment> {
    const form = new FormData();
    form.append('file', file);
    return request(`/tasks/${taskId}/attachments`, { method: 'POST', body: form });
  },

  async deleteAttachment(taskId: string, attachmentId: string): Promise<void> {
    await request(`/tasks/${taskId}/attachments/${attachmentId}`, { method: 'DELETE' });
  },

  // Raw bytes for inline viewing (text/markdown/diff/image previews).
  async fetchAttachmentBlob(taskId: string, attachmentId: string): Promise<Blob> {
    const res = await fetch(`${baseUrl()}/tasks/${taskId}/attachments/${attachmentId}/download`, {
      headers: headers(false),
    });
    if (!res.ok) throw new Error('Could not load attachment');
    return res.blob();
  },

  async downloadAttachment(taskId: string, attachmentId: string, filename: string): Promise<void> {
    const res = await fetch(`${baseUrl()}/tasks/${taskId}/attachments/${attachmentId}/download`, {
      headers: headers(false),
    });
    if (!res.ok) throw new Error('Download failed');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  },

  // ── Audit Log ───────────────────────────────────────────────────────────────
  async getAuditLogs(limit = 200): Promise<AuditLog[]> {
    return request(`/audit?limit=${limit}`);
  },

  // ── Notifications ────────────────────────────────────────────────────────────
  async getNotifications(): Promise<Notification[]> {
    return request('/notifications');
  },

  async getUnreadNotificationCount(): Promise<{ count: number }> {
    return request('/notifications/unread-count');
  },

  async markNotificationRead(notificationId: number): Promise<void> {
    await request(`/notifications/${notificationId}/read`, { method: 'POST' });
  },

  async markAllNotificationsRead(): Promise<void> {
    await request('/notifications/read-all', { method: 'POST' });
  },

  // ── AI ────────────────────────────────────────────────────────────────────────
  async aiChat(
    messages: { role: 'user' | 'assistant'; content: string }[],
    users: { id: string; name: string }[],
    projects: { id: string; name: string }[],
  ): Promise<import('@/types').AIChatResponse> {
    return request('/ai/chat', {
      method: 'POST',
      body: JSON.stringify({ messages, users, projects }),
    });
  },

  async aiExtractTasks(
    form: FormData,
  ): Promise<{ sourceText: string; tasks: import('@/types').AIExtractedTask[] }> {
    // FormData body → request() omits Content-Type so the browser sets the multipart boundary.
    return request('/ai/extract-tasks', { method: 'POST', body: form });
  },

  async aiExtractPrd(
    form: FormData,
  ): Promise<{ sourceText: string; stories: import('@/types').ExtractedStoryPreview[] }> {
    return request('/ai/extract-prd', { method: 'POST', body: form });
  },

  async getPrdDraft(): Promise<import('@/types').PrdDraft> {
    return request('/prd-imports/draft');
  },

  async analyzePrd(form: FormData): Promise<import('@/types').PrdDraft> {
    return request('/prd-imports/analyze', { method: 'POST', body: form });
  },

  async patchPrdItem(
    id: string,
    body: {
      title?: string;
      description?: string;
      acceptanceCriteria?: string;
      projectId?: string | null;
      sectionId?: string | null;
      priority?: string;
    },
  ): Promise<import('@/types').PrdDraft> {
    return request(`/prd-imports/items/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
  },

  async addPrdStory(title?: string): Promise<import('@/types').PrdDraft> {
    return request('/prd-imports/stories', { method: 'POST', body: JSON.stringify({ title: title || 'Untitled story' }) });
  },

  async addPrdTask(parentId: string, title?: string): Promise<import('@/types').PrdDraft> {
    return request('/prd-imports/tasks', {
      method: 'POST',
      body: JSON.stringify({ parentId, title: title || 'Untitled task' }),
    });
  },

  async deletePrdItem(id: string): Promise<import('@/types').PrdDraft> {
    return request(`/prd-imports/items/${id}`, { method: 'DELETE' });
  },

  async discardPrdDraft(): Promise<import('@/types').PrdDraft> {
    return request('/prd-imports/draft', { method: 'DELETE' });
  },

  async commitPrdDraft(): Promise<{ storiesCreated: number; tasksCreated: number }> {
    return request('/prd-imports/commit', { method: 'POST' });
  },

  async aiParseSource(form: FormData): Promise<{ sourceText: string }> {
    // Resolve a document/audio to text (for review before extraction).
    return request('/ai/parse-source', { method: 'POST', body: form });
  },

  async aiGenerateDescription(
    title: string,
    projectName?: string,
    sectionName?: string,
    context?: string,
  ): Promise<{ description: string }> {
    return request('/ai/generate-description', {
      method: 'POST',
      body: JSON.stringify({
        title,
        project_name: projectName ?? null,
        section_name: sectionName ?? null,
        context: context ?? null,
      }),
    });
  },

  async aiSummarizeTask(taskId: string): Promise<{ summary: string }> {
    return request(`/ai/summarize-task/${taskId}`, { method: 'POST' });
  },

  async aiHealth(): Promise<{ status: string; api_key_configured: boolean }> {
    return request('/ai/health');
  },

  async aiSummarizeDay(date?: string): Promise<import('@/types').DaySummary> {
    const q = date ? `?date=${encodeURIComponent(date)}` : '';
    return request(`/ai/summarize-day${q}`);
  },

  async aiParseTimesheet(
    summary: string,
    workDate: string,
    projects: { id: string; name: string; sections: { id: string; name: string }[] }[],
  ): Promise<import('@/types').AITimesheetParseResponse> {
    return request('/ai/parse-timesheet', {
      method: 'POST',
      body: JSON.stringify({ summary, work_date: workDate, projects }),
    });
  },
};

export { TOKEN_KEY };
