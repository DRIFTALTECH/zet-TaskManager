/**
 * Shared Create Project modal — project name, description, and required client selection.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator,
} from '@/components/ui/command';
import { useAppStore } from '@/stores/appStore';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

const CREATE_NEW = '__create_new__';

const inputCls =
  'w-full rounded-xl border border-border/50 bg-muted/40 px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/20 transition-all placeholder:text-muted-foreground/40';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export default function CreateProjectDialog({ open, onOpenChange }: Props) {
  const { clients, loadClients, createClient, createProject } = useAppStore();

  const [projName, setProjName] = useState('');
  const [projDesc, setProjDesc] = useState('');
  const [clientPickerOpen, setClientPickerOpen] = useState(false);
  const [clientMode, setClientMode] = useState<'select' | 'create'>('select');
  const [selectedClientId, setSelectedClientId] = useState('');
  const [newClientName, setNewClientName] = useState('');
  const [creating, setCreating] = useState(false);

  const sortedClients = useMemo(
    () => [...clients].sort((a, b) => a.name.localeCompare(b.name)),
    [clients],
  );

  const selectedClient = sortedClients.find(c => c.id === selectedClientId) ?? null;

  const reset = useCallback(() => {
    setProjName('');
    setProjDesc('');
    setClientMode('select');
    setSelectedClientId('');
    setNewClientName('');
    setClientPickerOpen(false);
  }, []);

  useEffect(() => {
    if (open) void loadClients();
    else reset();
  }, [open, loadClients, reset]);

  const canSubmit = useMemo(() => {
    if (!projName.trim()) return false;
    if (clientMode === 'create') return !!newClientName.trim();
    return !!selectedClientId;
  }, [projName, clientMode, newClientName, selectedClientId]);

  const handleCreate = async () => {
    if (!projName.trim()) return toast.error('Enter project name');
    setCreating(true);
    try {
      let clientId = selectedClientId;
      if (clientMode === 'create') {
        const name = newClientName.trim();
        if (!name) return toast.error('Enter client name');
        const client = await createClient(name);
        clientId = client.id;
      } else if (!clientId) {
        return toast.error('Select a client');
      }
      await createProject(projName.trim(), projDesc.trim(), clientId);
      toast.success('Project created!');
      onOpenChange(false);
      reset();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not create project');
    } finally {
      setCreating(false);
    }
  };

  const pickClient = (id: string) => {
    if (id === CREATE_NEW) {
      setClientMode('create');
      setSelectedClientId('');
      setNewClientName('');
    } else {
      setClientMode('select');
      setSelectedClientId(id);
      setNewClientName('');
    }
    setClientPickerOpen(false);
  };

  const clientTriggerLabel = clientMode === 'create'
    ? '+ Create New Client'
    : selectedClient?.name ?? 'Select client';

  return (
    <Dialog open={open} onOpenChange={o => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent className="rounded-2xl">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">Create Project</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 pt-2">
          <input
            autoFocus
            value={projName}
            onChange={e => setProjName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && canSubmit && void handleCreate()}
            className={inputCls}
            placeholder="Project name"
          />

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">
              Client <span className="text-destructive">*</span>
            </Label>
            <Popover open={clientPickerOpen} onOpenChange={setClientPickerOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  role="combobox"
                  aria-expanded={clientPickerOpen}
                  className={cn(
                    'w-full h-auto min-h-[42px] justify-between gap-2 rounded-xl border-border/50 bg-muted/40 px-3.5 py-2.5 text-sm font-normal',
                    clientMode === 'create' && 'text-primary',
                  )}
                >
                  <span className="truncate text-left">{clientTriggerLabel}</span>
                  <ChevronDown className="size-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                <Command>
                  <CommandInput placeholder="Search clients…" className="h-9 text-xs" />
                  <CommandList>
                    <CommandEmpty>No client found.</CommandEmpty>
                    <CommandGroup>
                      {sortedClients.map(c => (
                        <CommandItem
                          key={c.id}
                          value={c.name}
                          onSelect={() => pickClient(c.id)}
                          className="text-xs"
                        >
                          {c.name}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                    <CommandSeparator />
                    <CommandGroup>
                      <CommandItem
                        value="+ Create New Client"
                        onSelect={() => pickClient(CREATE_NEW)}
                        className="text-xs text-primary font-semibold"
                      >
                        + Create New Client
                      </CommandItem>
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>

            {clientMode === 'create' && (
              <input
                value={newClientName}
                onChange={e => setNewClientName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && canSubmit && void handleCreate()}
                className={inputCls}
                placeholder="New client name"
              />
            )}
          </div>

          <textarea
            value={projDesc}
            onChange={e => setProjDesc(e.target.value)}
            className={`${inputCls} min-h-[72px] resize-none`}
            placeholder="Description (optional)"
          />
          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={!canSubmit || creating}
            className="w-full rounded-xl bg-primary py-2.5 text-sm font-bold text-primary-foreground hover:opacity-90 disabled:opacity-40 transition-all shadow-sm hover:shadow-md"
          >
            {creating ? 'Creating…' : 'Create Project'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
