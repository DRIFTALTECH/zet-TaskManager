/**
 * TaskCreatorModal — multi-modal task extraction (used by Companion + Zani).
 */

import { useRef, useState } from 'react';
import {
  Sparkles, Mic, Square, Upload, FileText, Type as TypeIcon, Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { AIExtractedTask } from '@/types';
import CreateTaskModal from '@/components/CreateTaskModal';
import TaskerThinking from '@/components/agents/TaskerThinking';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ExtractedTaskCard, type TaskPrefill } from '@/components/zani/ZaniCards';

type ExtractMode = 'text' | 'document' | 'voice' | 'record';

export function TaskCreatorModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [editPrefill, setEditPrefill] = useState<TaskPrefill | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const onEditTask = (p: TaskPrefill) => { setEditPrefill(p); setEditOpen(true); onOpenChange(false); };
  const [mode, setMode] = useState<ExtractMode>('text');
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recording, setRecording] = useState(false);
  const [audioUrl, setAudioUrl] = useState('');
  const [parsedText, setParsedText] = useState('');
  const [parsing, setParsing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<AIExtractedTask[] | null>(null);
  const [sourceText, setSourceText] = useState('');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);

  const revokeAudio = () => { if (audioUrl) { try { URL.revokeObjectURL(audioUrl); } catch { /* noop */ } } };

  const reset = () => {
    revokeAudio();
    setText(''); setFile(null); setRecordedBlob(null); setRecording(false);
    setAudioUrl(''); setParsedText(''); setParsing(false);
    setResults(null); setSourceText('');
  };

  const switchMode = (m: ExtractMode) => {
    revokeAudio();
    setMode(m);
    setFile(null); setRecordedBlob(null); setAudioUrl(''); setParsedText('');
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || 'audio/webm' });
        setRecordedBlob(blob);
        revokeAudio();
        setAudioUrl(URL.createObjectURL(blob));
        setParsedText('');
        stream.getTracks().forEach(t => t.stop());
      };
      mr.start();
      recorderRef.current = mr;
      setRecording(true);
    } catch {
      toast.error('Could not access the microphone.');
    }
  };
  const stopRecording = () => { recorderRef.current?.stop(); setRecording(false); };

  const onPickFile = (f: File | null) => {
    revokeAudio();
    setFile(f);
    setParsedText('');
    setAudioUrl(f && mode === 'voice' ? URL.createObjectURL(f) : '');
    if (f && mode === 'document') void resolveSource(f);
  };

  const resolveSource = async (f?: File | Blob) => {
    const blob = f ?? file ?? recordedBlob;
    if (!blob) return;
    setParsing(true);
    try {
      const fd = new FormData();
      fd.append('file', blob, blob instanceof File ? blob.name : 'recording.webm');
      const res = await api.aiParseSource(fd);
      setParsedText(res.sourceText || '');
      if (!res.sourceText) toast.info('Nothing readable was found in that file.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not read that file');
    } finally {
      setParsing(false);
    }
  };

  const canExtract =
    (mode === 'text' && text.trim().length > 0) ||
    (mode === 'document' && parsedText.trim().length > 0) ||
    (mode === 'voice' && (parsedText.trim().length > 0 || !!file)) ||
    (mode === 'record' && (parsedText.trim().length > 0 || (!!recordedBlob && !recording)));

  const extract = async () => {
    setLoading(true);
    try {
      const fd = new FormData();
      if (parsedText.trim()) fd.append('text', parsedText.trim());
      else if (mode === 'text') fd.append('text', text.trim());
      else if ((mode === 'document' || mode === 'voice') && file) fd.append('file', file, file.name);
      else if (mode === 'record' && recordedBlob) fd.append('file', recordedBlob, 'recording.webm');
      const res = await api.aiExtractTasks(fd);
      const tasks = Array.isArray(res.tasks) ? res.tasks : [];
      setResults(tasks);
      setSourceText(res.sourceText || '');
      if (tasks.length === 0) toast.info('No tasks found in that input.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not extract tasks');
    } finally {
      setLoading(false);
    }
  };

  const TABS: { id: ExtractMode; label: string; icon: typeof TypeIcon }[] = [
    { id: 'text', label: 'Type', icon: TypeIcon },
    { id: 'document', label: 'Document', icon: FileText },
    { id: 'voice', label: 'Voice file', icon: Upload },
    { id: 'record', label: 'Record', icon: Mic },
  ];

  return (
    <>
      <Dialog open={open} onOpenChange={o => { onOpenChange(o); if (!o) reset(); }}>
        <DialogContent className="rounded-2xl sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg font-bold">
              <Sparkles className="h-4 w-4 text-violet-600 dark:text-violet-400" /> Create tasks with AI
            </DialogTitle>
          </DialogHeader>

          {results === null ? (
            <div className="space-y-4 pt-1">
              <p className="text-sm text-muted-foreground/70">
                Describe the work, upload a document, or record your voice — Zani extracts tasks and suggests assignees.
              </p>
              <div className="flex gap-1 rounded-xl border border-border/50 bg-muted/30 p-1">
                {TABS.map(t => (
                  <button key={t.id} type="button" onClick={() => switchMode(t.id)}
                    className={cn('flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg text-xs font-semibold transition-colors',
                      mode === t.id ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
                    <t.icon className="h-3.5 w-3.5" /> {t.label}
                  </button>
                ))}
              </div>

              {mode === 'text' && (
                <textarea autoFocus value={text} onChange={e => setText(e.target.value)} rows={8}
                  placeholder="e.g. Build the login page by Friday — assign to Lokesh. Bharath writes API tests, high priority."
                  className="w-full px-3.5 py-3 text-sm rounded-xl border border-border/60 bg-background/60 focus:outline-none focus:ring-2 focus:ring-violet-500/30 resize-y leading-relaxed" />
              )}

              {(mode === 'document' || mode === 'voice') && (
                <div className="space-y-3">
                  <label className="flex flex-col items-center justify-center gap-2 py-8 rounded-xl border-2 border-dashed border-border/50 hover:border-violet-500/40 cursor-pointer transition-colors">
                    {mode === 'document' ? <FileText className="h-7 w-7 text-muted-foreground/40" /> : <Upload className="h-7 w-7 text-muted-foreground/40" />}
                    <span className="text-sm text-muted-foreground/70">{file ? file.name : (mode === 'document' ? 'Choose a document' : 'Choose an audio file')}</span>
                    <input type="file" className="hidden"
                      accept={mode === 'document' ? '.pdf,.docx,.txt,.md,.csv' : 'audio/*'}
                      onChange={e => onPickFile(e.target.files?.[0] ?? null)} />
                  </label>
                  {mode === 'voice' && audioUrl && <audio controls src={audioUrl} className="w-full" />}
                  {mode === 'voice' && file && !parsedText && (
                    <button type="button" onClick={() => void resolveSource()} disabled={parsing}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border/60 text-sm font-semibold hover:bg-muted/50 disabled:opacity-40">
                      {parsing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                      {parsing ? 'Transcribing…' : 'Transcribe & review'}
                    </button>
                  )}
                  {mode === 'document' && parsing && (
                    <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Reading document…</p>
                  )}
                  {parsedText && (
                    <textarea value={parsedText} onChange={e => setParsedText(e.target.value)} rows={6}
                      className="w-full px-3.5 py-3 text-sm rounded-xl border border-border/60 bg-background/60 focus:outline-none focus:ring-2 focus:ring-violet-500/30 resize-y" />
                  )}
                </div>
              )}

              {mode === 'record' && (
                <div className="space-y-3">
                  <div className="flex flex-col items-center justify-center gap-3 py-6 rounded-xl border border-border/50 bg-muted/20">
                    {recording ? (
                      <button type="button" onClick={stopRecording} className="flex items-center gap-2 px-5 py-3 rounded-full bg-red-500 text-white font-semibold animate-pulse">
                        <Square className="h-4 w-4" /> Stop recording
                      </button>
                    ) : (
                      <button type="button" onClick={() => void startRecording()} className="flex items-center gap-2 px-5 py-3 rounded-full bg-violet-600 text-white font-semibold hover:bg-violet-500">
                        <Mic className="h-4 w-4" /> {recordedBlob ? 'Record again' : 'Start recording'}
                      </button>
                    )}
                  </div>
                  {audioUrl && !recording && <audio controls src={audioUrl} className="w-full" />}
                  {recordedBlob && !recording && !parsedText && (
                    <button type="button" onClick={() => void resolveSource()} disabled={parsing}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border/60 text-sm font-semibold hover:bg-muted/50 disabled:opacity-40">
                      {parsing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                      {parsing ? 'Transcribing…' : 'Transcribe & review'}
                    </button>
                  )}
                  {parsedText && (
                    <textarea value={parsedText} onChange={e => setParsedText(e.target.value)} rows={6}
                      className="w-full px-3.5 py-3 text-sm rounded-xl border border-border/60 bg-background/60 focus:outline-none focus:ring-2 focus:ring-violet-500/30 resize-y" />
                  )}
                </div>
              )}

              {loading ? <TaskerThinking /> : (
                <div className="flex justify-end">
                  <button type="button" onClick={() => void extract()} disabled={!canExtract || loading}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-violet-600 text-white text-sm font-semibold hover:bg-violet-500 disabled:opacity-40">
                    <Sparkles className="h-4 w-4" /> Extract tasks
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4 pt-1 max-h-[60vh] overflow-y-auto">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">{results.length} task{results.length !== 1 ? 's' : ''} found</p>
                <button type="button" onClick={() => setResults(null)} className="text-xs text-violet-600 dark:text-violet-400 hover:underline">← Back</button>
              </div>
              {sourceText && (
                <details className="rounded-lg border border-border/40 bg-muted/20 px-3 py-2">
                  <summary className="text-[11px] font-semibold text-muted-foreground uppercase cursor-pointer">Source text</summary>
                  <p className="mt-2 text-xs text-muted-foreground whitespace-pre-wrap max-h-32 overflow-y-auto">{sourceText}</p>
                </details>
              )}
              <div className="space-y-3">
                {results.map((t, i) => (
                  <ExtractedTaskCard key={i} task={t} onEdit={p => { onEditTask(p); onOpenChange(false); }} />
                ))}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <CreateTaskModal open={editOpen} onOpenChange={o => { setEditOpen(o); if (!o) setEditPrefill(null); }} prefill={editPrefill ?? undefined} />
    </>
  );
}
