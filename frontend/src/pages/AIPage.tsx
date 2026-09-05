/**
 * Zani — AI assistant page (/ai).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import { useAppStore } from '@/stores/appStore';
import { api } from '@/lib/api';
import CreateTaskModal from '@/components/CreateTaskModal';
import { ZaniComposer } from '@/components/zani/ZaniComposer';
import { ZaniEmptyHero } from '@/components/zani/ZaniEmptyHero';
import { ZaniMessage, type ZaniDisplayMessage } from '@/components/zani/ZaniMessage';
import type { TaskPrefill } from '@/components/zani/ZaniCards';
import type { AIChatMessage } from '@/types';
import { pageEnter } from '@/lib/motion';

export { TaskCreatorModal } from '@/components/zani/TaskCreatorModal';
export type { TaskPrefill } from '@/components/zani/ZaniCards';

export default function AIPage() {
  const { users, projects } = useAppStore();
  const [messages, setMessages] = useState<ZaniDisplayMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [prefill, setPrefill] = useState<TaskPrefill | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const userRefs = users.map(u => ({
    id: u.id,
    name: u.name,
    job_title: u.jobTitle ?? '',
    current_experience_months: u.currentExperienceMonths ?? 0,
  }));
  const projectRefs = projects.map(p => ({
    id: p.id,
    name: p.name,
    sections: (p.sections ?? []).map(s => ({ id: s.id, name: s.name })),
  }));

  const buildHistory = useCallback((prior: ZaniDisplayMessage[], userMsg: ZaniDisplayMessage): AIChatMessage[] => {
    const allClean: AIChatMessage[] = [...prior, userMsg]
      .filter(m => !m.loading && m.content.trim().length > 0)
      .map(m => ({ role: m.role, content: m.content }));
    const MAX_TURNS = 6;
    const history = allClean.slice(0, -1).slice(-(MAX_TURNS * 2));
    return [...history, allClean[allClean.length - 1]];
  }, []);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || loading) return;

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    const userMsg: ZaniDisplayMessage = { role: 'user', content: text.trim() };
    const assistantPlaceholder: ZaniDisplayMessage = {
      role: 'assistant',
      content: '',
      loading: true,
      streaming: true,
      status: 'Thinking…',
    };

    setMessages(prev => [...prev, userMsg, assistantPlaceholder]);
    setInput('');
    setLoading(true);

    const history = buildHistory(messages, userMsg);
    let streamContent = '';
    let donePayload: {
      message: string;
      actions: ZaniDisplayMessage['actions'];
      proposals: ZaniDisplayMessage['proposals'];
      cards: ZaniDisplayMessage['cards'];
    } | null = null;

    const patchAssistant = (patch: Partial<ZaniDisplayMessage>) => {
      setMessages(prev => {
        const next = [...prev];
        const idx = next.length - 1;
        if (idx >= 0 && next[idx].role === 'assistant') {
          next[idx] = { ...next[idx], ...patch };
        }
        return next;
      });
    };

    try {
      await api.aiChatStream(history, userRefs, projectRefs, ev => {
        if (ev.type === 'token') {
          streamContent += ev.delta;
          patchAssistant({
            content: streamContent,
            loading: false,
            streaming: true,
            status: undefined,
          });
        } else if (ev.type === 'reset') {
          streamContent = '';
          patchAssistant({ content: '', loading: true, streaming: true, status: 'Working…' });
        } else if (ev.type === 'status') {
          patchAssistant({ loading: true, streaming: true, status: ev.message, content: streamContent });
        } else if (ev.type === 'done') {
          donePayload = {
            message: ev.message,
            actions: ev.actions,
            proposals: ev.proposals,
            cards: ev.cards,
          };
        } else if (ev.type === 'error') {
          throw new Error(ev.message);
        }
      }, ac.signal);

      if (donePayload) {
        patchAssistant({
          content: donePayload.message || streamContent,
          actions: donePayload.actions,
          proposals: donePayload.proposals,
          cards: donePayload.cards,
          loading: false,
          streaming: false,
          status: undefined,
        });
        const agentActed = (donePayload.actions ?? []).some(a => a.status === 'success');
        if (agentActed) await useAppStore.getState().bootstrap();
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setMessages(prev => prev.slice(0, -1));
      toast.error(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  }, [buildHistory, loading, messages, projectRefs, userRefs]);

  const handleEditTask = (p: TaskPrefill) => { setPrefill(p); setCreateOpen(true); };
  const isEmpty = messages.length === 0;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={pageEnter}
      className="relative flex flex-col h-full min-h-0 overflow-hidden"
    >
      {/* Atmospheric background */}
      <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden>
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_-10%,hsl(var(--chart-3)/0.18),transparent_55%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_50%_40%_at_90%_100%,hsl(262_70%_50%/0.08),transparent_50%)]" />
        <div
          className="absolute inset-0 opacity-[0.35] dark:opacity-[0.2]"
          style={{
            backgroundImage: 'radial-gradient(circle, hsl(var(--border)) 1px, transparent 1px)',
            backgroundSize: '24px 24px',
          }}
        />
      </div>

      {isEmpty ? (
        <ZaniEmptyHero
          input={input}
          onChange={setInput}
          onSend={() => void sendMessage(input)}
          loading={loading}
          onSuggestion={s => void sendMessage(s)}
          warnNoUsers={!users.length}
        />
      ) : (
        <>
          <div className="flex-1 overflow-y-auto min-h-0 px-4 sm:px-6 py-6">
            <div className="max-w-3xl mx-auto space-y-8">
              <AnimatePresence initial={false}>
                {messages.map((msg, i) => (
                  <ZaniMessage key={i} msg={msg} onEditTask={handleEditTask} />
                ))}
              </AnimatePresence>
              <div ref={bottomRef} className="h-1" />
            </div>
          </div>

          <div className="shrink-0 border-t border-border/40 bg-background/70 backdrop-blur-xl px-4 sm:px-6 py-4">
            <div className="max-w-3xl mx-auto space-y-2">
              <ZaniComposer
                value={input}
                onChange={setInput}
                onSend={() => void sendMessage(input)}
                loading={loading}
                autoFocus
              />
              <p className="text-center text-[10px] text-muted-foreground/45">
                Zani uses AI · verify proposals before accepting
              </p>
            </div>
          </div>
        </>
      )}

      <CreateTaskModal
        open={createOpen}
        onOpenChange={o => { setCreateOpen(o); if (!o) setPrefill(null); }}
        prefill={prefill ?? undefined}
      />
    </motion.div>
  );
}
