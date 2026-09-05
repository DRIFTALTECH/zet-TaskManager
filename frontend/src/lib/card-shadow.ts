/**
 * Card elevation for the board and the list.
 *
 * A shadow darkens what is behind it. The dark-mode variants used to be white
 * — `rgba(255,255,255,…)` — which paints a halo around every card instead of a
 * shadow, and is what made the dark board look lit from within. Dark themes
 * need a *stronger* black shadow, not an inverted one, because there is less
 * contrast between the card and the ground to begin with.
 */
export const CARD_SHADOW =
  'shadow-[0_1px_4px_rgba(0,0,0,0.10)] hover:shadow-[0_2px_8px_rgba(0,0,0,0.14)] ' +
  'dark:shadow-[0_1px_3px_rgba(0,0,0,0.55)] dark:hover:shadow-[0_4px_12px_rgba(0,0,0,0.65)]';

/** The flatter elevation used by list rows. */
export const ROW_SHADOW =
  'shadow-[0_1px_2px_rgba(0,0,0,0.06)] hover:shadow-[0_1px_5px_rgba(0,0,0,0.10)] ' +
  'dark:shadow-[0_1px_2px_rgba(0,0,0,0.45)] dark:hover:shadow-[0_2px_6px_rgba(0,0,0,0.55)]';
