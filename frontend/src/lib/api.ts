import type { AuditLog, Client, KanbanColumn, Notification, Project, Role, Skill, Task, TaskAttachment, TaskChecklist, TaskFeedback, TimesheetSubmission, TimesheetSubmissionReview, TimesheetWorkEntry, User } from '@/types';
import { getApiUrl } from '@/lib/env';
import { shiftDate } from '@/lib/utils';

const TOKEN_KEY = 'tm_token';

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
    localStorage.removeItem(TOKEN_KEY);
    // Session expired / unauthorized → bounce to login (unless already on an auth page).
    if (typeof window !== 'undefined') {
      const p = window.location.pathname;
      if (p !== '/login' && p !== '/signup') {
        window.location.href = '/login';
      }
    }
    throw new Error(detail || 'Unauthorized');
  }
  if (!res.ok) throw new Error(await parseError(res));
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function clearStoredToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

function mapEntryToLocal(entry: TimesheetWorkEntry): TimesheetWorkEntry {
  if (!entry.workDate || !entry.timeFrom || !entry.timeTo) {
    return entry;
  }
  try {
    const startDt = new Date(`${entry.workDate}T${entry.timeFrom}:00Z`);
    if (Number.isNaN(startDt.getTime())) return entry;

    let endDt = new Date(`${entry.workDate}T${entry.timeTo}:00Z`);
    if (entry.timeTo < entry.timeFrom) {
      endDt.setDate(endDt.getDate() + 1);
    }
    if (Number.isNaN(endDt.getTime())) return entry;

    const startYear = startDt.getFullYear();
    const startMonth = String(startDt.getMonth() + 1).padStart(2, '0');
    const startDate = String(startDt.getDate()).padStart(2, '0');
    const localWorkDate = `${startYear}-${startMonth}-${startDate}`;
    
    const localTimeFrom = `${String(startDt.getHours()).padStart(2, '0')}:${String(startDt.getMinutes()).padStart(2, '0')}`;
    const localTimeTo = `${String(endDt.getHours()).padStart(2, '0')}:${String(endDt.getMinutes()).padStart(2, '0')}`;

    return {
      ...entry,
      workDate: localWorkDate,
      timeFrom: localTimeFrom,
      timeTo: localTimeTo,
    };
  } catch {
    return entry;
  }
}

function mapEntryToUtc<T extends { workDate: string; timeFrom: string; timeTo: string }>(body: T): T {
  if (!body.workDate || !body.timeFrom || !body.timeTo) {
    return body;
  }
  try {
    const [y, m, d] = body.workDate.split('-').map(Number);
    const [h1, mm1] = body.timeFrom.split(':').map(Number);
    const [h2, mm2] = body.timeTo.split(':').map(Number);

    const startDt = new Date(y!, m! - 1, d!, h1!, mm1!, 0);
    let endDt = new Date(y!, m! - 1, d!, h2!, mm2!, 0);
    if (body.timeTo < body.timeFrom) {
      endDt.setDate(endDt.getDate() + 1);
    }

    if (Number.isNaN(startDt.getTime()) || Number.isNaN(endDt.getTime())) return body;

    const utcYear = startDt.getUTCFullYear();
    const utcMonth = String(startDt.getUTCMonth() + 1).padStart(2, '0');
    const utcDate = String(startDt.getUTCDate()).padStart(2, '0');
    const utcWorkDate = `${utcYear}-${utcMonth}-${utcDate}`;

    const utcTimeFrom = `${String(startDt.getUTCHours()).padStart(2, '0')}:${String(startDt.getUTCMinutes()).padStart(2, '0')}`;
    const utcTimeTo = `${String(endDt.getUTCHours()).padStart(2, '0')}:${String(endDt.getUTCMinutes()).padStart(2, '0')}`;

    return {
      ...body,
      workDate: utcWorkDate,
      timeFrom: utcTimeFrom,
      timeTo: utcTimeTo,
    };
  } catch {
    return body;
  }
}

