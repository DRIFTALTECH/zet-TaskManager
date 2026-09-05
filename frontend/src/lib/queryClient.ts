import { QueryClient } from '@tanstack/react-query';
import type { Task, UserStory } from '@/types';

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

export const storyKeys = {
  all: ['user-stories'] as const,
  detail: (id: string) => ['user-story', id] as const,
  feedback: (id: string) => ['user-story', id, 'feedback'] as const,
};

export const projectKeys = {
  userStories: (id: string) => ['project', id, 'user-stories'] as const,
};

/** Stories stay cached until a mutation or live-sync marks them stale. */
export const STORY_STALE_TIME = Infinity;

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

export function seedUserStoriesCache(stories: UserStory[], projectIds: string[] = []) {
  queryClient.setQueryData(storyKeys.all, stories);
  const byProject = new Map<string, UserStory[]>();
  for (const id of projectIds) byProject.set(id, []);
  for (const s of stories) {
    const list = byProject.get(s.projectId);
    if (list) list.push(s);
    else byProject.set(s.projectId, [s]);
  }
  for (const [pid, rows] of byProject) {
    queryClient.setQueryData(projectKeys.userStories(pid), rows);
  }
}

export function upsertUserStory(story: UserStory) {
  queryClient.setQueryData<UserStory[]>(storyKeys.all, old => {
    const cur = old ?? [];
    const i = cur.findIndex(s => s.id === story.id);
    if (i < 0) return [story, ...cur];
    const next = cur.slice();
    next[i] = story;
    return next;
  });
  queryClient.setQueryData<UserStory[]>(projectKeys.userStories(story.projectId), old => {
    const cur = old ?? [];
    const i = cur.findIndex(s => s.id === story.id);
    if (i < 0) return [story, ...cur];
    const next = cur.slice();
    next[i] = story;
    return next;
  });
}

export function removeUserStory(storyId: string, projectId: string) {
  queryClient.setQueryData<UserStory[]>(storyKeys.all, old => (old ?? []).filter(s => s.id !== storyId));
  queryClient.setQueryData<UserStory[]>(
    projectKeys.userStories(projectId),
    old => (old ?? []).filter(s => s.id !== storyId),
  );
}

export function invalidateUserStories() {
  // Returns the refetch so a caller painting an optimistic move can hold that
  // paint until real data replaces it. Callers that do not care may ignore it.
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: storyKeys.all }),
    queryClient.invalidateQueries({ queryKey: ['project'] }),
  ]);
}
