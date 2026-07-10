/**
 * SkillsPicker — searchable skill dropdown with removable tags.
 * Reused on user profile edit; backed by /skills and user skill APIs.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, Plus, X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator,
} from '@/components/ui/command';
import { Button } from '@/components/ui/button';
import { useAppStore } from '@/stores/appStore';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { Skill } from '@/types';

const CREATE_NEW = '__create_new__';

const inputCls =
  'w-full rounded-xl border border-border/50 bg-muted/40 px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40';

type Props = {
  selectedSkillIds: string[];
  onChange: (skillIds: string[]) => void;
  disabled?: boolean;
  className?: string;
};

export function SkillsPicker({ selectedSkillIds, onChange, disabled, className }: Props) {
  const { skills, loadSkills, createSkill } = useAppStore();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newSkillName, setNewSkillName] = useState('');

  useEffect(() => {
    void loadSkills();
  }, [loadSkills]);

  const selectedSet = useMemo(() => new Set(selectedSkillIds), [selectedSkillIds]);

  const selectedSkills = useMemo(
    () => selectedSkillIds
      .map(id => skills.find(s => s.id === id))
      .filter(Boolean) as Skill[],
    [selectedSkillIds, skills],
  );

  const available = useMemo(
    () => skills.filter(s => !selectedSet.has(s.id)),
    [skills, selectedSet],
  );

  const addSkill = useCallback((skillId: string) => {
    if (selectedSet.has(skillId)) return;
    onChange([...selectedSkillIds, skillId]);
    setOpen(false);
  }, [onChange, selectedSet, selectedSkillIds]);

  const removeSkill = useCallback((skillId: string) => {
    onChange(selectedSkillIds.filter(id => id !== skillId));
  }, [onChange, selectedSkillIds]);

  const handleCreate = async () => {
    const name = newSkillName.trim();
    if (!name) return toast.error('Enter a skill name');
    const dup = skills.find(s => s.name.toLowerCase() === name.toLowerCase());
    if (dup) {
      if (!selectedSet.has(dup.id)) addSkill(dup.id);
      setCreating(false);
      setNewSkillName('');
      return;
    }
    try {
      const skill = await createSkill(name);
      addSkill(skill.id);
      setCreating(false);
      setNewSkillName('');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not add skill');
    }
  };

  return (
    <div className={cn('space-y-3', className)}>
      <AnimatePresence mode="popLayout">
        {selectedSkills.length > 0 && (
          <motion.div
            layout
            className="flex flex-wrap gap-1.5"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            {selectedSkills.map(skill => (
              <motion.span
                key={skill.id}
                layout
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.85 }}
                transition={{ duration: 0.15 }}
                className="inline-flex items-center gap-1 rounded-full border border-primary/25 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary"
              >
                {skill.name}
                {!disabled && (
                  <button
                    type="button"
                    onClick={() => removeSkill(skill.id)}
                    className="rounded-full p-0.5 hover:bg-primary/20 transition-colors"
                    aria-label={`Remove ${skill.name}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </motion.span>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {!disabled && !creating && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              role="combobox"
              aria-expanded={open}
              className="w-full sm:w-auto min-w-[200px] justify-between gap-2 rounded-xl border-border/50 bg-muted/40 text-sm font-normal"
            >
              <span className="text-muted-foreground">Add a skill…</span>
              <ChevronDown className="size-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-[240px] p-0" align="start">
            <Command>
              <CommandInput placeholder="Search skills…" className="h-9 text-xs" />
              <CommandList>
                <CommandEmpty>No skills found.</CommandEmpty>
                <CommandGroup>
                  {available.map(s => (
                    <CommandItem
                      key={s.id}
                      value={s.name}
                      onSelect={() => addSkill(s.id)}
                      className="text-xs"
                    >
                      {s.name}
                    </CommandItem>
                  ))}
                </CommandGroup>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem
                    value="+ Add New Skill"
                    onSelect={() => {
                      setOpen(false);
                      setCreating(true);
                    }}
                    className="text-xs text-primary font-semibold"
                  >
                    <Plus className="h-3.5 w-3.5 mr-1.5" />
                    + Add New Skill
                  </CommandItem>
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      )}

      {!disabled && creating && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col sm:flex-row gap-2"
        >
          <input
            value={newSkillName}
            onChange={e => setNewSkillName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') void handleCreate();
              if (e.key === 'Escape') { setCreating(false); setNewSkillName(''); }
            }}
            className={inputCls}
            placeholder="New skill name"
            autoFocus
          />
          <div className="flex gap-2 shrink-0">
            <Button type="button" size="sm" onClick={() => void handleCreate()} disabled={!newSkillName.trim()}>
              Add
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => { setCreating(false); setNewSkillName(''); }}>
              Cancel
            </Button>
          </div>
        </motion.div>
      )}
    </div>
  );
}

/** Compact skill pills for user cards (max 5 + overflow). */
export function UserSkillBadges({ skills, className }: { skills: string[]; className?: string }) {
  if (!skills.length) return null;
  const visible = skills.slice(0, 5);
  const extra = skills.length - 5;
  return (
    <div className={cn('flex flex-wrap gap-1 mt-1.5', className)}>
      {visible.map(name => (
        <span
          key={name}
          className="text-[10px] px-2 py-0.5 rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-600 dark:text-violet-300 font-medium"
        >
          {name}
        </span>
      ))}
      {extra > 0 && (
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted/50 border border-border/40 text-muted-foreground font-medium">
          +{extra} more
        </span>
      )}
    </div>
  );
}
