/**
 * Grab empty kanban board space to pan the board scroll container (Figma-style).
 * Does not interfere with dnd-kit drag-and-drop on task cards or column grips.
 */

import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

const INTERACTIVE =
  'button, a, input, textarea, select, option, label, [role="button"], [role="menuitem"], [role="combobox"], [role="listbox"], [role="checkbox"], [data-no-pan], [data-kanban-task], [data-radix-popper-content-wrapper], [data-radix-select-viewport]';

function isInteractive(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest(INTERACTIVE);
}

export function KanbanBoardPan({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const pan = useRef({ active: false, startX: 0, startY: 0, scrollLeft: 0, scrollTop: 0 });

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
      if (!pan.current.active || !ref.current) return;
      e.preventDefault();
      ref.current.scrollLeft = pan.current.scrollLeft - (e.clientX - pan.current.startX);
      ref.current.scrollTop = pan.current.scrollTop - (e.clientY - pan.current.startY);
    };

    const onUp = (e: PointerEvent) => {
      if (!pan.current.active) return;
      pan.current.active = false;
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
    if (e.button !== 0 || isInteractive(e.target) || !ref.current) return;

    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);

    pan.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      scrollLeft: ref.current.scrollLeft,
      scrollTop: ref.current.scrollTop,
    };

    ref.current.style.cursor = 'grabbing';
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';
  };

  return (
    <div
      ref={ref}
      className={cn('overflow-x-auto overflow-y-hidden scrollbar-none min-h-0', className)}
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
