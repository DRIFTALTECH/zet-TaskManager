/**
 * CvSkillPreviewDialog — shows skills extracted from an uploaded CV/resume.
 * Users pick which extracted skills to merge into their profile.
 */
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, FileText, Loader2, X } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { useAppStore } from '@/stores/appStore';

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  userId: string;
  /** Currently selected skill IDs — used to pre-check new skills and avoid duplicates. */
  selectedSkillIds: string[];
  /** Called with the merged final list of skill IDs after the user confirms. */
  onMerge: (skillIds: string[]) => void;
};

export default function CvSkillPreviewDialog({ open, onOpenChange, userId, selectedSkillIds, onMerge }: Props) {
  const { skills, createSkill } = useAppStore();

  // extracted skill *names* from the API
  const [extracted, setExtracted] = useState<string[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState(false);
  const [merging, setMerging] = useState(false);
  const [file, setFile] = useState<File | null>(null);

  const reset = () => {
    setExtracted([]);
    setChecked(new Set());
    setFile(null);
    setUploading(false);
    setMerging(false);
  };

  const handleFile = async (f: File | undefined) => {
    if (!f) return;
    const ext = f.name.split('.').pop()?.toLowerCase();
    if (!ext || !['pdf', 'docx', 'txt'].includes(ext)) {
      toast.error('Only PDF, DOCX, and TXT files are supported');
      return;
    }
    if (f.size > 10 * 1024 * 1024) {
      toast.error('File must be under 10 MB');
      return;
    }
    setFile(f);
    setExtracted([]);
    setChecked(new Set());
    setUploading(true);
    try {
      const res = await api.extractSkillsFromCv(userId, f);
      const names: string[] = res.skills ?? [];
      setExtracted(names);
      // Pre-check skills not already on the profile
      const alreadyNames = new Set(
        selectedSkillIds
          .map(id => skills.find(s => s.id === id)?.name?.toLowerCase())
          .filter(Boolean),
      );
      setChecked(new Set(names.filter(n => !alreadyNames.has(n.toLowerCase()))));
      if (names.length === 0) toast.info('No skills found in this file. Try another CV.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not extract skills');
    } finally {
      setUploading(false);
    }
  };

  const toggle = (name: string) =>
    setChecked(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });

  const handleMerge = async () => {
    if (checked.size === 0) { onOpenChange(false); return; }
    setMerging(true);
    try {
      const existing = new Map(skills.map(s => [s.name.toLowerCase(), s.id]));
      const newIds = [...selectedSkillIds];
      const alreadyIds = new Set(selectedSkillIds);

      for (const name of checked) {
        const existingId = existing.get(name.toLowerCase());
        if (existingId) {
          if (!alreadyIds.has(existingId)) { newIds.push(existingId); alreadyIds.add(existingId); }
        } else {
          // Create brand-new skill
          const created = await createSkill(name);
          if (!alreadyIds.has(created.id)) { newIds.push(created.id); alreadyIds.add(created.id); }
        }
      }
      onMerge(newIds);
      toast.success(`Added ${checked.size} skill${checked.size !== 1 ? 's' : ''} from CV`);
      onOpenChange(false);
      reset();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save skills');
    } finally {
      setMerging(false);
    }
  };

  const handleClose = (o: boolean) => {
    if (!o) reset();
    onOpenChange(o);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="rounded-2xl max-w-md w-full">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-bold">
            <FileText className="h-4 w-4 text-primary" />
            Extract skills from CV
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          {/* File drop zone / picker */}
          <label
            className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-sm transition-colors cursor-pointer
              ${uploading ? 'border-primary/40 bg-primary/5' : 'border-border/50 hover:border-primary/40 hover:bg-muted/40'}`}
          >
            {uploading ? (
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            ) : (
              <FileText className="h-6 w-6 text-muted-foreground/40" />
            )}
            <span className="text-muted-foreground/70 text-center">
              {uploading
                ? 'Extracting skills…'
                : file
                ? <><span className="font-semibold text-foreground">{file.name}</span> — drop another to re-scan</>
                : 'Click to upload PDF, DOCX, or TXT'}
            </span>
            <input
              type="file"
              accept=".pdf,.docx,.txt"
              className="hidden"
              disabled={uploading || merging}
              onChange={e => void handleFile(e.target.files?.[0])}
            />
          </label>

          {/* Extracted skills checklist */}
          <AnimatePresence>
            {extracted.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 6 }}
                className="space-y-2"
              >
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-muted-foreground/70 uppercase tracking-wide">
                    Found {extracted.length} skill{extracted.length !== 1 ? 's' : ''}
                  </p>
                  <div className="flex gap-2 text-[11px] text-muted-foreground/60">
                    <button type="button" onClick={() => setChecked(new Set(extracted))} className="hover:text-foreground transition-colors">All</button>
                    <span>·</span>
                    <button type="button" onClick={() => setChecked(new Set())} className="hover:text-foreground transition-colors">None</button>
                  </div>
                </div>
                <div className="max-h-52 overflow-y-auto space-y-1 pr-1">
                  {extracted.map(name => {
                    const on = checked.has(name);
                    const alreadyAdded = selectedSkillIds.some(
                      id => skills.find(s => s.id === id)?.name?.toLowerCase() === name.toLowerCase()
                    );
                    return (
                      <button
                        key={name}
                        type="button"
                        onClick={() => toggle(name)}
                        disabled={alreadyAdded}
                        className={`w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-left transition-all
                          ${alreadyAdded
                            ? 'opacity-40 cursor-not-allowed bg-muted/30'
                            : on
                            ? 'bg-primary/10 border border-primary/30 text-primary'
                            : 'border border-border/40 bg-muted/20 hover:bg-muted/50 text-foreground'
                          }`}
                      >
                        <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors
                          ${alreadyAdded ? 'border-border/40 bg-muted/30' : on ? 'bg-primary border-primary' : 'border-border/60'}`}>
                          {(on || alreadyAdded) && <Check className="h-2.5 w-2.5 text-white" />}
                        </span>
                        <span className="flex-1 truncate font-medium">{name}</span>
                        {alreadyAdded && (
                          <span className="text-[10px] text-muted-foreground/50 shrink-0">already added</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Action buttons */}
          <div className="flex items-center justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" size="sm" onClick={() => handleClose(false)} disabled={merging}>
              <X className="h-3.5 w-3.5 mr-1" /> Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => void handleMerge()}
              disabled={extracted.length === 0 || checked.size === 0 || merging || uploading}
            >
              {merging && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              Add {checked.size > 0 ? checked.size : ''} skill{checked.size !== 1 ? 's' : ''}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
