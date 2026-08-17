import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  ShieldCheck, KeyRound, Trash2, FolderKanban, RefreshCw,
  UserCheck, UserX, Search, Clock,
} from 'lucide-react';
import type { AuditLog, Role, User } from '@/types';
import { superadminApi, type SuperadminProject } from '@/lib/superadminApi';
import { useAppStore } from '@/stores/appStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const ROLE_LABEL: Record<Role, string> = {
  superadmin: 'Superadmin',
  manager: 'Manager',
  employee: 'Employee',
};

function initials(name: string): string {
  return name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase()).join('') || '?';
}

/**
 * Superadmin console. Nobody can use ZET until a superadmin approves their
 * account here, and roles are handed out from this page only.
 *
 * Every hook runs before the role guard below — an early return above a hook
 * changes the hook count between renders and crashes React.
 */
const SuperAdminPage = () => {
  const currentUser = useAppStore(s => s.currentUser);

  const [users, setUsers] = useState<User[]>([]);
  const [projects, setProjects] = useState<SuperadminProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState('pending');

  const [audit, setAudit] = useState<AuditLog[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);

  // Reset-password dialog
  const [pwTarget, setPwTarget] = useState<User | null>(null);
  const [pwValue, setPwValue] = useState('');

  // Project-membership dialog
  const [projTarget, setProjTarget] = useState<User | null>(null);
  const [projSelected, setProjSelected] = useState<Set<string>>(new Set());

  // Delete dialog
  const [delTarget, setDelTarget] = useState<User | null>(null);
  const [reassignTo, setReassignTo] = useState<string>('none');

  const [busy, setBusy] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [u, p] = await Promise.all([superadminApi.listUsers(), superadminApi.listProjects()]);
      setUsers(u);
      setProjects(p);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not load users');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadAudit = useCallback(async () => {
    setAuditLoading(true);
    try {
      setAudit(await superadminApi.listAudit(200));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not load the activity log');
    } finally {
      setAuditLoading(false);
    }
  }, []);

  const isSuperadmin = currentUser?.role === 'superadmin';

  useEffect(() => {
    if (isSuperadmin) void loadAll();
  }, [isSuperadmin, loadAll]);

  useEffect(() => {
    if (tab === 'audit' && isSuperadmin) void loadAudit();
  }, [tab, isSuperadmin, loadAudit]);

  const pending = useMemo(() => users.filter(u => u.isActive === false), [users]);
  const active = useMemo(() => users.filter(u => u.isActive !== false), [users]);

  const filterByQuery = useCallback((list: User[]) => {
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(u =>
      u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q),
    );
  }, [query]);

  const managerOptions = useMemo(
    () => users
      .filter(u => (u.role === 'manager' || u.role === 'superadmin') && u.isActive !== false)
      .sort((a, b) => a.name.localeCompare(b.name)),
    [users],
  );

  const managerName = useCallback(
    (id: string | null | undefined) => (id ? users.find(u => u.id === id)?.name ?? id : null),
    [users],
  );

  const replaceUser = useCallback((updated: User) => {
    setUsers(prev => prev.map(x => (x.id === updated.id ? updated : x)));
  }, []);

  const onChangeRole = useCallback(async (u: User, role: Role) => {
    if (role === u.role) return;
    try {
      replaceUser(await superadminApi.changeRole(u.id, role));
      toast.success(`${u.name} is now ${ROLE_LABEL[role].toLowerCase()}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not change the role');
    }
  }, [replaceUser]);

  const onChangeManager = useCallback(async (u: User, managerId: string | null) => {
    if (managerId === (u.managerId ?? null)) return;
    try {
      replaceUser(await superadminApi.setManager(u.id, managerId));
      const label = managerName(managerId);
      toast.success(label ? `${u.name} now reports to ${label}` : `Manager removed for ${u.name}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not assign the manager');
    }
  }, [managerName, replaceUser]);

  const approve = useCallback(async (u: User) => {
    try {
      replaceUser(await superadminApi.activate(u.id));
      toast.success(`${u.name} can now sign in`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not approve the account');
    }
  }, [replaceUser]);

  const revoke = useCallback(async (u: User) => {
    try {
      replaceUser(await superadminApi.deactivate(u.id));
      toast.success(`${u.name} has been switched off and signed out`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not deactivate the account');
    }
  }, [replaceUser]);

  const doResetPassword = useCallback(async () => {
    if (!pwTarget || pwValue.length < 6) return;
    setBusy(true);
    try {
      await superadminApi.resetPassword(pwTarget.id, pwValue);
      toast.success(`Password reset for ${pwTarget.name}`);
      setPwTarget(null);
      setPwValue('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not reset the password');
    } finally {
      setBusy(false);
    }
  }, [pwTarget, pwValue]);

  const saveProjects = useCallback(async () => {
    if (!projTarget) return;
    setBusy(true);
    try {
      replaceUser(await superadminApi.setProjects(projTarget.id, [...projSelected]));
      toast.success(`Projects updated for ${projTarget.name}`);
      setProjTarget(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update projects');
    } finally {
      setBusy(false);
    }
  }, [projTarget, projSelected, replaceUser]);

  const doDelete = useCallback(async () => {
    if (!delTarget) return;
    setBusy(true);
    try {
      await superadminApi.deleteUser(delTarget.id, reassignTo === 'none' ? null : reassignTo);
      setUsers(prev => prev.filter(x => x.id !== delTarget.id));
      toast.success(`${delTarget.name} deleted`);
      setDelTarget(null);
      setReassignTo('none');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete the user');
    } finally {
      setBusy(false);
    }
  }, [delTarget, reassignTo]);

  // ── Guard runs only after every hook above has been called ───────────────────
  if (!currentUser) return <Navigate to="/login" replace />;
  if (!isSuperadmin) return <Navigate to="/" replace />;

  const isSelf = (u: User) => u.id === currentUser.id;

  const roleSelect = (u: User, className: string) => (
    <Select value={u.role} onValueChange={(v: Role) => void onChangeRole(u, v)} disabled={isSelf(u)}>
      <SelectTrigger className={className}><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="employee">Employee</SelectItem>
        <SelectItem value="manager">Manager</SelectItem>
        <SelectItem value="superadmin">Superadmin</SelectItem>
      </SelectContent>
    </Select>
  );

  const managerSelect = (u: User, className: string) => (
    <Select
      value={u.managerId ?? '__none__'}
      onValueChange={v => void onChangeManager(u, v === '__none__' ? null : v)}
      disabled={managerOptions.length === 0}
    >
      <SelectTrigger className={className}>
        <SelectValue placeholder="No manager" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__none__">No manager</SelectItem>
        {managerOptions.filter(m => m.id !== u.id).map(m => (
          <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  const rowActions = (u: User) => (
    <div className="flex items-center justify-end gap-1">
      <Button variant="ghost" size="sm" title="Project membership" onClick={() => {
        setProjTarget(u);
        setProjSelected(new Set(u.projectIds));
      }}>
        <FolderKanban className="h-4 w-4" />
      </Button>
      <Button variant="ghost" size="sm" title="Reset password" onClick={() => { setPwTarget(u); setPwValue(''); }}>
        <KeyRound className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        title={isSelf(u) ? 'You cannot deactivate your own account' : 'Deactivate'}
        disabled={isSelf(u)}
        onClick={() => void revoke(u)}
      >
        <UserX className="h-4 w-4 text-amber-500" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        title={isSelf(u) ? 'You cannot delete your own account' : 'Delete user'}
        disabled={isSelf(u)}
        onClick={() => { setDelTarget(u); setReassignTo('none'); }}
      >
        <Trash2 className="h-4 w-4 text-destructive" />
      </Button>
    </div>
  );

  const pendingList = filterByQuery(pending);
  const activeList = filterByQuery(active);

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6 py-6">
      <header className="flex flex-wrap items-center justify-between gap-3 pb-5">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-400">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight leading-none">Superadmin</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Approve accounts, assign roles, and manage access
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => void loadAll()} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-1.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </Button>
      </header>

      <div className="relative w-full max-w-xs mb-4">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-8"
          placeholder="Search name or email…"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="pending" className="gap-1.5">
            Waiting for approval
            {pending.length > 0 && (
              <span className="rounded-full bg-amber-500/20 px-1.5 text-[11px] font-semibold text-amber-500 tabular-nums">
                {pending.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="users">
            Team <span className="ml-1 text-muted-foreground tabular-nums">({active.length})</span>
          </TabsTrigger>
          <TabsTrigger value="audit">Activity</TabsTrigger>
        </TabsList>

        {/* ── Approval queue ─────────────────────────────────────────────────── */}
        <TabsContent value="pending" className="mt-4">
          {loading ? (
            <p className="text-center text-muted-foreground py-12">Loading…</p>
          ) : pendingList.length === 0 ? (
            <div className="rounded-xl border border-border py-14 text-center">
              <Clock className="mx-auto h-6 w-6 text-muted-foreground/50" />
              <p className="mt-2 text-sm font-medium">Nothing waiting</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                New sign-ups land here until you approve them.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {pendingList.map(u => (
                <div
                  key={u.id}
                  className="flex flex-col gap-3 rounded-xl border border-amber-500/30 bg-amber-500/[0.04] p-3 sm:flex-row sm:items-center"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                      {initials(u.name)}
                    </div>
                    <div className="min-w-0">
                      <div className="font-medium truncate">{u.name}</div>
                      <div className="text-xs text-muted-foreground truncate">{u.email}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {roleSelect(u, 'h-8 w-32')}
                    <Button size="sm" onClick={() => void approve(u)}>
                      <UserCheck className="h-4 w-4 mr-1.5" /> Approve
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      title="Reject and delete"
                      onClick={() => { setDelTarget(u); setReassignTo('none'); }}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── Active team ────────────────────────────────────────────────────── */}
        <TabsContent value="users" className="mt-4">
          <div className="hidden md:block rounded-xl border border-border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Reports to</TableHead>
                  <TableHead>Projects</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-10">Loading…</TableCell></TableRow>
                ) : activeList.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-10">No active users</TableCell></TableRow>
                ) : activeList.map(u => (
                  <TableRow key={u.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-xs font-medium">
                          {initials(u.name)}
                        </div>
                        <div className="min-w-0">
                          <div className="font-medium truncate flex items-center gap-1.5">
                            {u.name}
                            {isSelf(u) && <Badge variant="secondary" className="text-[10px]">You</Badge>}
                          </div>
                          <div className="text-xs text-muted-foreground truncate">{u.email}</div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>{roleSelect(u, 'h-8 w-32')}</TableCell>
                    <TableCell>{managerSelect(u, 'h-8 w-40')}</TableCell>
                    <TableCell>
                      <span className="text-sm text-muted-foreground tabular-nums">
                        {u.projectIds.length === 0 ? '—' : u.projectIds.length}
                      </span>
                    </TableCell>
                    <TableCell>{rowActions(u)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile: stacked cards */}
          <div className="md:hidden space-y-3">
            {loading ? (
              <p className="text-center text-muted-foreground py-10">Loading…</p>
            ) : activeList.length === 0 ? (
              <p className="text-center text-muted-foreground py-10">No active users</p>
            ) : activeList.map(u => (
              <div key={u.id} className="rounded-xl border border-border p-3">
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                    {initials(u.name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate">{u.name}</div>
                    <div className="text-xs text-muted-foreground truncate">{u.email}</div>
                  </div>
                  {isSelf(u) && <Badge variant="secondary" className="shrink-0 text-[10px]">You</Badge>}
                </div>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  {roleSelect(u, 'h-8 flex-1')}
                  {managerSelect(u, 'h-8 flex-1')}
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  {u.projectIds.length === 0
                    ? 'No projects'
                    : `${u.projectIds.length} project${u.projectIds.length > 1 ? 's' : ''}`}
                </div>
                <div className="mt-3 border-t border-border/60 pt-2">{rowActions(u)}</div>
              </div>
            ))}
          </div>
        </TabsContent>

        {/* ── Activity ───────────────────────────────────────────────────────── */}
        <TabsContent value="audit" className="mt-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm text-muted-foreground">Recent activity across the workspace.</p>
            <Button variant="outline" size="sm" onClick={() => void loadAudit()} disabled={auditLoading}>
              <RefreshCw className={`h-4 w-4 mr-1.5 ${auditLoading ? 'animate-spin' : ''}`} /> Refresh
            </Button>
          </div>
          <div className="hidden md:block rounded-xl border border-border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Who</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Entity</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {auditLoading ? (
                  <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-10">Loading…</TableCell></TableRow>
                ) : audit.length === 0 ? (
                  <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-10">No activity recorded</TableCell></TableRow>
                ) : audit.map(a => (
                  <TableRow key={a.id}>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(a.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-sm">{a.userName}</TableCell>
                    <TableCell><code className="text-xs">{a.action}</code></TableCell>
                    <TableCell className="text-sm text-muted-foreground truncate max-w-[240px]">
                      {a.entityName || a.entityType}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="md:hidden space-y-2">
            {auditLoading ? (
              <p className="text-center text-muted-foreground py-10">Loading…</p>
            ) : audit.length === 0 ? (
              <p className="text-center text-muted-foreground py-10">No activity recorded</p>
            ) : audit.map(a => (
              <div key={a.id} className="rounded-xl border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium truncate">{a.userName}</span>
                  <code className="text-[11px] shrink-0">{a.action}</code>
                </div>
                <div className="mt-1 text-sm text-muted-foreground truncate">{a.entityName || a.entityType}</div>
                <div className="mt-1 text-xs text-muted-foreground">{new Date(a.createdAt).toLocaleString()}</div>
              </div>
            ))}
          </div>
        </TabsContent>
      </Tabs>

      {/* Reset password */}
      <Dialog open={!!pwTarget} onOpenChange={o => { if (!o) setPwTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset password</DialogTitle>
            <DialogDescription>
              Set a new password for {pwTarget?.name}. Send it to them over a channel you trust — they can change it in Settings.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="new-user-pw">New password</Label>
            <Input
              id="new-user-pw"
              type="text"
              value={pwValue}
              onChange={e => setPwValue(e.target.value)}
              placeholder="At least 6 characters"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPwTarget(null)}>Cancel</Button>
            <Button onClick={() => void doResetPassword()} disabled={busy || pwValue.length < 6}>
              Reset password
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Project membership */}
      <Dialog open={!!projTarget} onOpenChange={o => { if (!o) setProjTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Projects for {projTarget?.name}</DialogTitle>
            <DialogDescription>Pick the projects this user belongs to.</DialogDescription>
          </DialogHeader>
          <div className="max-h-[320px] overflow-y-auto space-y-1 pr-1">
            {projects.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No projects exist yet.</p>
            ) : projects.map(p => (
              <label key={p.id} className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-muted/50 cursor-pointer">
                <Checkbox
                  checked={projSelected.has(p.id)}
                  onCheckedChange={v => setProjSelected(prev => {
                    const next = new Set(prev);
                    if (v) next.add(p.id); else next.delete(p.id);
                    return next;
                  })}
                />
                <span className="text-sm">{p.name}</span>
              </label>
            ))}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setProjTarget(null)}>Cancel</Button>
            <Button onClick={() => void saveProjects()} disabled={busy}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete user */}
      <Dialog open={!!delTarget} onOpenChange={o => { if (!o) setDelTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {delTarget?.name}?</DialogTitle>
            <DialogDescription>
              This permanently removes the account. If they own tasks or timesheets, choose who inherits that work.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>Reassign their work to</Label>
            <Select value={reassignTo} onValueChange={setReassignTo}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Nobody — only works if they own no work</SelectItem>
                {active.filter(u => u.id !== delTarget?.id).map(u => (
                  <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDelTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => void doDelete()} disabled={busy}>Delete user</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default SuperAdminPage;
