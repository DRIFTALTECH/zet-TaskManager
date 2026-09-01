/**
 * Manager/superadmin page: paste or upload a PRD → Analyze → edit staged
 * stories/tasks (temp_tasks) → Save to ZET (real tables, temp cleared).
 */
import { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Loader2, Sparkles, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAppStore } from '@/stores/appStore';
import { pageEnter } from '@/lib/motion';
import type { PrdDraft } from '@/types';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { PrdDraftTable } from '@/components/PrdDraftTable';

function emptyDraft(): PrdDraft {
  return { importId: null, sourceText: '', stories: [] };
}

export default function PrdImportPage() {
  const currentUser = useAppStore(s => s.currentUser);
  const projects = useAppStore(s => s.projects);
  const syncTasks = useAppStore(s => s.syncTasks);
  const isManager = currentUser?.role === 'manager' || currentUser?.role === 'superadmin';

  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<PrdDraft>(emptyDraft());
  const [loaded, setLoaded] = useState(false);

  const loadDraft = useCallback(async () => {
    try {
      setDraft(await api.getPrdDraft());
    } catch {
      setDraft(emptyDraft());
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => { void loadDraft(); }, [loadDraft]);

  if (!isManager) return <Navigate to="/" replace />;

  const analyze = async () => {
    if (!text.trim() && !file) {
      toast.error('Paste a PRD or upload a document');
      return;
    }
    setAnalyzing(true);
    try {
      const fd = new FormData();
      if (text.trim()) fd.append('text', text.trim());
      if (file) fd.append('file', file);
      const next = await api.analyzePrd(fd);
      setDraft(next);
      if (!next.stories.length) toast.message('No user stories found in that PRD');
      else toast.success(`Staged ${next.stories.length} user stor${next.stories.length === 1 ? 'y' : 'ies'}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Analyze failed');
    } finally {
      setAnalyzing(false);
    }
  };

  const commit = async () => {
    setSaving(true);
    try {
      const res = await api.commitPrdDraft();
      setDraft(emptyDraft());
      setText('');
      setFile(null);
      await syncTasks();
      toast.success(
        `Saved ${res.storiesCreated} stor${res.storiesCreated === 1 ? 'y' : 'ies'} and ${res.tasksCreated} task${res.tasksCreated === 1 ? '' : 's'}`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save to ZET');
    } finally {
      setSaving(false);
    }
  };

  const hasDraft = draft.stories.length > 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={pageEnter}
      className="mx-auto max-w-4xl space-y-6 p-6"
    >
      <div>
        <h1 className="text-2xl font-bold tracking-tight">PRD import</h1>
      </div>

      <section className="space-y-3 rounded-2xl border border-border/40 bg-card/40 p-5">
        <Textarea
          value={text}
          onChange={e => setText(e.target.value)}
          rows={8}
          placeholder="Paste the PRD or spec here…"
          className="resize-y bg-background"
        />
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border/60 px-3 py-2 text-xs font-semibold hover:bg-muted/50">
            <Upload className="h-3.5 w-3.5" />
            {file ? file.name : 'Upload PDF, DOCX, or TXT'}
            <input
              type="file"
              className="hidden"
              accept=".pdf,.docx,.txt,.md,.csv"
              onChange={e => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <Button onClick={() => void analyze()} disabled={analyzing || (!text.trim() && !file)}>
            {analyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Analyze
          </Button>
        </div>
      </section>

      {!loaded ? (
        <p className="text-sm text-muted-foreground">Loading draft…</p>
      ) : !hasDraft ? (
        <p className="rounded-xl border border-dashed border-border/40 px-4 py-10 text-center text-sm text-muted-foreground">
          No staged work. Analyze a PRD to see user stories and tasks here.
        </p>
      ) : (
        <PrdDraftTable
          draft={draft}
          projects={projects}
          saving={saving}
          onChange={setDraft}
          onCommit={() => void commit()}
        />
      )}
    </motion.div>
  );
}
