import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  ShieldCheck, LogOut, KeyRound, Trash2, FolderKanban, RefreshCw,
  UserCheck, UserX, Search,
} from 'lucide-react';
import type { AuditLog, Role, User } from '@/types';
import { adminApi, clearAdminToken, getAdminToken, type AdminProject } from '@/lib/adminApi';
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

function initials(name: string): string {
  return name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase()).join('') || '?';
}

const AdminPage = () => {
  const navigate = useNavigate();
  const hasToken = !!getAdminToken();

  const [users, setUsers] = useState<User[]>([]);
  const [projects, setProjects] = useState<AdminProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState('users');

  const [audit, setAudit] = useState<AuditLog[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);

  // Reset-password dialog
  const [pwTarget, setPwTarget] = useState<User | null>(null);
  const [pwValue, setPwValue] = useState('');

  // Move-projects dialog
  const [projTarget, setProjTarget] = useState<User | null>(null);
  const [projSelected, setProjSelected] = useState<Set<string>>(new Set());

  // Delete dialog
  const [delTarget, setDelTarget] = useState<User | null>(null);
  const [reassignTo, setReassignTo] = useState<string>('none');

  // Change-admin-password dialog
  const [adminPwOpen, setAdminPwOpen] = useState(false);
  const [curPw, setCurPw] = useState('');
  const [newPw, setNewPw] = useState('');

  const [busy, setBusy] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [u, p] = await Promise.all([adminApi.listUsers(), adminApi.listProjects()]);
      setUsers(u);
      setProjects(p);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load';
      toast.error(msg);
      if (/expired|unauthor|admin token/i.test(msg)) {
        clearAdminToken();
        navigate('/admin/login', { replace: true });
      }
    } finally {
      setLoading(false);
    }
  }, [navigate]);

  useEffect(() => {
    if (hasToken) void loadAll();
  }, [hasToken, loadAll]);

  const loadAudit = useCallback(async () => {
    setAuditLoading(true);
    try {
      setAudit(await adminApi.listAudit(200));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load audit log');
    } finally {
      setAuditLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === 'audit' && hasToken) void loadAudit();
  }, [tab, hasToken, loadAudit]);

  const projectName = useCallback(
    (id: string) => projects.find(p => p.id === id)?.name ?? id,
    [projects],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter(u =>
      u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q),
    );
  }, [users, query]);

  if (!hasToken) return <Navigate to="/admin/login" replace />;

  const logout = () => {
    clearAdminToken();
    navigate('/admin/login', { replace: true });
  };

  const onChangeRole = async (u: User, role: Role) => {
    if (role === u.role) return;
    try {
      const updated = await adminApi.changeRole(u.id, role);
      setUsers(prev => prev.map(x => (x.id === u.id ? updated : x)));
      toast.success(`${u.name} is now ${role}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to change role');
    }
  };

  const toggleActive = async (u: User) => {
    try {
      const updated = u.isActive === false ? await adminApi.activate(u.id) : await adminApi.deactivate(u.id);
      setUsers(prev => prev.map(x => (x.id === u.id ? updated : x)));
      toast.success(updated.isActive === false ? `${u.name} deactivated` : `${u.name} reactivated`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update status');
    }
  };

  const doResetPassword = async () => {
    if (!pwTarget || pwValue.length < 6) return;
    setBusy(true);
    try {
      await adminApi.resetPassword(pwTarget.id, pwValue);
      toast.success(`Password reset for ${pwTarget.name}`);
      setPwTarget(null);
      setPwValue('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to reset password');
    } finally {
      setBusy(false);
    }
  };

  const openProjects = (u: User) => {
    setProjTarget(u);
    setProjSelected(new Set(u.projectIds));
  };

  const saveProjects = async () => {
    if (!projTarget) return;
    setBusy(true);
    try {
      const updated = await adminApi.setProjects(projTarget.id, [...projSelected]);
      setUsers(prev => prev.map(x => (x.id === projTarget.id ? updated : x)));
      toast.success(`Updated projects for ${projTarget.name}`);
      setProjTarget(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update projects');
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async () => {
    if (!delTarget) return;
    setBusy(true);
    try {
      await adminApi.deleteUser(delTarget.id, reassignTo === 'none' ? null : reassignTo);
      setUsers(prev => prev.filter(x => x.id !== delTarget.id));
      toast.success(`${delTarget.name} deleted`);
      setDelTarget(null);
      setReassignTo('none');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete user');
    } finally {
      setBusy(false);
    }
  };

  const doChangeAdminPw = async () => {
    if (newPw.length < 8) {
      toast.error('New password must be at least 8 characters');
      return;
    }
    setBusy(true);
    try {
      await adminApi.changeAdminPassword(curPw, newPw);
      toast.success('Admin password changed');
      setAdminPwOpen(false);
      setCurPw('');
      setNewPw('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to change password');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-400">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-tight leading-none">Admin Console</h1>
              <p className="text-xs text-muted-foreground mt-0.5">Manage user accounts</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button variant="outline" size="sm" onClick={() => setAdminPwOpen(true)}>
              <KeyRound className="h-4 w-4 sm:mr-1.5" /> <span className="hidden sm:inline">Change password</span>
            </Button>
            <Button variant="ghost" size="sm" onClick={logout}>
              <LogOut className="h-4 w-4 sm:mr-1.5" /> <span className="hidden sm:inline">Log out</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 sm:px-6 py-6">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="users">Users</TabsTrigger>
            <TabsTrigger value="audit">Audit log</TabsTrigger>
          </TabsList>

          <TabsContent value="users" className="mt-4">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div className="relative w-full max-w-xs">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-8"
                  placeholder="Search name or email…"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                />
              </div>
              <Button variant="outline" size="sm" onClick={() => void loadAll()} disabled={loading}>
                <RefreshCw className={`h-4 w-4 mr-1.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
              </Button>
            </div>

            <div className="hidden md:block rounded-xl border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Projects</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-10">Loading…</TableCell></TableRow>
                  ) : filtered.length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-10">No users found</TableCell></TableRow>
                  ) : filtered.map(u => (
                    <TableRow key={u.id} className={u.isActive === false ? 'opacity-60' : ''}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-xs font-medium">
                            {initials(u.name)}
                          </div>
                          <div className="min-w-0">
                            <div className="font-medium truncate">{u.name}</div>
                            <div className="text-xs text-muted-foreground truncate">{u.email}</div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Select value={u.role} onValueChange={(v: Role) => void onChangeRole(u, v)}>
                          <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="employee">Employee</SelectItem>
                            <SelectItem value="manager">Manager</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        {u.isActive === false
                          ? <Badge variant="secondary" className="bg-amber-500/15 text-amber-500 hover:bg-amber-500/15">Deactivated</Badge>
                          : <Badge variant="secondary" className="bg-emerald-500/15 text-emerald-500 hover:bg-emerald-500/15">Active</Badge>}
                      </TableCell>
                      <TableCell>
                        <span className="text-sm text-muted-foreground">
                          {u.projectIds.length === 0 ? '—' : `${u.projectIds.length} project${u.projectIds.length > 1 ? 's' : ''}`}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="sm" title="Move between projects" onClick={() => openProjects(u)}>
                            <FolderKanban className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="sm" title="Reset password" onClick={() => { setPwTarget(u); setPwValue(''); }}>
                            <KeyRound className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="sm" title={u.isActive === false ? 'Reactivate' : 'Deactivate'} onClick={() => void toggleActive(u)}>
                            {u.isActive === false ? <UserCheck className="h-4 w-4 text-emerald-500" /> : <UserX className="h-4 w-4 text-amber-500" />}
                          </Button>
                          <Button variant="ghost" size="sm" title="Delete user" onClick={() => { setDelTarget(u); setReassignTo('none'); }}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Mobile: stacked cards */}
            <div className="md:hidden space-y-3">
              {loading ? (
                <p className="text-center text-muted-foreground py-10">Loading…</p>
              ) : filtered.length === 0 ? (
                <p className="text-center text-muted-foreground py-10">No users found</p>
              ) : filtered.map(u => (
                <div key={u.id} className={`rounded-xl border border-border p-3 ${u.isActive === false ? 'opacity-60' : ''}`}>
                  <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                      {initials(u.name)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium truncate">{u.name}</div>
                      <div className="text-xs text-muted-foreground truncate">{u.email}</div>
                    </div>
                    {u.isActive === false
                      ? <Badge variant="secondary" className="bg-amber-500/15 text-amber-500 hover:bg-amber-500/15 shrink-0">Deactivated</Badge>
                      : <Badge variant="secondary" className="bg-emerald-500/15 text-emerald-500 hover:bg-emerald-500/15 shrink-0">Active</Badge>}
                  </div>

                  <div className="mt-3 flex items-center gap-2">
                    <Select value={u.role} onValueChange={(v: Role) => void onChangeRole(u, v)}>
                      <SelectTrigger className="h-8 flex-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="employee">Employee</SelectItem>
                        <SelectItem value="manager">Manager</SelectItem>
                      </SelectContent>
                    </Select>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {u.projectIds.length === 0 ? 'No projects' : `${u.projectIds.length} project${u.projectIds.length > 1 ? 's' : ''}`}
                    </span>
                  </div>

                  <div className="mt-3 flex items-center justify-end gap-1 border-t border-border/60 pt-2">
                    <Button variant="ghost" size="sm" title="Move between projects" onClick={() => openProjects(u)}>
                      <FolderKanban className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="sm" title="Reset password" onClick={() => { setPwTarget(u); setPwValue(''); }}>
                      <KeyRound className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="sm" title={u.isActive === false ? 'Reactivate' : 'Deactivate'} onClick={() => void toggleActive(u)}>
                      {u.isActive === false ? <UserCheck className="h-4 w-4 text-emerald-500" /> : <UserX className="h-4 w-4 text-amber-500" />}
                    </Button>
                    <Button variant="ghost" size="sm" title="Delete user" onClick={() => { setDelTarget(u); setReassignTo('none'); }}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="audit" className="mt-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm text-muted-foreground">Recent activity across the workspace (last 7 days).</p>
              <Button variant="outline" size="sm" onClick={() => void loadAudit()} disabled={auditLoading}>
                <RefreshCw className={`h-4 w-4 mr-1.5 ${auditLoading ? 'animate-spin' : ''}`} /> Refresh
              </Button>
            </div>
            <div className="hidden md:block rounded-xl border border-border overflow-hidden">
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

            {/* Mobile: stacked cards */}
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
      </main>

      {/* Reset password */}
      <Dialog open={!!pwTarget} onOpenChange={o => { if (!o) setPwTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset password</DialogTitle>
            <DialogDescription>Set a new password for {pwTarget?.name}. They can change it later.</DialogDescription>
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
            <Button onClick={() => void doResetPassword()} disabled={busy || pwValue.length < 6}>Reset password</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Move projects */}
      <Dialog open={!!projTarget} onOpenChange={o => { if (!o) setProjTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Projects for {projTarget?.name}</DialogTitle>
            <DialogDescription>Select which projects this user belongs to.</DialogDescription>
          </DialogHeader>
          <div className="max-h-[320px] overflow-y-auto space-y-1 pr-1">
            {projects.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No projects exist yet.</p>
            ) : projects.map(p => {
              const checked = projSelected.has(p.id);
              return (
                <label key={p.id} className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-muted/50 cursor-pointer">
                  <Checkbox
                    checked={checked}
                    onCheckedChange={v => setProjSelected(prev => {
                      const next = new Set(prev);
                      if (v) next.add(p.id); else next.delete(p.id);
                      return next;
                    })}
                  />
                  <span className="text-sm">{p.name}</span>
                </label>
              );
            })}
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
                <SelectItem value="none">Leave unassigned (only if they have no work)</SelectItem>
                {users.filter(u => u.id !== delTarget?.id && u.isActive !== false).map(u => (
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

      {/* Change admin password */}
      <Dialog open={adminPwOpen} onOpenChange={setAdminPwOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change admin password</DialogTitle>
            <DialogDescription>Update the password used to sign in to this console.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="cur-admin-pw">Current password</Label>
              <Input id="cur-admin-pw" type="password" value={curPw} onChange={e => setCurPw(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-admin-pw">New password</Label>
              <Input id="new-admin-pw" type="password" value={newPw} onChange={e => setNewPw(e.target.value)} placeholder="At least 8 characters" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAdminPwOpen(false)}>Cancel</Button>
            <Button onClick={() => void doChangeAdminPw()} disabled={busy || newPw.length < 8}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminPage;
