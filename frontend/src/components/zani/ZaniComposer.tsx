import { useCallback, useEffect, useRef } from 'react';
import { ArrowUp, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export function ZaniComposer({
  value,
  onChange,
  onSend,
  loading,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  loading: boolean;
  autoFocus?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const resize = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, []);

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  useEffect(() => { resize(); }, [value, resize]);

  const canSend = value.trim().length > 0 && !loading;

  return (
    <div className="relative rounded-[1.35rem] border border-violet-500/15 bg-card/80 backdrop-blur-xl shadow-[0_8px_40px_-12px_hsl(var(--chart-3)/0.25)] overflow-hidden">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-violet-400/40 to-transparent" />
      <textarea
        ref={ref}
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (canSend) onSend();
          }
        }}
        placeholder="Ask Zani anything about your work…"
        disabled={loading}
        rows={1}
        className={cn(
          'w-full resize-none bg-transparent px-5 pt-4 pb-2',
          'text-[15px] leading-relaxed text-foreground placeholder:text-muted-foreground/45',
          'focus:outline-none min-h-[52px] max-h-[160px]',
          'disabled:opacity-60',
        )}
      />
      <div className="flex items-center justify-between px-3 pb-3 pt-1">
        <p className="text-[10px] text-muted-foreground/45 pl-2 hidden sm:block">
          Enter to send · Shift+Enter for new line
        </p>
        <button
          type="button"
          onClick={onSend}
          disabled={!canSend}
          className={cn(
            'ml-auto flex h-9 w-9 items-center justify-center rounded-xl transition-all',
            canSend
              ? 'bg-gradient-to-br from-violet-600 to-indigo-600 text-white shadow-md shadow-violet-500/30 hover:brightness-110'
              : 'bg-muted/50 text-muted-foreground/40 cursor-not-allowed',
          )}
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" strokeWidth={2.5} />}
        </button>
      </div>
    </div>
  );
}
