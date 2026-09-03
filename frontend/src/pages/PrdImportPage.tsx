/**
 * PRD studio: outline detailed user stories, review/assign, then save.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { FileText, Loader2, Sparkles, Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAppStore } from '@/stores/appStore';
import { pageEnter } from '@/lib/motion';
import type { PrdDraft, PrdDraftStory, PrdStreamEvent } from '@/types';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { PrdStudio } from '@/components/prd/PrdStudio';
import { prdRun, mergePrdFiles, PRD_FILE_ACCEPT, coercePrdDraft, isPrdFile, resetPrdRun } from '@/lib/prdSession';
import { invalidateUserStories } from '@/lib/queryClient';

function emptyDraft(): PrdDraft {
  return { importId: null, sourceText: '', stories: [] };
}

function upsertStory(stories: PrdDraftStory[], next: PrdDraftStory): PrdDraftStory[] {
  const idx = stories.findIndex(s => s.id === next.id);
  if (idx === -1) return [...stories, next];
  const copy = stories.slice();
  copy[idx] = next;
  return copy;
}

export default function PrdImportPage() {
  const currentUser = useAppStore(s => s.currentUser);
  const projects = useAppStore(s => s.projects);
  const syncTasks = useAppStore(s => s.syncTasks);
  const isManager = currentUser?.role === 'manager' || currentUser?.role === 'superadmin';

  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<PrdDraft>(emptyDraft());
  const [loaded, setLoaded] = useState(false);
  const [percent, setPercent] = useState(0);
  const [stageLabel, setStageLabel] = useState('');
  const [counts, setCounts] = useState({ done: 0, total: 0 });
  const abortRef = useRef<AbortController | null>(null);
  const analyzeGen = useRef(0);

  const addFiles = (incoming: FileList | File[] | null | undefined) => {
    const picked = Array.from(incoming ?? []);
    const rejected = picked.filter(f => !isPrdFile(f.name));
    if (rejected.length) {
      toast.error(
        `Can't use ${rejected.map(f => f.name).join(', ')}. Add a PDF, Word (.docx), TXT, MD, or CSV.`,
      );
    }
    setFiles(prev => mergePrdFiles(prev, picked));
  };

  const loadDraft = useCallback(async () => {
    const gen = analyzeGen.current;
    try {
      const next = coercePrdDraft(await api.getPrdDraft());
      if (analyzeGen.current !== gen || prdRun.analyzing) return;
      setDraft(next);
    } catch {
      if (analyzeGen.current !== gen || prdRun.analyzing) return;
      setDraft(emptyDraft());
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (prdRun.analyzing && (!prdRun.ac || prdRun.ac.signal.aborted)) resetPrdRun();
    void loadDraft();
    setAnalyzing(prdRun.analyzing);
    setPercent(prdRun.percent);
    setStageLabel(prdRun.label);
    setCounts(prdRun.counts);
    if (prdRun.draft) setDraft(coercePrdDraft(prdRun.draft));
    // ponytail: do not abort Analyze on navigate — the run keeps writing the draft
  }, [loadDraft]);

  useEffect(() => {
    if (!prdRun.analyzing && !analyzing) return;
    const tick = () => {
      setAnalyzing(prdRun.analyzing);
      setPercent(prdRun.percent);
      setStageLabel(prdRun.label);
      setCounts(prdRun.counts);
      if (prdRun.draft) setDraft(coercePrdDraft(prdRun.draft));
      else void loadDraft();
    };
    const id = window.setInterval(tick, 1200);
    tick();
    return () => window.clearInterval(id);
  }, [analyzing, loadDraft]);

  if (!isManager) return <Navigate to="/" replace />;

  const onStreamEvent = (ev: PrdStreamEvent) => {
    if (ev.type === 'progress') {
      prdRun.percent = ev.percent;
      prdRun.label = ev.label;
      setPercent(ev.percent);
      setStageLabel(ev.label);
      if (typeof ev.totalStories === 'number') {
        const counts = { done: ev.doneStories ?? 0, total: ev.totalStories };
        prdRun.counts = counts;
        setCounts(counts);
      }
      return;
    }
    if (ev.type === 'story') {
      prdRun.percent = ev.percent;
      setPercent(ev.percent);
      setDraft(prev => {
        const next = { ...prev, stories: upsertStory(prev.stories, ev.story) };
        prdRun.draft = next;
        return next;
      });
      return;
    }
    if (ev.type === 'done') {
      prdRun.percent = 100;
      prdRun.label = ev.label || 'Draft ready';
      prdRun.draft = coercePrdDraft(ev.draft);
      setPercent(100);
      setStageLabel(ev.label || 'Draft ready');
      setDraft(coercePrdDraft(ev.draft));
      return;
    }
    if (ev.type === 'error') {
      throw new Error(ev.message);
    }
  };

  const analyze = async () => {
    if (!text.trim() && files.length === 0) {
      toast.error('Paste a PRD or upload a document');
      return;
    }
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    analyzeGen.current += 1;
    prdRun.ac = ac;
    prdRun.analyzing = true;
    prdRun.percent = 2;
    prdRun.label = 'Reading the PRD';
    prdRun.counts = { done: 0, total: 0 };
    prdRun.draft = { ...emptyDraft(), sourceText: text.trim() };
    setAnalyzing(true);
    setPercent(2);
    setStageLabel('Reading the PRD');
    setCounts({ done: 0, total: 0 });
    setDraft(d => ({ ...emptyDraft(), sourceText: d.sourceText }));
    try {
      const fd = new FormData();
      if (text.trim()) fd.append('text', text.trim());
      for (const f of files) fd.append('files', f);
      let finished: PrdDraft | null = null;
      await api.analyzePrdStream(
        fd,
        ev => {
          onStreamEvent(ev);
          if (ev.type === 'done') finished = coercePrdDraft(ev.draft);
        },
        ac.signal,
      );
      const stories = (finished ?? prdRun.draft ?? emptyDraft()).stories;
      if (!stories.length) toast.message('No user stories found in that PRD');
      else toast.success(`${stories.length} user stor${stories.length === 1 ? 'y' : 'ies'} ready to review`);
    } catch (e) {
      if ((e as { name?: string }).name === 'AbortError') return;
      toast.error(e instanceof Error ? e.message : 'Analyze failed');
    } finally {
      prdRun.analyzing = false;
      prdRun.ac = null;
      setAnalyzing(false);
    }
  };

  const commit = async (storyIds: string[]) => {
    setSaving(true);
    try {
      const res = await api.commitPrdDraft(storyIds, []);
      const leftover = coercePrdDraft(await api.getPrdDraft());
      setDraft(leftover);
      if (leftover.stories.length === 0) {
        setText('');
        setFiles([]);
        setPercent(0);
        setStageLabel('');
      }
      await syncTasks();
      invalidateUserStories();
      toast.success(
        `Saved ${res.storiesCreated} user stor${res.storiesCreated === 1 ? 'y' : 'ies'}`,
      );
      return { storyIds: res.storyIds ?? [] };
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save story');
      throw e;
    } finally {
      setSaving(false);
    }
  };

  const hasDraft = draft.stories.length > 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={pageEnter}
      className="w-full space-y-6 p-6 pb-16"
    >
      <header className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">
          Import · Requirements
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">PRD studio</h1>
        <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
          Analyze a PRD into detailed user stories. Open a story to read and edit it, save it,
          then generate tasks when you are ready.
        </p>
      </header>

      <section
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={e => {
          if (e.currentTarget.contains(e.relatedTarget as Node)) return;
          setDragOver(false);
        }}
        onDrop={e => {
          e.preventDefault();
          setDragOver(false);
          addFiles(e.dataTransfer.files);
        }}
        className={`relative overflow-hidden rounded-2xl border bg-card/60 p-5 shadow-sm transition-colors ${
          dragOver ? 'border-primary/50 bg-primary/5' : 'border-border/50'
        }`}
      >
        <Textarea
          value={text}
          onChange={e => setText(e.target.value)}
          onDragOver={e => e.preventDefault()}
          onDrop={e => {
            e.preventDefault();
            setDragOver(false);
            addFiles(e.dataTransfer.files);
          }}
          rows={6}
          placeholder="Paste the PRD, RFC, or ticket dump — or drop PDFs here…"
          className="resize-y border-border/40 bg-background/80 font-mono text-[13px] leading-relaxed"
        />
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border/60 bg-background/70 px-3 py-2 text-xs font-semibold hover:bg-muted/50">
            <Upload className="h-3.5 w-3.5" />
            Add files
            <input
              type="file"
              className="hidden"
              accept={PRD_FILE_ACCEPT}
              multiple
              onChange={e => {
                addFiles(e.target.files);
                e.target.value = '';
              }}
            />
          </label>
          {files.map(f => (
            <span key={`${f.name}-${f.size}`} className="inline-flex items-center gap-1.5 rounded-full border border-border/50 bg-muted/40 px-2.5 py-1 font-mono text-[11px]">
              <FileText className="h-3 w-3" />
              {f.name}
              <button
                type="button"
                disabled={analyzing}
                onClick={() => setFiles(prev => prev.filter(x => x !== f))}
                aria-label={`Remove ${f.name}`}
              >
                <X className="h-3 w-3 text-muted-foreground hover:text-foreground" />
              </button>
            </span>
          ))}
          <div className="ml-auto flex gap-2">
            {analyzing && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  abortRef.current?.abort();
                  prdRun.ac?.abort();
                  resetPrdRun();
                  setAnalyzing(false);
                }}
              >
                Cancel
              </Button>
            )}
            <Button onClick={() => void analyze()} disabled={analyzing || (!text.trim() && files.length === 0)}>
              {analyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {analyzing ? 'Analyzing' : 'Analyze'}
            </Button>
          </div>
        </div>
      </section>

      <AnimatePresence>
        {(analyzing || (percent > 0 && percent < 100)) && (
          <motion.section
            key="meter"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="rounded-2xl border border-border/50 bg-card/70 p-5"
          >
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                  {counts.total > 0 ? 'Stories' : 'Pipeline'}
                </p>
                <p className="mt-1 text-sm font-medium">{stageLabel || 'Working'}</p>
                {counts.total > 0 && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {counts.done} / {counts.total} stories
                  </p>
                )}
              </div>
              <p className="font-mono text-3xl font-semibold tabular-nums tracking-tight">
                {Math.round(percent)}
                <span className="ml-0.5 text-base font-normal text-muted-foreground">%</span>
              </p>
            </div>
            <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-muted">
              <motion.div
                className="h-full origin-left rounded-full bg-foreground"
                initial={false}
                animate={{ scaleX: Math.max(percent, 2) / 100 }}
                transition={{ type: 'tween', duration: 0.28, ease: 'easeOut' }}
                style={{ willChange: 'transform' }}
              />
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      {!loaded ? (
        <p className="text-sm text-muted-foreground">Loading draft…</p>
      ) : !hasDraft && !analyzing ? (
        <div className="rounded-2xl border border-dashed border-border/50 px-6 py-14 text-center">
          <p className="text-sm text-muted-foreground">
            Nothing staged yet. Analyze a PRD, then open a story to save it.
          </p>
        </div>
      ) : (
        <PrdStudio
          draft={draft}
          projects={projects}
          saving={saving || analyzing}
          analyzing={analyzing}
          onChange={setDraft}
          onCommit={commit}
        />
      )}
    </motion.div>
  );
}