export const api = {
  async login(email: string, password: string, rememberMe = false): Promise<{ access_token: string; user: User }> {
    return request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password, remember_me: rememberMe }),
    });
  },

  async register(
    name: string,
    email: string,
    password: string,
    role: Role = 'employee',
  ): Promise<{ access_token: string; user: User }> {
    return request('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name, email, password, role }),
    });
  },

  async loginMicrosoft(
    idToken: string,
    rememberMe = false,
    role?: Role,
    jobTitle?: string,
    experienceMonths?: number,
  ): Promise<{ access_token: string; user: User }> {
    const body: Record<string, unknown> = {
      id_token: idToken,
      remember_me: rememberMe,
    };
    if (role) body.role = role;
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
    priority: string;
    tags: string[];
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
      sectionId: string;
      assigneeIds: string[];
      customFields: Record<string, string>;
      dueDate: string;
      minLogMinutes: number;
    }>,
  ): Promise<Task> {
    return request(`/tasks/${taskId}`, { method: 'PATCH', body: JSON.stringify(patch) });
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
    const fetchStart = shiftDate(start, -1);
    const fetchEnd = shiftDate(end, 1);
    const q = new URLSearchParams({ start: fetchStart, end: fetchEnd });
    const entries = await request<TimesheetWorkEntry[]>(`/timesheet/entries?${q.toString()}`);
    return entries.map(mapEntryToLocal).filter(e => e.workDate >= start && e.workDate <= end);
  },

  /** Manager-only: another user's entries in the date range. */
  async getTimesheetWorkEntriesForUser(userId: string, start: string, end: string): Promise<TimesheetWorkEntry[]> {
    const fetchStart = shiftDate(start, -1);
    const fetchEnd = shiftDate(end, 1);
    const q = new URLSearchParams({ start: fetchStart, end: fetchEnd });
    const entries = await request<TimesheetWorkEntry[]>(`/timesheet/users/${userId}/entries?${q.toString()}`);
    return entries.map(mapEntryToLocal).filter(e => e.workDate >= start && e.workDate <= end);
  },

  /** Manager/admin: every member's entries in the date range (visibility-scoped). */
  async getTeamTimesheetEntries(start: string, end: string): Promise<TimesheetWorkEntry[]> {
    const fetchStart = shiftDate(start, -1);
    const fetchEnd = shiftDate(end, 1);
    const q = new URLSearchParams({ start: fetchStart, end: fetchEnd });
    const entries = await request<TimesheetWorkEntry[]>(`/timesheet/entries/all?${q.toString()}`);
    return entries.map(mapEntryToLocal).filter(e => e.workDate >= start && e.workDate <= end);
  },

  /** Manager-only: every timesheet entry logged against a project, across all members. */
  async getProjectTimesheetEntries(projectId: string): Promise<TimesheetWorkEntry[]> {
    const entries = await request<TimesheetWorkEntry[]>(`/timesheet/projects/${projectId}/entries`);
    return entries.map(mapEntryToLocal);
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
    const utcBody = mapEntryToUtc(body);
    const entry = await request<TimesheetWorkEntry>('/timesheet/entries', { method: 'POST', body: JSON.stringify(utcBody) });
    return mapEntryToLocal(entry);
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
    const utcBody = (body.workDate && body.timeFrom && body.timeTo)
      ? mapEntryToUtc(body as any)
      : body;
    const entry = await request<TimesheetWorkEntry>(`/timesheet/entries/${entryId}`, { method: 'PATCH', body: JSON.stringify(utcBody) });
    return mapEntryToLocal(entry);
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
    weekStart?: string;
  }): Promise<TimesheetSubmission[]> {
    const q = new URLSearchParams();
    if (params?.status) q.set('status', params.status);
    if (params?.userId) q.set('user_id', params.userId);
    if (params?.weekStart) q.set('week_start', params.weekStart);
    const qs = q.toString();
    return request(`/timesheet/submissions${qs ? `?${qs}` : ''}`);
  },

  async getTimesheetSubmissionReview(submissionId: string): Promise<TimesheetSubmissionReview> {
    const review = await request<TimesheetSubmissionReview>(`/timesheet/submissions/${submissionId}/review`);
    if (review && review.days) {
      review.days = review.days.map(day => {
        const mappedEntries = day.entries.map(e => {
          const mapped = mapEntryToLocal(e as any);
          return mapped as unknown as typeof e;
        });
        const localDate = mappedEntries[0]?.workDate || day.workDate;
        return {
          ...day,
          workDate: localDate,
          entries: mappedEntries,
        };
      });
    }
    return review;
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
