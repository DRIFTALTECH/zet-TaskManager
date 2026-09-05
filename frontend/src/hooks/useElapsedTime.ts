import { useEffect, useState } from 'react';

/**
 * Live "how long has this timer been running" string, re-rendering once a
 * second. Returns '' when nothing is running.
 *
 * The board card, the list row and the task modal all show the same running
 * clock, so it lives here rather than as a third private copy.
 */
export function useElapsedTime(epochStart: number | null): string {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!epochStart) return;
    const id = setInterval(() => setTick(n => n + 1), 1000);
    return () => clearInterval(id);
  }, [epochStart]);
  if (!epochStart) return '';
  const secs = Math.max(0, Math.floor((Date.now() - epochStart) / 1000));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}
