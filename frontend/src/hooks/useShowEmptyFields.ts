import { useCallback, useState } from 'react';

const KEY = 'zet.detail.showEmptyFields';

/**
 * Detail modals collapse unset fields by default — a screen of empty date and
 * tag slots pushes the description and comments below the fold. The choice is a
 * per-reader habit rather than shared state, so it lives in localStorage.
 */
export function useShowEmptyFields() {
  const [showEmpty, setShowEmpty] = useState(() => {
    try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
  });

  const toggleEmptyFields = useCallback(() => {
    setShowEmpty(prev => {
      const next = !prev;
      try { localStorage.setItem(KEY, next ? '1' : '0'); } catch { /* storage blocked */ }
      return next;
    });
  }, []);

  return { showEmpty, toggleEmptyFields };
}
