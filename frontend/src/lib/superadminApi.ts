import type { AuditLog, Role, User } from '@/types';
import { getApiUrl } from '@/lib/env';

/**
 * Superadmin console API client.
 *
 * The superadmin is a normal user row with role="superadmin", so this client
 * reuses the ordinary session token — there is no separate console login and no
 * second token in storage. The backend re-checks the role on every request.
 */

const TOKEN_KEY = 'tm_token';

export interface SuperadminProject {
  id: string;
  name: string;
  memberIds: string[];
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
  const token = localStorage.getItem(TOKEN_KEY);
  const res = await fetch(`${getApiUrl()}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });
  if (!res.ok) throw new Error(await parseError(res));
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const superadminApi = {
  listUsers(): Promise<User[]> {
    return request('/superadmin/users');
  },

  /** Accounts that registered but have not been approved yet. */
  listPendingUsers(): Promise<User[]> {
    return request('/superadmin/users/pending');
  },

  listProjects(): Promise<SuperadminProject[]> {
    return request('/superadmin/projects');
  },

  changeRole(userId: string, role: Role): Promise<User> {
    return request(`/superadmin/users/${userId}/role`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    });
  },

  setManager(userId: string, managerId: string | null): Promise<User> {
    return request(`/superadmin/users/${userId}/manager`, {
      method: 'PATCH',
      body: JSON.stringify({ managerId }),
    });
  },

  resetPassword(userId: string, newPassword: string): Promise<{ ok: boolean }> {
    return request(`/superadmin/users/${userId}/password`, {
      method: 'POST',
      body: JSON.stringify({ new_password: newPassword }),
    });
  },

  setProjects(userId: string, projectIds: string[]): Promise<User> {
    return request(`/superadmin/users/${userId}/projects`, {
      method: 'PUT',
      body: JSON.stringify({ project_ids: projectIds }),
    });
  },

  activate(userId: string): Promise<User> {
    return request(`/superadmin/users/${userId}/activate`, { method: 'POST' });
  },

  deactivate(userId: string): Promise<User> {
    return request(`/superadmin/users/${userId}/deactivate`, { method: 'POST' });
  },

  deleteUser(userId: string, reassignTo: string | null): Promise<{ ok: boolean }> {
    return request(`/superadmin/users/${userId}/delete`, {
      method: 'POST',
      body: JSON.stringify({ reassign_to: reassignTo }),
    });
  },

  listAudit(limit = 200): Promise<AuditLog[]> {
    return request(`/superadmin/audit?limit=${limit}`);
  },
};
