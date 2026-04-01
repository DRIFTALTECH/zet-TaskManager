import type { Transition } from 'framer-motion';

/** Short tween — avoids slow default springs on whileHover / whileTap */
export const snappy: Transition = { type: 'tween', duration: 0.12, ease: 'easeOut' };

/** Layout / column animations */
export const snappyLayout: Transition = { type: 'tween', duration: 0.18, ease: 'easeOut' };

/** Page / section fade-in */
export const pageEnter: Transition = { type: 'tween', duration: 0.18, ease: 'easeOut' };

/** Cards: fast hover + slightly longer layout */
export const cardMotion: Transition = {
  type: 'tween',
  duration: 0.12,
  ease: 'easeOut',
  layout: { type: 'tween', duration: 0.16, ease: 'easeOut' },
};
