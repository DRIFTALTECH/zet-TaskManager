import { useEffect, useState } from 'react';

/**
 * True only once `active` has held for `delayMs` — a spinner for slow work
 * without a flicker on fast work.
 *
 * Most saves come back before anyone could read a spinner, and one that appears
 * and vanishes inside 100ms reads as a glitch rather than as progress. Waiting
 * means the indicator only ever appears when there is genuinely something to
 * wait for, which is the only time it says anything.
 */
export function useSlowFlag(active: boolean, delayMs = 350): boolean {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    if (!active) {
      setSlow(false);
      return;
    }
    const timer = setTimeout(() => setSlow(true), delayMs);
    return () => clearTimeout(timer);
  }, [active, delayMs]);

  return slow;
}

export default useSlowFlag;
