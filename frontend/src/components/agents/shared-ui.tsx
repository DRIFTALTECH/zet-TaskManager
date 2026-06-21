const TONES: Record<string, string> = {
  violet: 'bg-violet-500/15 text-violet-400',
  emerald: 'bg-emerald-500/15 text-emerald-400',
  rose: 'bg-rose-500/15 text-rose-400',
  amber: 'bg-amber-500/15 text-amber-400',
  muted: 'bg-muted text-muted-foreground/60',
};

/** A row in a mascot action menu: icon chip + label + optional sub-label. */
export function MenuItem({ icon, label, sub, tone = 'violet', disabled, onClick }: {
  icon: React.ReactNode; label: string; sub?: string; tone?: string; disabled?: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-full flex items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-muted/50 disabled:opacity-50 disabled:hover:bg-transparent"
    >
      <span className={`shrink-0 inline-flex h-8 w-8 items-center justify-center rounded-lg ${TONES[tone] ?? TONES.violet}`}>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-foreground">{label}</span>
        {sub && <span className="block truncate text-[11px] text-muted-foreground/60">{sub}</span>}
      </span>
    </button>
  );
}

/** A small stat tile used in recap modals. */
export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border/40 bg-muted/20 px-3 py-2.5 text-center">
      <p className="text-lg font-bold tabular-nums text-foreground leading-tight">{value}</p>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60 mt-0.5">{label}</p>
    </div>
  );
}
