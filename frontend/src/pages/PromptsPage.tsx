/**
 * The instructions sent to the model, editable without a deploy.
 *
 * Every AI feature is steered by a block of wording that used to live only in
 * the source: changing a rule about how stories get written meant a code change
 * and a release. These are the same blocks, stored, so the operator can adjust
 * them and see the effect on the next run.
 *
 * Listed as a table because the question this page usually answers is "which of
 * these has someone changed?" — that is a column, and eleven open editors
 * stacked down a page buried it.
 *
 * Superadmin only, and not gently: a prompt shapes what everyone's AI does.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Navigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Loader2, Pencil, RotateCcw, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

import PageHeader from '@/components/PageHeader';
import { confirmAction } from '@/components/ConfirmDialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { pageEnter } from '@/lib/motion';
import { PAGE_SHELL_SCROLL } from '@/lib/page-styles';
import { useAppStore } from '@/stores/appStore';
import { cn } from '@/lib/utils';
import type { AiPrompt } from '@/types';

/** `EXTRACT_PRD_PROMPT` → `Extract prd`. The keys are code, the page is not. */
function readable(key: string) {
  const words = key.replace(/_PROMPT$/, '').replace(/_/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Placeholder names in a prompt, read the way the server reads them.
 *
 * `{{doubled}}` is literal text; anything else in single braces is a value the
 * runtime must supply. Typing a JSON example therefore asks for a value nobody
 * supplies, and every call using the prompt fails — so it is worth catching
 * here, while the words are still on screen.
 */
function placeholdersIn(body: string): string[] {
  const withoutLiterals = body.replace(/\{\{[\s\S]*?\}\}/g, '');
  return [...withoutLiterals.matchAll(/\{([^{}]*)\}/g)]
    // Python's formatter — which is what actually parses this — ends the name at
    // a format spec or conversion, so `{"error": null}` is the name `"error"`.
    // Naming it differently here would warn about one thing and have the server
    // refuse another.
    .map(m => m[1].split(/[:!]/)[0].trim())
    .filter(Boolean);
}

function when(iso?: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Columns declared once so the header and every row cannot drift apart. */
const GRID = 'grid grid-cols-[minmax(0,1fr)_6rem_10rem_7rem] items-center gap-3';

function EditPromptDialog({
  prompt,
  onClose,
  onSaved,
}: {
  prompt: AiPrompt | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  // Remounted per prompt by the `key` at the call site, so this initialiser
  // runs on every opening. Starting the draft empty would have made Save live
  // before a single character was typed, and saving an empty prompt.
  const [draft, setDraft] = useState(prompt?.body ?? '');
  const [saving, setSaving] = useState(false);
  const dirty = !!prompt && draft !== prompt.body;

  // Taken from the server, not read off the shipped wording. The names come
  // from the whole template, and several prompts declare all of theirs in the
  // human turn — inferring from the system text alone found none of them and
  // rejected every placeholder, including the ones that do work.
  const allowed = useMemo(
    () => new Set(prompt?.placeholders ?? []),
    [prompt?.placeholders],
  );
  const unknown = useMemo(
    () => [...new Set(placeholdersIn(draft))].filter(name => !allowed.has(name)),
    [draft, allowed],
  );

  const save = async () => {
    if (!prompt) return;
    if (!draft.trim()) {
      toast.error('A prompt cannot be empty');
      return;
    }
    setSaving(true);
    try {
      await api.updatePrompt(prompt.key, draft);
      toast.success(`${readable(prompt.key)} saved`);
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save that prompt');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!prompt} onOpenChange={o => { if (!o && !saving) onClose(); }}>
      <DialogContent className="flex h-[calc(100dvh-4rem)] w-[calc(100vw-3rem)] max-w-none flex-col gap-0 overflow-hidden rounded-xl p-0 sm:max-w-[min(92vw,900px)]" style={{ maxHeight: 'none' }}>
        <DialogHeader className="shrink-0 border-b border-border/40 px-4 py-3 text-left">
          <DialogTitle className="text-base">{prompt ? readable(prompt.key) : ''}</DialogTitle>
          <DialogDescription className="font-mono text-[11px]">{prompt?.key}</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <textarea
            autoFocus
            value={draft}
            onChange={e => setDraft(e.target.value)}
            spellCheck={false}
            className="h-full min-h-[24rem] w-full resize-none rounded-lg border border-border/60 bg-background px-3 py-2 font-mono text-[12px] leading-relaxed focus:border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary/30"
          />
          {unknown.length > 0 ? (
            <p className="mt-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-[11px] text-destructive">
              Nothing fills in{' '}
              <code className="font-mono">{unknown.map(u => `{${u}}`).join(', ')}</code>.{' '}
              This prompt can use{' '}
              <code className="font-mono">{[...allowed].map(a => `{${a}}`).join(', ') || 'no placeholders'}</code>.
              To show braces as text — a JSON example, say — double them:{' '}
              <code className="font-mono">{'{{like this}}'}</code>.
            </p>
          ) : (
            <p className="mt-2 text-[11px] text-muted-foreground/60">
              Text in <code className="font-mono">{'{braces}'}</code> is filled in when the prompt runs.
              This one can use{' '}
              <code className="font-mono">{[...allowed].map(a => `{${a}}`).join(', ') || 'no placeholders'}</code>.
            </p>
          )}
        </div>

        <DialogFooter className="shrink-0 border-t border-border/40 px-4 py-3">
          <Button variant="outline" size="sm" disabled={saving} onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={saving || !dirty || unknown.length > 0} onClick={() => void save()}>
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Save prompt
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function PromptsPage() {
  const currentUser = useAppStore(s => s.currentUser);
  const isSuperadmin = currentUser?.role === 'superadmin';
  const [editing, setEditing] = useState<AiPrompt | null>(null);
  const [resetting, setResetting] = useState<string | null>(null);

  const { data: prompts = [], isLoading, refetch } = useQuery({
    queryKey: ['ai-prompts'],
    queryFn: () => api.listPrompts(),
    enabled: isSuperadmin,
    staleTime: 30_000,
  });

  const edited = useMemo(() => prompts.filter(p => p.isCustom).length, [prompts]);

  const reset = async (prompt: AiPrompt) => {
    const ok = await confirmAction({
      title: `Reset ${readable(prompt.key)}?`,
      description: 'Your wording is discarded and the version shipped with the app takes over.',
      confirmLabel: 'Reset it',
      destructive: true,
    });
    if (!ok) return;
    setResetting(prompt.key);
    try {
      await api.resetPrompt(prompt.key);
      toast.success(`${readable(prompt.key)} reset`);
      await refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not reset that prompt');
    } finally {
      setResetting(null);
    }
  };

  if (currentUser && !isSuperadmin) return <Navigate to="/" replace />;

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={pageEnter} className={PAGE_SHELL_SCROLL}>
      <PageHeader
        icon={Sparkles}
        eyebrow="AI"
        title="Prompts"
        subtitle="The instructions every AI feature is given. Changes apply to the next run — no deploy."
        actions={
          edited > 0 ? (
            <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-600 dark:text-amber-400">
              {edited} edited
            </span>
          ) : null
        }
      />

      {isLoading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading prompts…
        </div>
      ) : prompts.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">No prompts found.</p>
      ) : (
        <div className="max-w-5xl w-full overflow-hidden rounded-xl border border-border/50">
          <div className={cn(GRID, 'border-b border-border/40 bg-muted/20 px-3 py-1.5', 'text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60')}>
            <span>Prompt</span>
            <span>Status</span>
            <span>Last edited</span>
            <span className="text-right">Actions</span>
          </div>

          {prompts.map(p => (
            <div key={p.key} className={cn(GRID, 'group border-b border-border/25 px-3 py-2 transition-colors hover:bg-muted/20')}>
              <div className="min-w-0">
                <p className="truncate text-[13px] font-medium text-foreground">{readable(p.key)}</p>
                <p className="truncate font-mono text-[10px] text-muted-foreground/50">{p.key}</p>
              </div>

              <span>
                {p.isCustom ? (
                  <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                    Edited
                  </span>
                ) : (
                  <span className="text-[11px] text-muted-foreground/50">Default</span>
                )}
              </span>

              <span className="truncate text-[11px] text-muted-foreground">
                {p.isCustom ? `${when(p.updatedAt)}${p.updatedBy ? ` · ${p.updatedBy}` : ''}` : '—'}
              </span>

              <span className="flex items-center justify-end gap-1.5">
                {p.isCustom && (
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={`Reset ${readable(p.key)}`}
                    disabled={resetting === p.key}
                    onClick={() => void reset(p)}
                  >
                    {resetting === p.key
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <RotateCcw className="h-3.5 w-3.5" />}
                  </Button>
                )}
                <Button size="sm" aria-label={`Edit ${readable(p.key)}`} onClick={() => setEditing(p)}>
                  <Pencil className="h-3.5 w-3.5" /> Edit
                </Button>
              </span>
            </div>
          ))}
        </div>
      )}

      <EditPromptDialog
        key={editing?.key ?? 'none'}
        prompt={editing}
        onClose={() => setEditing(null)}
        onSaved={() => void refetch()}
      />
    </motion.div>
  );
}
