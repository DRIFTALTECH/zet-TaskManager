/**
 * ZET analytics palette — matches logo indigo → violet gradient.
 * Use for Recharts fills/strokes only (not hot pinks from stock dashboards).
 */
export const ZET = {
  indigo: '#6366f1',
  violet: '#7c3aed',
  indigoBright: '#818cf8',
  indigoSoft: '#a5b4fc',
  violetSoft: '#c4b5fd',
  deep: '#4f46e5',
  /** Neutral “other / secondary metric” */
  slate: '#94a3b8',
  grid: 'hsl(var(--border))',
} as const;

/** Rotating series for stacked segments */
export const ZET_STACK: string[] = [
  ZET.indigo,
  ZET.violet,
  ZET.indigoBright,
  ZET.indigoSoft,
  ZET.violetSoft,
  ZET.deep,
];

export function zetStackColor(i: number): string {
  return ZET_STACK[i % ZET_STACK.length]!;
}
