import type { KanbanColumn, Project, Role, Task, TaskFeedback, TimesheetWorkEntry, User } from '@/types';

const TOKEN_KEY = 'tm_token';

function baseUrl(): string {
  const raw = import.meta.env.VITE_API_URL as string | undefined;
  if (!raw?.trim()) {
    throw new Error('VITE_API_URL is missing. Set it in frontend/.env (see Vite env docs).');
  }
  return raw.replace(/\/+$/, '');
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
    localStorage.removeItem(TOKEN_KEY);
    throw new Error('Unauthorized');
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

  async getMe(): Promise<User> {
    return request('/users/me');
  },

  async getUsers(): Promise<User[]> {
    return request('/users');
  },

  async getProjects(): Promise<Project[]> {
    return request('/projects');
  },

  async createProject(name: string, description: string): Promise<Project> {
    return request('/projects', { method: 'POST', body: JSON.stringify({ name, description }) });
  },

  async addSection(projectId: string, name: string): Promise<Project> {
    return request(`/projects/${projectId}/sections`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
  },

  async deleteProjectSection(projectId: string, sectionId: string): Promise<Project> {
    return request(`/projects/${projectId}/sections/${sectionId}`, { method: 'DELETE' });
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
    }>,
  ): Promise<Task> {
    return request(`/tasks/${taskId}`, { method: 'PATCH', body: JSON.stringify(patch) });
  },

  async startTask(taskId: string): Promise<Task> {
    return request(`/tasks/${taskId}/start`, { method: 'POST' });
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

  async createTaskFeedback(taskId: string, message: string): Promise<TaskFeedback> {
    return request(`/tasks/${taskId}/feedback`, { method: 'POST', body: JSON.stringify({ message }) });
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
    return request(`/timesheet/entries?${q.toString()}`);
  },

  /** Manager-only: another user's entries in the date range. */
  async getTimesheetWorkEntriesForUser(userId: string, start: string, end: string): Promise<TimesheetWorkEntry[]> {
    const q = new URLSearchParams({ start, end });
    return request(`/timesheet/users/${userId}/entries?${q.toString()}`);
  },

  async createTimesheetWorkEntry(body: {
    workDate: string;
    projectId: string;
    sectionId: string;
    description: string;
    timeFrom: string;
    timeTo: string;
  }): Promise<TimesheetWorkEntry> {
    return request('/timesheet/entries', { method: 'POST', body: JSON.stringify(body) });
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
    }>,
  ): Promise<TimesheetWorkEntry> {
    return request(`/timesheet/entries/${entryId}`, { method: 'PATCH', body: JSON.stringify(body) });
  },

  async deleteTimesheetWorkEntry(entryId: string): Promise<void> {
    await request(`/timesheet/entries/${entryId}`, { method: 'DELETE' });
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
};

export { TOKEN_KEY };
