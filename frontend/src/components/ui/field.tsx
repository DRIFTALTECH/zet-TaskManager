/**
 * The shared field label: one muted style, optional icon.
 *
 * Styling tokens live in `@/lib/field-styles` — a component file that also
 * exports plain values breaks Fast Refresh.
 */
import type { ElementType, ReactNode } from 'react';

export function FieldLabel({ icon: Icon, label }: { icon?: ElementType; label: ReactNode }) {
  return (
    <div className="mb-3 flex items-center gap-2 text-[13px] text-muted-foreground">
      {Icon ? <Icon className="h-3.5 w-3.5 shrink-0 opacity-60" /> : null}
      <span className="truncate">{label}</span>
    </div>
  );
}
