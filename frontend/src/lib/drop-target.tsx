import { createContext, useContext } from 'react';

/**
 * The card a drag is hovering that would take the item inside it.
 *
 * A drop onto a card and a drop onto the column behind it are the same gesture
 * until you let go, so the board gave no sign which was about to happen — the
 * question only arrived after the fact. The host card nudges while the cursor
 * is over it, which answers it beforehand.
 *
 * Carried as context rather than a prop: cards sit four levels down (column →
 * story → task → subtask) and every level in between would otherwise have to
 * forward a value it has no use for.
 */
export const DropHostContext = createContext<string | null>(null);

/** True while `id` is the card a drop would land inside. */
export function useIsDropHost(id: string): boolean {
  return useContext(DropHostContext) === id;
}

/**
 * Applied to the card being hovered. The nudge is deliberately small — it says
 * "this one is listening", not "something is wrong" — and the ring carries the
 * meaning for anyone who has asked for less motion.
 */
export const DROP_HOST_CLASS =
  'motion-safe:animate-drop-nudge ring-2 ring-primary/50 ring-offset-1 ring-offset-background';
