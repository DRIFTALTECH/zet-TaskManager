/**
 * Drag empty dashboard space to pan the page scroll (Figma-style).
 * Wheel scrolling unchanged. Interactive elements opt out via data-no-pan or tag match.
 */

import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

const INTERACTIVE =
  'button, a, input, textarea, select, option, label, summary, details, [role="button"], [role="menuitem"], [role="tab"], [role="combobox"], [role="listbox"], [role="switch"], [role="checkbox"], [role="radio"], [contenteditable], [data-no-pan], .recharts-wrapper, .recharts-surface, canvas, [data-radix-popper-content-wrapper], [data-radix-select-viewport], [class*="bg-card"], [class*="rounded-2xl"][class*="border"], [class*="rounded-xl"][class*="border"], table, thead, tbody, tr, td, th';

function isInteractive(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest(INTERACTIVE);
}

export function DashboardPanArea({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const pan = useRef({ active: false, startX: 0, startY: 0, scrollLeft: 0, scrollTop: 0 });
  const scrollEl = useRef<HTMLElement | null>(null);

  const clearPanCursor = useCallback(() => {
    ref.current?.style.removeProperty('cursor');
    document.body.style.removeProperty('cursor');
    document.body.style.removeProperty('user-select');
  }, []);

  const setGrabCursor = useCallback((target: EventTarget | null) => {
    const el = ref.current;
    if (!el || pan.current.active) return;
    if (isInteractive(target)) {
      el.style.removeProperty('cursor');
    } else {
      el.style.cursor = 'grab';
    }
  }, []);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!pan.current.active || !scrollEl.current) return;
      e.preventDefault();
      scrollEl.current.scrollLeft = pan.current.scrollLeft - (e.clientX - pan.current.startX);
      scrollEl.current.scrollTop = pan.current.scrollTop - (e.clientY - pan.current.startY);
    };

    const onUp = (e: PointerEvent) => {
      if (!pan.current.active) return;
      pan.current.active = false;
      scrollEl.current = null;
      clearPanCursor();
      setGrabCursor(e.target);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      pan.current.active = false;
      clearPanCursor();
    };
  }, [clearPanCursor, setGrabCursor]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || isInteractive(e.target)) return;
    const main = ref.current?.closest('main');
    if (!main) return;

    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);

    pan.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      scrollLeft: main.scrollLeft,
      scrollTop: main.scrollTop,
    };
    scrollEl.current = main;

    if (ref.current) ref.current.style.cursor = 'grabbing';
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';
  };

  return (
    <div
      ref={ref}
      className={cn('min-h-full', className)}
      onPointerDown={onPointerDown}
      onPointerMove={(e) => setGrabCursor(e.target)}
      onPointerLeave={() => {
        if (!pan.current.active) ref.current?.style.removeProperty('cursor');
      }}
    >
      {children}
    </div>
  );
}
