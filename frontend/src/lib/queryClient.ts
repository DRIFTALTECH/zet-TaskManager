import { QueryClient } from '@tanstack/react-query';
import type { Task } from '@/types';

/** Shared client so Zustand mutations and live-sync can invalidate the same cache. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: false,
    },
  },
});

export const taskKeys = {
  detail: (id: string) => ['task', id] as const,
  feedback: (id: string) => ['task', id, 'feedback'] as const,
  attachments: (id: string) => ['task', id, 'attachments'] as const,
  checklists: (id: string) => ['task', id, 'checklists'] as const,
};

export const projectKeys = {
  userStories: (id: string) => ['project', id, 'user-stories'] as const,
};

export function cacheFullTask(t: Task) {
  queryClient.setQueryData(taskKeys.detail(t.id), t);
}

export function dropFullTask(id: string) {
  queryClient.removeQueries({ queryKey: taskKeys.detail(id) });
}

/** Live-sync bump: drop cached full bodies + nested task resources. */
export function invalidateTaskDetails() {
  void queryClient.invalidateQueries({ queryKey: ['task'] });
}

export function invalidateProjectDetails() {
  void queryClient.invalidateQueries({ queryKey: ['project'] });
}
