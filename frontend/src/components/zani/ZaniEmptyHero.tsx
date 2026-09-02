import { motion } from 'framer-motion';
import { AlertCircle, Sparkles } from 'lucide-react';
import AgentAvatar from '@/components/agents/AgentAvatar';
import { ZaniComposer } from './ZaniComposer';
import { ZANI_CAPABILITIES, ZANI_SUGGESTIONS } from './constants';
import { cn } from '@/lib/utils';

export function ZaniEmptyHero({
  input,
  onChange,
  onSend,
  loading,
  onSuggestion,
  warnNoUsers,
}: {
  input: string;
  onChange: (v: string) => void;
  onSend: () => void;
  loading: boolean;
  onSuggestion: (text: string) => void;
  warnNoUsers?: boolean;
}) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-4 py-8 min-h-0 overflow-auto">
      <div className="w-full max-w-3xl flex flex-col items-center gap-10">
        {/* Hero */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: 'easeOut' }}
          className="flex flex-col items-center text-center gap-5"
        >
          <div className="relative">
            <div className="absolute -inset-6 rounded-full bg-violet-500/20 blur-3xl" aria-hidden />
            <AgentAvatar agent="zani" size={88} mood="idle" />
          </div>
          <div className="space-y-2">
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-violet-500/80 flex items-center justify-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5" /> ZET assistant
            </p>
            <h1 className="font-display text-4xl sm:text-[2.75rem] font-bold tracking-tight text-foreground">
              What can I help with?
            </h1>
            <p className="text-sm text-muted-foreground max-w-md mx-auto leading-relaxed">
              Tasks, timesheets, projects, and team context — ask in plain language and I'll pull live data or draft work for you to approve.
            </p>
          </div>
        </motion.div>

        {/* Capabilities */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.08, duration: 0.3 }}
          className="grid grid-cols-2 sm:grid-cols-4 gap-2 w-full"
        >
          {ZANI_CAPABILITIES.map(c => (
            <div
              key={c.label}
              className="rounded-2xl border border-border/40 bg-card/50 backdrop-blur px-3 py-3 text-left"
            >
              <p className="text-xs font-semibold text-foreground">{c.label}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5 leading-snug">{c.desc}</p>
            </div>
          ))}
        </motion.div>

        {/* Composer */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.12, duration: 0.3 }}
          className="w-full space-y-3"
        >
          <ZaniComposer value={input} onChange={onChange} onSend={onSend} loading={loading} autoFocus />
          <div className="flex flex-wrap justify-center gap-2">
            {ZANI_SUGGESTIONS.map(s => (
              <button
                key={s}
                type="button"
                onClick={() => onSuggestion(s)}
                disabled={loading}
                className={cn(
                  'px-3 py-1.5 rounded-full text-xs transition-all',
                  'border border-border/50 bg-card/40 text-muted-foreground',
                  'hover:border-violet-500/35 hover:text-foreground hover:bg-violet-500/[0.06]',
                  'disabled:opacity-40',
                )}
              >
                {s.length > 44 ? `${s.slice(0, 42)}…` : s}
              </button>
            ))}
          </div>
          {warnNoUsers && (
            <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              No team members loaded — Zani won't be able to assign tasks.
            </div>
          )}
        </motion.div>

        <p className="text-[10px] text-muted-foreground/40 text-center">
          Zani uses AI · verify proposals before accepting
        </p>
      </div>
    </div>
  );
}
