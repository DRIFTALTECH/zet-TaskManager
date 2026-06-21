/**
 * TaskSuggest — description input with live autocomplete of the current user's
 * assigned tasks. Picking one fills the description (and lets the parent set the
 * project/section). Used by the timesheet logger and the calendar entry modal.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { idPillColor } from '@/lib/pill-color';
import type { Task, Project } from '@/types';

export default function TaskSuggest({
  value, onChange, onPick, tasks, projects, disabled, inputId, placeholder,
  inputClassName, containerClassName, multiline, rows = 3,
}: {
  value: string;
  onChange: (v: string) => void;
  onPick: (t: Task) => void;
  tasks: Task[];
  projects: Project[];
  disabled?: boolean;
  inputId?: string;
  placeholder?: string;
  inputClassName?: string;
  containerClassName?: string;
  multiline?: boolean;
  rows?: number;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);
  const projName = (id: string) => projects.find(p => p.id === id)?.name ?? 'Project';
  const sectName = (id: string) => {
    for (const p of projects) {
      const s = p.sections.find(x => x.id === id);
      if (s) return s.name;
    }
    return '';
  };
  const q = value.trim().toLowerCase();
  const matches = useMemo(() => {
    const list = q
      ? tasks.filter(t => t.title.toLowerCase().includes(q) || (t.description ?? '').toLowerCase().includes(q))
      : tasks;
    return list.slice(0, 6);
  }, [tasks, q]);
  const handle = (v: string) => { onChange(v); setOpen(true); };

  return (
    <div ref={wrapRef} className={cn('relative', containerClassName)}>
      {multiline ? (
        <textarea id={inputId} value={value} rows={rows} placeholder={placeholder} disabled={disabled}
          autoComplete="off" onFocus={() => setOpen(true)} onChange={e => handle(e.target.value)} className={inputClassName} />
      ) : (
        <input type="text" id={inputId} value={value} placeholder={placeholder} disabled={disabled}
          autoComplete="off" onFocus={() => setOpen(true)} onChange={e => handle(e.target.value)} className={inputClassName} />
      )}
      {open && matches.length > 0 && (
        <div className="absolute z-50 left-0 right-0 top-full mt-1 max-h-64 overflow-y-auto rounded-xl border border-border/60 bg-popover shadow-xl p-1">
          {matches.map(t => {
            const sec = t.sectionId ? sectName(t.sectionId) : '';
            return (
              <button key={t.id} type="button"
                onMouseDown={e => e.preventDefault()}
                onClick={() => { onPick(t); setOpen(false); }}
                className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-muted/60 transition-colors">
                <p className="text-sm font-medium text-foreground truncate">{t.title}</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold max-w-full truncate ${idPillColor(t.projectId)}`}>
                    {projName(t.projectId)}
                  </span>
                  {sec && (
                    <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium max-w-full truncate opacity-80 ${idPillColor(t.sectionId)}`}>
                      {sec}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
