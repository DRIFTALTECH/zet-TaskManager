import { useState, useEffect } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ChevronRight, ChevronLeft, ChevronDown, Plus, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { projectAccent } from '@/lib/manage-utils';
import type { Project } from '@/types';

interface Props {
  projects: Project[];
  projectId: string;
  sectionId: string;
  onChange: (projectId: string, sectionId: string) => void;
  /** Creates a section in the project and resolves to its new id (or null on failure). */
  onCreateSection: (projectId: string, name: string) => Promise<string | null>;
  triggerClassName?: string;
  placeholder?: string;
  align?: 'start' | 'center' | 'end';
  disabled?: boolean;
}

/**
 * Single cascading picker for project → section.
 * Click → list of projects. Pick a project → same panel switches to that
 * project's sections (with a Back button) and lets you create a new section.
 */
export default function ProjectSectionPicker({
  projects,
  projectId,
  sectionId,
  onChange,
  onCreateSection,
  triggerClassName,
  placeholder = 'Choose project…',
  align = 'start',
  disabled = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<'projects' | 'sections'>('projects');
  const [draftProject, setDraftProject] = useState(projectId);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);

  const selProject = projects.find(p => p.id === projectId);
  const selSection = selProject?.sections.find(s => s.id === sectionId);
  const stepProject = projects.find(p => p.id === draftProject);
  const stepSections = stepProject?.sections ?? [];

  // On open: jump straight to sections if a project is already chosen.
  useEffect(() => {
    if (!open) return;
    setDraftProject(projectId);
    setStep(projectId ? 'sections' : 'projects');
    setCreating(false);
    setNewName('');
  }, [open, projectId]);

  const pickProject = (id: string) => {
    setDraftProject(id);
    setStep('sections');
    setCreating(false);
    setNewName('');
  };

  const pickSection = (id: string) => {
    onChange(draftProject, id);
    setOpen(false);
  };

  const handleCreate = async () => {
    if (!newName.trim() || !draftProject) return;
    setBusy(true);
    const id = await onCreateSection(draftProject, newName.trim());
    setBusy(false);
    if (id) {
      onChange(draftProject, id);
      setOpen(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            'flex w-full items-center justify-between gap-2 rounded-xl border border-border/80 bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50',
            triggerClassName,
          )}
        >
          <span className="truncate text-left">
            {selProject ? (
              <>
                <span className={cn('font-medium', projectAccent(selProject.id).text)}>{selProject.name}</span>
                {selSection ? (
                  <>
                    <span className="text-muted-foreground"> / </span>
                    <span className={cn('font-medium', projectAccent(selSection.id).text)}>{selSection.name}</span>
                  </>
                ) : (
                  <span className="text-muted-foreground"> / Choose section…</span>
                )}
              </>
            ) : (
              <span className="text-muted-foreground">{placeholder}</span>
            )}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>

      <PopoverContent
        align={align}
        className="w-[--radix-popover-trigger-width] min-w-[14rem] p-1.5 rounded-xl"
      >
        {step === 'projects' ? (
          <div className="max-h-64 overflow-y-auto">
            <div className="px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/55">
              Projects
            </div>
            {projects.length === 0 ? (
              <div className="px-2 py-2 text-xs text-muted-foreground">No projects</div>
            ) : (
              projects.map(p => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => pickProject(p.id)}
                  className={cn(
                    'w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-sm hover:bg-muted/60 transition-colors text-left',
                    p.id === projectId && 'bg-muted/40',
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className={cn('h-2 w-2 shrink-0 rounded-full', projectAccent(p.id).bg)} />
                    <span className={cn('truncate font-medium', projectAccent(p.id).text)}>{p.name}</span>
                  </span>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-40" />
                </button>
              ))
            )}
          </div>
        ) : (
          <div>
            <button
              type="button"
              onClick={() => setStep('projects')}
              className="w-full flex items-center gap-1.5 px-2 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
            >
              <ChevronLeft className="h-3.5 w-3.5 shrink-0" />
              <span className={cn('truncate font-semibold', stepProject && projectAccent(stepProject.id).text)}>
                {stepProject?.name ?? 'Back'}
              </span>
            </button>
            <div className="h-px bg-border/50 my-1" />

            <div className="max-h-52 overflow-y-auto">
              {stepSections.length === 0 && !creating && (
                <div className="px-2 py-2 text-xs text-muted-foreground">No sections yet — create one below.</div>
              )}
              {stepSections.map(s => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => pickSection(s.id)}
                  className="w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-sm hover:bg-muted/60 transition-colors text-left"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', projectAccent(s.id).bg)} />
                    <span className={cn('truncate font-medium', projectAccent(s.id).text)}>{s.name}</span>
                  </span>
                  {s.id === sectionId && draftProject === projectId && (
                    <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
                  )}
                </button>
              ))}
            </div>

            <div className="h-px bg-border/50 my-1" />
            {creating ? (
              <div className="flex gap-1.5 p-1">
                <input
                  autoFocus
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') void handleCreate();
                    if (e.key === 'Escape') { setCreating(false); setNewName(''); }
                  }}
                  placeholder="Section name…"
                  disabled={busy}
                  className="flex-1 min-w-0 px-2.5 py-1.5 text-sm rounded-lg border border-border/60 bg-background focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
                <button
                  type="button"
                  onClick={() => void handleCreate()}
                  disabled={!newName.trim() || busy}
                  className="shrink-0 px-2.5 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold disabled:opacity-40"
                >
                  {busy ? '…' : 'Add'}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => { setCreating(true); setNewName(''); }}
                className="w-full flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-sm text-primary font-semibold hover:bg-primary/10 transition-colors"
              >
                <Plus className="h-3.5 w-3.5 shrink-0" /> Create section
              </button>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
