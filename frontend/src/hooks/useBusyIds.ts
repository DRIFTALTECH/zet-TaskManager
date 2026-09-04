import { useCallback, useState } from 'react';

/**
 * Which items have a request in flight.
 *
 * A move on a slow connection can take a second or more, and with nothing on
 * screen saying so people click again or decide the app is broken. Every
 * mutation runs through here so the row or card it touches can show that it is
 * working, and the whole view can show that something is happening.
 */
export function useBusyIds() {
  const [busyIds, setBusyIds] = useState<Set<string>>(() => new Set());

  const mark = useCallback((ids: string[], busy: boolean) => {
    setBusyIds(prev => {
      const next = new Set(prev);
      for (const id of ids) {
        if (busy) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }, []);

  /** Runs `fn`, marking `ids` busy until it settles — including on failure. */
  const withBusy = useCallback(
    async <T,>(ids: string | string[], fn: () => Promise<T>): Promise<T> => {
      const list = Array.isArray(ids) ? ids : [ids];
      mark(list, true);
      try {
        return await fn();
      } finally {
        mark(list, false);
      }
    },
    [mark],
  );

  return { busyIds, withBusy, busy: busyIds.size > 0 };
}
