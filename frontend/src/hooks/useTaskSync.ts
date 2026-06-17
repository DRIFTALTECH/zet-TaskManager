import { useEffect } from 'react';
import { api } from '@/lib/api';
import { useAppStore } from '@/stores/appStore';

const POLL_MS = 4000;

/**
 * Smart polling for live updates across tasks, projects, and users.
 *
 * Polls the tiny `/sync/version` endpoint every few seconds and only refetches
 * the channel whose version actually moved — so a teammate assigning a task,
 * adding a project member, creating a section, or changing a role shows up
 * automatically without a reload, and without hammering the database.
 *
 * Mount once, inside the authenticated app shell.
 */
export function useLiveSync() {
  const currentUserId = useAppStore(s => s.currentUser?.id ?? null);

  useEffect(() => {
    if (!currentUserId) return;

    let cancelled = false;
    let inFlight = false;
    const last = { tasks: -1, projects: -1, users: -1 };

    const tick = async () => {
      if (inFlight || document.hidden) return; // skip when a poll is pending or tab is hidden
      inFlight = true;
      try {
        const v = await api.getSyncVersion();
        if (cancelled) return;
        const store = useAppStore.getState();
        const first = last.tasks === -1;

        if (!first && v.tasks !== last.tasks) await store.syncTasks();
        // Projects and users are fetched together; one call covers both channels.
        if (!first && (v.projects !== last.projects || v.users !== last.users)) {
          await store.syncProjectsAndUsers();
        }

        last.tasks = v.tasks;
        last.projects = v.projects;
        last.users = v.users;
      } catch {
        // ignore — try again next tick
      } finally {
        inFlight = false;
      }
    };

    void tick();
    const timer = setInterval(() => void tick(), POLL_MS);
    const onVisible = () => { if (!document.hidden) void tick(); };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [currentUserId]);
}
