// Stable color palette for project / section pills (shared across timesheet + calendar).
const ID_PILL_PALETTES = [
  'bg-blue-500/15 text-blue-400 border-blue-500/25',
  'bg-violet-500/15 text-violet-400 border-violet-500/25',
  'bg-emerald-500/15 text-emerald-400 border-emerald-500/25',
  'bg-orange-500/15 text-orange-400 border-orange-500/25',
  'bg-pink-500/15 text-pink-400 border-pink-500/25',
  'bg-teal-500/15 text-teal-400 border-teal-500/25',
  'bg-amber-500/15 text-amber-400 border-amber-500/25',
  'bg-cyan-500/15 text-cyan-400 border-cyan-500/25',
  'bg-indigo-500/15 text-indigo-400 border-indigo-500/25',
  'bg-rose-500/15 text-rose-400 border-rose-500/25',
];

export function idPillColor(id: string): string {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  return ID_PILL_PALETTES[h % ID_PILL_PALETTES.length];
}

/** Stable hue (0–359) for an id — used for calendar block colors. */
export function idHue(id: string): number {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 360;
}
