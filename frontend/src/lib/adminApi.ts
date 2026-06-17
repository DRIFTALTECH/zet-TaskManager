import type { AuditLog, Role, User } from '@/types';
import { getApiUrl } from '@/lib/env';

/**
 * Admin console API client. The admin is a standalone operator (not a normal
 * user), so its token lives under a separate key and never collides with a
 * signed-in user session.
 */

const ADMIN_TOKEN_KEY = 'tm_admin_token';

export interface AdminProject {
  id: string;
  name: string;
  memberIds: string[];
}

function baseUrl(): string {
  return getApiUrl();
}

export function getAdminToken(): string | null {
  return localStorage.getItem(ADMIN_TOKEN_KEY);
}

export function setAdminToken(token: string): void {
  localStorage.setItem(ADMIN_TOKEN_KEY, token);
}

export function clearAdminToken(): void {
  localStorage.removeItem(ADMIN_TOKEN_KEY);
}

async function parseError(res: Response): Promise<string> {
  try {
    const j = await res.json();
    if (typeof j?.detail === 'string') return j.detail;
    if (Array.isArray(j?.detail)) {
      return j.detail.map((x: { msg?: string }) => x.msg).filter(Boolean).join(', ');
    }
  } catch {
    /* ignore */
  }
  return res.statusText || 'Request failed';
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getAdminToken();
  const res = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });
  if (res.status === 401 || res.status === 403) {
    const detail = await parseError(res);
    // An expired/invalid admin token should drop the session.
    if (res.status === 401) clearAdminToken();
    throw new Error(detail || 'Unauthorized');
  }
  if (!res.ok) throw new Error(await parseError(res));
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const adminApi = {
  async login(username: string, password: string): Promise<string> {
    const r = await request<{ access_token: string }>('/admin/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    setAdminToken(r.access_token);
    return r.access_token;
  },

  listUsers(): Promise<User[]> {
    return request('/admin/users');
  },

  listProjects(): Promise<AdminProject[]> {
    return request('/admin/projects');
  },

  changeRole(userId: string, role: Role): Promise<User> {
    return request(`/admin/users/${userId}/role`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    });
  },

  resetPassword(userId: string, newPassword: string): Promise<{ ok: boolean }> {
    return request(`/admin/users/${userId}/password`, {
      method: 'POST',
      body: JSON.stringify({ new_password: newPassword }),
    });
  },

  setProjects(userId: string, projectIds: string[]): Promise<User> {
    return request(`/admin/users/${userId}/projects`, {
      method: 'PUT',
      body: JSON.stringify({ project_ids: projectIds }),
    });
  },

  deactivate(userId: string): Promise<User> {
    return request(`/admin/users/${userId}/deactivate`, { method: 'POST' });
  },

  activate(userId: string): Promise<User> {
    return request(`/admin/users/${userId}/activate`, { method: 'POST' });
  },

  deleteUser(userId: string, reassignTo: string | null): Promise<{ ok: boolean }> {
    return request(`/admin/users/${userId}/delete`, {
      method: 'POST',
      body: JSON.stringify({ reassign_to: reassignTo }),
    });
  },

  listAudit(limit = 200): Promise<AuditLog[]> {
    return request(`/admin/audit?limit=${limit}`);
  },

  changeAdminPassword(currentPassword: string, newPassword: string): Promise<{ ok: boolean }> {
    return request('/admin/password', {
      method: 'POST',
      body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
    });
  },
};
