/**
 * ChangeClientDialog — pick an existing client, create a new one, or clear the client.
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
const NO_CLIENT = '__no_client__';

const inputCls =
  'w-full rounded-xl border border-border/50 bg-muted/40 px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/20 transition-all placeholder:text-muted-foreground/40';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  currentClientId?: string | null;
  onSaved?: () => void;
};

export default function ChangeClientDialog({
  open,
  onOpenChange,
  projectId,
  currentClientId,
  onSaved,
}: Props) {
  const { clients, loadClients, createClient, updateProjectClient } = useAppStore();

  const [clientPickerOpen, setClientPickerOpen] = useState(false);
  const [clientMode, setClientMode] = useState<'select' | 'create'>('select');
  const [selectedClientId, setSelectedClientId] = useState('');
  const [newClientName, setNewClientName] = useState('');
  const [saving, setSaving] = useState(false);

  const sortedClients = useMemo(
    () => [...clients].sort((a, b) => a.name.localeCompare(b.name)),
    [clients],
  );

  const selectedClient = useMemo(() => {
    if (selectedClientId === NO_CLIENT) return { id: NO_CLIENT, name: 'No client' };
    return sortedClients.find(c => c.id === selectedClientId) ?? null;
  }, [sortedClients, selectedClientId]);

  const reset = useCallback(() => {
    setClientMode('select');
    setSelectedClientId(currentClientId ?? NO_CLIENT);
    setNewClientName('');
    setClientPickerOpen(false);
  }, [currentClientId]);

  useEffect(() => {
    if (open) {
      void loadClients();
      reset();
    }
  }, [open, loadClients, reset]);

  const canSubmit = useMemo(() => {
    if (clientMode === 'create') return !!newClientName.trim();
    return true;
  }, [clientMode, newClientName]);

  const handleSave = async () => {
    setSaving(true);
    try {
      let clientId: string | null = selectedClientId;
      if (clientMode === 'create') {
        const name = newClientName.trim();
        if (!name) {
          toast.error('Enter a client name');
          return;
        }
        const client = await createClient(name);
        clientId = client.id;
      } else if (clientId === NO_CLIENT) {
        clientId = null;
      }
      await updateProjectClient(projectId, clientId);
      toast.success(clientId ? 'Client updated' : 'Client removed');
      onOpenChange(false);
      onSaved?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update client');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle>Change client</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          {clientMode === 'select' ? (
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Client</Label>
              <Popover open={clientPickerOpen} onOpenChange={setClientPickerOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      'w-full flex items-center justify-between rounded-xl border border-border/50 bg-muted/40 px-3.5 py-2.5 text-sm transition-all',
                      'hover:border-border focus:outline-none focus:ring-2 focus:ring-primary/40',
                    )}
                  >
                    <span className={selectedClient ? 'text-foreground' : 'text-muted-foreground/50'}>
                      {selectedClient?.name ?? 'Pick a client…'}
                    </span>
                    <ChevronDown className="h-4 w-4 text-muted-foreground/50 shrink-0" />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0 rounded-xl" align="start">
                  <Command>
                    <CommandInput placeholder="Search clients…" className="h-9 text-xs" />
                    <CommandList>
                      <CommandEmpty>No clients found.</CommandEmpty>
                      <CommandGroup>
                        <CommandItem
                          value="no client none"
                          onSelect={() => {
                            setSelectedClientId(NO_CLIENT);
                            setClientPickerOpen(false);
                          }}
                        >
                          No client
                        </CommandItem>
                        {sortedClients.map(c => (
                          <CommandItem
                            key={c.id}
                            value={c.name}
                            onSelect={() => {
                              setSelectedClientId(c.id);
                              setClientPickerOpen(false);
                            }}
                          >
                            {c.name}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                      <CommandSeparator />
                      <CommandGroup>
                        <CommandItem
                          value="create new client"
                          onSelect={() => {
                            setClientMode('create');
                            setClientPickerOpen(false);
                          }}
                        >
                          + Create new client
                        </CommandItem>
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
          ) : (
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">New client name</Label>
              <input
                value={newClientName}
                onChange={e => setNewClientName(e.target.value)}
                placeholder="e.g. Acme Corp"
                className={inputCls}
                autoFocus
              />
              <button
                type="button"
                onClick={() => setClientMode('select')}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                ← Back to client list
              </button>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={() => void handleSave()} disabled={!canSubmit || saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
