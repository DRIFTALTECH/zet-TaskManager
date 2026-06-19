import { useEffect } from 'react';
import { api, getStoredToken } from '@/lib/api';
import { useAppStore } from '@/stores/appStore';
import { getApiUrl } from '@/lib/env';

const POLL_MS = 4000; // polling fallback cadence when WebSocket is unavailable

type Versions = { tasks: number; projects: number; users: number };

function wsUrl(): string {
  const base = getApiUrl(); // http(s)://host:port
  const ws = base.replace(/^http/i, 'ws');
  const token = getStoredToken() ?? '';
  return `${ws}/sync/ws?token=${encodeURIComponent(token)}`;
}

/**
 * Live updates across tasks, projects, and users.
 *
 * Primary transport is a WebSocket (`/sync/ws`): the server pushes a version
 * snapshot on every write and we refetch only the channel that changed. If the
 * socket can't connect (blocked proxy, etc.) we transparently fall back to
 * polling `/sync/version`. On every (re)connect we do one full reconcile so no
 * change is missed across a gap.
 *
 * Mount once, inside the authenticated app shell.
 */
export function useLiveSync() {
  const currentUserId = useAppStore(s => s.currentUser?.id ?? null);

  useEffect(() => {
    if (!currentUserId) return;

    let cancelled = false;
    let socket: WebSocket | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let inFlight = false;
    let backoff = 1000;
    const last: Versions = { tasks: -1, projects: -1, users: -1 };

    const applyVersions = async (v: Versions) => {
      const store = useAppStore.getState();
      const first = last.tasks === -1;
      if (!first && v.tasks !== last.tasks) await store.syncTasks();
      if (!first && (v.projects !== last.projects || v.users !== last.users)) {
        await store.syncProjectsAndUsers();
      }
      last.tasks = v.tasks; last.projects = v.projects; last.users = v.users;
    };

    // Pull everything once — used on (re)connect to close any gap.
    const fullReconcile = async () => {
      const store = useAppStore.getState();
      try {
        await Promise.all([store.syncTasks(), store.syncProjectsAndUsers()]);
      } catch { /* ignore */ }
    };

    // ── Polling fallback ──────────────────────────────────────────────────────
    const poll = async () => {
      if (inFlight || document.hidden) return;
      inFlight = true;
      try {
        const v = await api.getSyncVersion();
        if (!cancelled) await applyVersions(v as Versions);
      } catch { /* try again next tick */ } finally { inFlight = false; }
    };

    const startPolling = () => {
      if (pollTimer) return;
      void poll();
      pollTimer = setInterval(() => void poll(), POLL_MS);
    };
    const stopPolling = () => {
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    };

    // ── WebSocket (primary) ───────────────────────────────────────────────────
    const connect = () => {
      if (cancelled) return;
      let ws: WebSocket;
      try {
        ws = new WebSocket(wsUrl());
      } catch {
        startPolling();
        return;
      }
      socket = ws;

      ws.onopen = () => {
        backoff = 1000;
        stopPolling();           // socket is live — stop the fallback
        void fullReconcile();    // close any gap since last connection
      };

      ws.onmessage = ev => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg?.type === 'sync' && msg.versions) void applyVersions(msg.versions as Versions);
        } catch { /* ignore malformed frame */ }
      };

      ws.onclose = () => {
        socket = null;
        if (cancelled) return;
        startPolling();          // keep updates flowing while we retry
        reconnectTimer = setTimeout(connect, backoff);
        backoff = Math.min(backoff * 2, 30000);
      };

      ws.onerror = () => { try { ws.close(); } catch { /* noop */ } };
    };

    connect();

    const onVisible = () => { if (!document.hidden && !socket) void poll(); };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      stopPolling();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      document.removeEventListener('visibilitychange', onVisible);
      if (socket) { try { socket.close(); } catch { /* noop */ } socket = null; }
    };
  }, [currentUserId]);
}
