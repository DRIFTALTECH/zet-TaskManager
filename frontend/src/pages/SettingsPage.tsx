import { useAppStore } from '@/stores/appStore';
import { motion } from 'framer-motion';
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  User, Lock, Sun, Moon, Camera, Check, Eye, EyeOff,
  Shield, Mail, Briefcase, Terminal, Copy, AlertTriangle, Trash2, Plug,
  ShieldCheck, Search, X, RefreshCw, ChevronDown, Puzzle, Code2, Bot,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { pageEnter } from '@/lib/motion';
import { api } from '@/lib/api';
import type { PersonalAccessToken, AuditLog } from '@/types';
import UserAvatar from '@/components/UserAvatar';
import AgentAvatar from '@/components/agents/AgentAvatar';

const ACTION_LABELS: Record<string, { label: string; color: string }> = {
  'task.created':        { label: 'Created task',         color: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25' },
  'task.updated':        { label: 'Updated task',         color: 'bg-blue-500/15 text-blue-400 border-blue-500/25' },
  'task.deleted':        { label: 'Deleted task',         color: 'bg-red-500/15 text-red-400 border-red-500/25' },
  'task.status_changed': { label: 'Changed status',       color: 'bg-violet-500/15 text-violet-400 border-violet-500/25' },
  'task.started':        { label: 'Started task',         color: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/25' },
  'task.approved':       { label: 'Approved task',        color: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25' },
  'task.reopened':       { label: 'Reopened task',        color: 'bg-amber-500/15 text-amber-400 border-amber-500/25' },
  'task.comment_added':  { label: 'Added comment',        color: 'bg-slate-500/15 text-slate-400 border-slate-500/25' },
  'checklist.created':   { label: 'Added checklist item', color: 'bg-teal-500/15 text-teal-400 border-teal-500/25' },
  'checklist.done':      { label: 'Completed item',       color: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25' },
  'checklist.undone':    { label: 'Unchecked item',       color: 'bg-amber-500/15 text-amber-400 border-amber-500/25' },
  'checklist.updated':   { label: 'Updated item',         color: 'bg-blue-500/15 text-blue-400 border-blue-500/25' },
  'checklist.deleted':   { label: 'Deleted item',         color: 'bg-red-500/15 text-red-400 border-red-500/25' },
  'attachment.uploaded': { label: 'Uploaded file',        color: 'bg-indigo-500/15 text-indigo-400 border-indigo-500/25' },
  'attachment.deleted':  { label: 'Deleted file',         color: 'bg-red-500/15 text-red-400 border-red-500/25' },
};

function fmtAuditDate(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const inputCls = 'w-full rounded-xl border border-border/50 bg-muted/40 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/20 transition-all placeholder:text-muted-foreground/40';

/** The MCP endpoint is embedded in the backend at /mcp; override with VITE_MCP_URL. */
const MCP_BASE = (import.meta.env.VITE_MCP_URL as string | undefined)
  || `${(import.meta.env.VITE_API_URL as string | undefined) || 'http://127.0.0.1:8000'}/mcp/`;

function fmtDate(iso: string): string {
  if (!iso) return '';
  try { return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return iso; }
}

// ── Connection guide (Developer settings) ──────────────────────────────────────

/** A copyable code / config block with a corner copy button. `copyText` lets the
 * displayed code be masked while the copy still yields the real value. */
function CodeBlock({ code, caption, copyText }: { code: string; caption?: string; copyText?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(copyText ?? code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked */ }
  };
  return (
    <div className="relative rounded-lg border border-border/40 bg-muted/30">
      {caption && (
        <div className="px-3 pt-2 text-[10px] font-bold uppercase tracking-wide text-muted-foreground/50">{caption}</div>
      )}
      <pre className="text-[11px] leading-relaxed font-mono text-foreground/85 overflow-x-auto whitespace-pre p-3 pr-11">{code}</pre>
      <button
        type="button"
        onClick={() => void copy()}
        title="Copy"
        className="absolute top-2 right-2 flex items-center justify-center h-7 w-7 rounded-md border border-border/50 bg-card/80 hover:bg-muted transition-colors"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

// Per-platform theming + config-file location. Static class strings so Tailwind keeps them.
const PLATFORMS = [
  {
    id: 'claude', label: 'Claude Code', icon: Terminal, location: '.mcp.json   (in your project root)',
    activeTab: 'bg-orange-500 text-white shadow-md shadow-orange-500/30',
    dot: 'bg-orange-500', text: 'text-orange-500', soft: 'bg-orange-500/10', edge: 'border-orange-500/40',
  },
  {
    id: 'cursor', label: 'Cursor', icon: Bot, location: '~/.cursor/mcp.json',
    activeTab: 'bg-zinc-900 text-white shadow-md shadow-black/30 dark:bg-white dark:text-zinc-900',
    dot: 'bg-zinc-900 dark:bg-white', text: 'text-zinc-900 dark:text-zinc-100', soft: 'bg-zinc-500/10', edge: 'border-zinc-500/40',
  },
  {
    id: 'vscode', label: 'VS Code', icon: Code2, location: '.vscode/mcp.json',
    activeTab: 'bg-blue-500 text-white shadow-md shadow-blue-500/30',
    dot: 'bg-blue-500', text: 'text-blue-500', soft: 'bg-blue-500/10', edge: 'border-blue-500/40',
  },
  {
    id: 'plugin', label: 'Plugin', icon: Puzzle, location: '',
    activeTab: 'bg-violet-500 text-white shadow-md shadow-violet-500/30',
    dot: 'bg-violet-500', text: 'text-violet-500', soft: 'bg-violet-500/10', edge: 'border-violet-500/40',
  },
] as const;
type PlatformId = (typeof PLATFORMS)[number]['id'];

/** One numbered step. The badge takes the active platform's color. */
function Step({ n, title, color, children }: { n: number; title: string; color: string; children?: ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className={`shrink-0 mt-0.5 h-6 w-6 rounded-full text-white text-[12px] font-bold flex items-center justify-center ${color}`}>{n}</span>
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        {children}
      </div>
    </div>
  );
}

/** Tabbed, per-platform connection guide. Default path is just the URL config (OAuth —
 * the client opens a browser login). A "Can't use OAuth?" fallback generates a bearer
 * token and shows the exact payload to paste instead. The MCP URL is environment-aware. */
function ConnectionGuide({
  mcpBase, token, onGenerate, generating,
}: {
  mcpBase: string;
  token: string | null;
  onGenerate: () => void;
  generating: boolean;
}) {
  const [tab, setTab] = useState<PlatformId>('claude');
  const [reveal, setReveal] = useState(false);

  const p = PLATFORMS.find(x => x.id === tab)!;
  const tok = token || '<your-token>';
  const tokenMasked = token && !reveal ? `${token.slice(0, 6)}${'•'.repeat(20)}` : tok;
  const isPlugin = tab === 'plugin';

  // Default payload — URL only (client does OAuth / browser login).
  const urlOnly = `{
  "mcpServers": {
    "zet": { "url": "${mcpBase}" }
  }
}`;
  // Token fallback payload — what to paste in step 3 instead (or the CLI command for the
  // plugin). Displayed masked until the user reveals; copy always yields the real value.
  const mkPayload = (t: string) => isPlugin
    ? `claude mcp add zet --transport http ${mcpBase} --header "Authorization: Bearer ${t}"`
    : `{
  "mcpServers": {
    "zet": {
      "url": "${mcpBase}",
      "headers": { "Authorization": "Bearer ${t}" }
    }
  }
}`;
  const payloadTok = token && !reveal ? `zet_pat_${'•'.repeat(20)}` : tok;
  const tokenPayload = mkPayload(payloadTok);
  const tokenPayloadReal = mkPayload(tok);

  return (
    <div className="rounded-2xl border border-border/40 bg-gradient-to-b from-card to-muted/10 overflow-hidden shadow-sm">
      {/* Navbar-style, color-coded platform tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto border-b border-border/30 bg-muted/20 px-2 py-2">
        {PLATFORMS.map(x => {
          const Icon = x.icon;
          const active = tab === x.id;
          return (
            <button
              key={x.id}
              type="button"
              onClick={() => { setTab(x.id); setReveal(false); }}
              className={`shrink-0 flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition-all ${
                active ? x.activeTab : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {x.label}
            </button>
          );
        })}
      </div>

      <div className={`p-4 sm:p-5 space-y-5 border-l-2 ${p.edge}`}>
        {/* Header: platform + server */}
        <div className="flex items-center gap-2.5">
          <span className={`h-8 w-8 rounded-xl flex items-center justify-center ${p.soft}`}>
            <p.icon className={`h-4 w-4 ${p.text}`} />
          </span>
          <div className="min-w-0">
            <p className={`text-sm font-bold ${p.text}`}>{p.label}</p>
            <p className="text-[11px] text-muted-foreground/55 font-mono truncate">{mcpBase}</p>
          </div>
        </div>

        {/* Steps */}
        {isPlugin ? (
          <div className="space-y-3.5">
            <Step n={1} title="Open Claude Code" color={p.dot} />
            <Step n={2} title="Add the ZET marketplace" color={p.dot}>
              <CodeBlock code="/plugin marketplace add DRIFTALTECH/zet-TaskManager" />
            </Step>
            <Step n={3} title="Install the plugin" color={p.dot}>
              <CodeBlock code="/plugin install zet@zet-marketplace" />
            </Step>
            <Step n={4} title="Restart Claude Code" color={p.dot}>
              <p className="text-[12px] text-muted-foreground/60">Then run <span className="font-mono text-foreground">/zet:whoami</span> to verify. First use opens a browser login.</p>
            </Step>
          </div>
        ) : (
          <div className="space-y-3.5">
            <Step n={1} title={`Open ${p.label}`} color={p.dot} />
            <Step n={2} title="Open your MCP config file" color={p.dot}>
              <p className="text-[12px] text-muted-foreground/60">{tab === 'claude' ? 'Settings → MCP, or create/edit this file:' : 'Create or edit this file:'}</p>
              <CodeBlock code={p.location} />
            </Step>
            <Step n={3} title="Add this exactly" color={p.dot}>
              <CodeBlock code={urlOnly} />
            </Step>
            <Step n={4} title={`Restart ${p.label}`} color={p.dot}>
              <p className="text-[12px] text-muted-foreground/60">On first use it opens a browser login — sign in to ZET. Done.</p>
            </Step>
          </div>
        )}

        {/* Fallback — token (for orgs that block OAuth / browser login) */}
        <div className={`rounded-2xl border ${p.edge} ${p.soft} p-4 space-y-3`}>
          <div className="flex items-center gap-2">
            <Lock className={`h-4 w-4 ${p.text}`} />
            <p className="text-sm font-bold text-foreground">Can&apos;t use OAuth?</p>
          </div>
          <p className="text-[12px] text-muted-foreground/65 leading-relaxed">
            If your organization blocks browser / OAuth login, generate a token and{' '}
            {isPlugin ? 'run this command instead of step 2' : 'paste this in step 3 instead of the config above'}.
          </p>

          {!token ? (
            <button
              type="button"
              onClick={onGenerate}
              disabled={generating}
              className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-50 ${p.dot}`}
            >
              <Lock className="h-4 w-4" />
              {generating ? 'Generating…' : 'Generate Token'}
            </button>
          ) : (
            <div className="space-y-2.5">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground/55 mb-1.5">Your token</p>
                <div className="flex gap-2">
                  <code className="flex-1 min-w-0 rounded-lg border border-border/50 bg-background px-3 py-2 text-[11px] font-mono truncate">{tokenMasked}</code>
                  <button type="button" onClick={() => setReveal(v => !v)} title={reveal ? 'Hide' : 'Reveal'}
                    className="shrink-0 flex items-center px-2.5 rounded-lg border border-border/50 bg-card hover:bg-muted transition-colors">
                    {reveal ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                  <button type="button" onClick={() => { void navigator.clipboard.writeText(token); }} title="Copy token"
                    className="shrink-0 flex items-center px-2.5 rounded-lg border border-border/50 bg-card hover:bg-muted transition-colors">
                    <Copy className="h-4 w-4" />
                  </button>
                </div>
                <p className="text-[11px] text-muted-foreground/50 mt-1">Shown once — copy it now. Acts on ZET as you; keep it secret.</p>
              </div>
              <CodeBlock caption={isPlugin ? 'run this command' : `paste this in step 3 — ${p.location.trim()}`} code={tokenPayload} copyText={tokenPayloadReal} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const { currentUser, updateProfile, changePassword, toggleTheme, theme, users, mascotsEnabled, toggleMascots } = useAppStore();
  const isManager = currentUser?.role === 'manager' || currentUser?.role === 'admin';

  // Profile state
  const [name, setName] = useState(currentUser?.name ?? '');
  const [avatarPreview, setAvatarPreview] = useState(currentUser?.avatar ?? '');
  const [savingProfile, setSavingProfile] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Password state
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [savingPw, setSavingPw] = useState(false);
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);

  // Audit logs
  const [auditOpen, setAuditOpen] = useState(false);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditSearch, setAuditSearch] = useState('');
  const [auditFilterUser, setAuditFilterUser] = useState('');
  const [auditFilterAction, setAuditFilterAction] = useState('');
  const [auditLimit, setAuditLimit] = useState(200);

  const loadAuditLogs = useCallback(async (l = auditLimit) => {
    setAuditLoading(true);
    try { setAuditLogs(await api.getAuditLogs(l)); }
    catch (e) { console.error(e); }
    finally { setAuditLoading(false); }
  }, [auditLimit]);

  useEffect(() => {
    if (auditOpen) void loadAuditLogs();
  }, [auditOpen]);

  const auditActionTypes = useMemo(() => [...new Set(auditLogs.map(l => l.action))].sort(), [auditLogs]);

  const filteredAuditLogs = useMemo(() => {
    const q = auditSearch.toLowerCase();
    return auditLogs.filter(log => {
      if (auditFilterUser && log.userId !== auditFilterUser) return false;
      if (auditFilterAction && log.action !== auditFilterAction) return false;
      if (q) return log.entityName.toLowerCase().includes(q) || log.userName.toLowerCase().includes(q) || log.action.toLowerCase().includes(q);
      return true;
    });
  }, [auditLogs, auditSearch, auditFilterUser, auditFilterAction]);

  // Developer settings (MCP)
  const [devOn, setDevOn] = useState(false);
  const [mcpToken, setMcpToken] = useState<string | null>(null);
  const [genLoading, setGenLoading] = useState(false);
  const [tokens, setTokens] = useState<PersonalAccessToken[]>([]);
  const [loadingTokens, setLoadingTokens] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);

  const loadTokens = useCallback(async () => {
    setLoadingTokens(true);
    try {
      setTokens(await api.listAccessTokens());
    } catch {
      setTokens([]);
    } finally {
      setLoadingTokens(false);
    }
  }, []);

  useEffect(() => {
    if (devOn) void loadTokens();
  }, [devOn, loadTokens]);

  const generateMcp = async () => {
    setGenLoading(true);
    try {
      const t = await api.createAccessToken('MCP token');
      setMcpToken(t.token);
      void loadTokens();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not generate MCP token');
    } finally {
      setGenLoading(false);
    }
  };

  const revokeToken = async (id: string) => {
    setRevoking(id);
    try {
      await api.revokeAccessToken(id);
      setTokens(ts => ts.filter(t => t.id !== id));
      toast.success('Access revoked');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not revoke');
    } finally {
      setRevoking(null);
    }
  };

  if (!currentUser) return null;

  const profileDirty = name.trim() !== currentUser.name || avatarPreview !== (currentUser.avatar ?? '');

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { toast.error('Image must be under 2 MB'); return; }
    const reader = new FileReader();
    reader.onload = ev => setAvatarPreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  const saveProfile = async () => {
    if (!name.trim()) { toast.error('Name cannot be empty'); return; }
    setSavingProfile(true);
    try {
      await updateProfile(name.trim(), avatarPreview);
      toast.success('Profile updated');
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not save profile'); }
    finally { setSavingProfile(false); }
  };

  const savePassword = async () => {
    if (!currentPw || !newPw) { toast.error('Fill in all password fields'); return; }
    if (newPw !== confirmPw) { toast.error('New passwords do not match'); return; }
    if (newPw.length < 6) { toast.error('Password must be at least 6 characters'); return; }
    setSavingPw(true);
    try {
      await changePassword(currentPw, newPw);
      toast.success('Password changed');
      setCurrentPw(''); setNewPw(''); setConfirmPw('');
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not change password'); }
    finally { setSavingPw(false); }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={pageEnter}
      className="min-h-full"
    >
      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="shrink-0 px-4 sm:px-8 pt-6 sm:pt-7 pb-5 border-b border-border/30 bg-gradient-to-b from-muted/20 to-transparent">
        <div className="flex items-center gap-2 mb-1">
          <Shield className="h-4 w-4 text-primary/60" />
          <span className="text-xs font-bold text-muted-foreground/50 uppercase tracking-widest">Account</span>
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold bg-gradient-to-r from-foreground to-foreground/60 bg-clip-text text-transparent">
          Settings
        </h1>
        <p className="text-sm text-muted-foreground/60 mt-1.5">Manage your profile, appearance and security</p>
      </div>

      {/* ── Scrollable body ──────────────────────────────────────── */}
      <div className="p-4 sm:p-8">
        <div className="space-y-6">

          {/* ── Profile Card ─────────────────────────────────────── */}
          <div className="rounded-2xl border border-border/30 bg-card overflow-hidden">
            <div className="px-6 py-4 border-b border-border/20 bg-muted/10 flex items-center gap-2">
              <User className="h-4 w-4 text-primary/70" />
              <h2 className="text-sm font-bold text-foreground">Profile</h2>
            </div>
            <div className="p-6 space-y-6">

              {/* Avatar upload */}
              <div className="flex items-center gap-6">
                <div className="relative group shrink-0">
                  <UserAvatar name={name || currentUser.name} avatar={avatarPreview} size="2xl" />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="absolute inset-0 rounded-full bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <Camera className="h-6 w-6 text-white" />
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleImageChange}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground mb-0.5">{currentUser.name}</p>
                  <p className="text-xs text-muted-foreground/60 mb-3">Click the avatar to upload a photo. Max 2 MB.</p>
                  {avatarPreview && avatarPreview !== (currentUser.avatar ?? '') && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-emerald-400 flex items-center gap-1 font-semibold">
                        <Check className="h-3 w-3" /> New photo ready
                      </span>
                      <button
                        type="button"
                        onClick={() => setAvatarPreview(currentUser.avatar ?? '')}
                        className="text-xs text-muted-foreground/60 hover:text-foreground transition-colors"
                      >
                        Remove
                      </button>
                    </div>
                  )}
                  {!avatarPreview && (
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="text-xs text-primary hover:text-primary/80 font-semibold transition-colors"
                    >
                      Upload photo
                    </button>
                  )}
                </div>
              </div>

              {/* Name */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-muted-foreground/60 uppercase tracking-wide">Display name</label>
                <input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className={inputCls}
                  placeholder="Your name"
                />
              </div>

              {/* Read-only info */}
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-muted/20 border border-border/30 px-4 py-3">
                  <div className="flex items-center gap-2 text-muted-foreground/50 mb-1">
                    <Mail className="h-3.5 w-3.5" />
                    <span className="text-[10px] font-bold uppercase tracking-wide">Email</span>
                  </div>
                  <p className="text-sm font-medium text-foreground truncate">{currentUser.email}</p>
                </div>
                <div className="rounded-xl bg-muted/20 border border-border/30 px-4 py-3">
                  <div className="flex items-center gap-2 text-muted-foreground/50 mb-1">
                    <Briefcase className="h-3.5 w-3.5" />
                    <span className="text-[10px] font-bold uppercase tracking-wide">Role</span>
                  </div>
                  <p className="text-sm font-medium text-foreground capitalize">{currentUser.role}</p>
                </div>
              </div>

              {/* Save */}
              <div className="flex justify-end">
                <button
                  onClick={() => void saveProfile()}
                  disabled={!profileDirty || savingProfile}
                  className="text-sm px-5 py-2.5 rounded-xl bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-35 transition-all font-semibold shadow-sm hover:shadow-md hover:scale-[1.02] active:scale-[0.98]"
                >
                  {savingProfile ? 'Saving…' : 'Save profile'}
                </button>
              </div>
            </div>
          </div>

          {/* ── Appearance Card ───────────────────────────────────── */}
          <div className="rounded-2xl border border-border/30 bg-card overflow-hidden">
            <div className="px-6 py-4 border-b border-border/20 bg-muted/10 flex items-center gap-2">
              {theme === 'dark' ? <Moon className="h-4 w-4 text-primary/70" /> : <Sun className="h-4 w-4 text-primary/70" />}
              <h2 className="text-sm font-bold text-foreground">Appearance</h2>
            </div>
            <div className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-foreground">Theme</p>
                  <p className="text-xs text-muted-foreground/60 mt-0.5">
                    Currently using <span className="text-foreground font-medium capitalize">{theme}</span> mode
                  </p>
                </div>
                <button
                  onClick={toggleTheme}
                  className={`relative w-[88px] h-10 rounded-xl border flex items-center px-1 transition-all duration-200 ${
                    theme === 'dark'
                      ? 'bg-primary/10 border-primary/30'
                      : 'bg-muted/50 border-border/40'
                  }`}
                >
                  <div className={`absolute flex items-center justify-center w-8 h-8 rounded-lg shadow-sm transition-all duration-200 ${
                    theme === 'dark'
                      ? 'translate-x-[46px] bg-primary text-primary-foreground'
                      : 'translate-x-0 bg-card text-foreground border border-border/40'
                  }`}>
                    {theme === 'dark' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
                  </div>
                  <span className={`text-[11px] font-bold transition-all duration-200 ml-1 ${theme === 'dark' ? 'text-muted-foreground/50' : 'ml-10 text-muted-foreground/50'}`}>
                    {theme === 'dark' ? 'Dark' : 'Light'}
                  </span>
                </button>
              </div>

              {/* Agent mascots toggle */}
              <div className="mt-5 pt-5 border-t border-border/20 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex -space-x-2 shrink-0">
                    <AgentAvatar agent="zani" size={26} still />
                    <AgentAvatar agent="tasker" size={26} still />
                    <AgentAvatar agent="pilot" size={26} still />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground">Agent mascots</p>
                    <p className="text-xs text-muted-foreground/60 mt-0.5">
                      Animated helpers that react to your work. Respects “reduce motion”.
                    </p>
                  </div>
                </div>
                <button
                  role="switch"
                  aria-checked={mascotsEnabled}
                  onClick={toggleMascots}
                  className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40 ${mascotsEnabled ? 'bg-primary' : 'bg-muted-foreground/25'}`}
                >
                  <span className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${mascotsEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
              </div>
            </div>
          </div>

          {/* ── Password Card ─────────────────────────────────────── */}
          <div className="rounded-2xl border border-border/30 bg-card overflow-hidden">
            <div className="px-6 py-4 border-b border-border/20 bg-muted/10 flex items-center gap-2">
              <Lock className="h-4 w-4 text-primary/70" />
              <h2 className="text-sm font-bold text-foreground">Change password</h2>
            </div>
            <div className="p-6 space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-muted-foreground/60 uppercase tracking-wide">Current password</label>
                <div className="relative">
                  <input
                    type={showCurrent ? 'text' : 'password'}
                    value={currentPw}
                    onChange={e => setCurrentPw(e.target.value)}
                    className={`${inputCls} pr-10`}
                    placeholder="Current password"
                    disabled={savingPw}
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrent(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-foreground transition-colors"
                  >
                    {showCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-muted-foreground/60 uppercase tracking-wide">New password</label>
                  <div className="relative">
                    <input
                      type={showNew ? 'text' : 'password'}
                      value={newPw}
                      onChange={e => setNewPw(e.target.value)}
                      className={`${inputCls} pr-10`}
                      placeholder="New password"
                      disabled={savingPw}
                    />
                    <button
                      type="button"
                      onClick={() => setShowNew(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-foreground transition-colors"
                    >
                      {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-muted-foreground/60 uppercase tracking-wide">Confirm new</label>
                  <input
                    type="password"
                    value={confirmPw}
                    onChange={e => setConfirmPw(e.target.value)}
                    className={`${inputCls} ${confirmPw && confirmPw !== newPw ? 'border-red-500/50 focus:ring-red-500/40' : ''}`}
                    placeholder="Confirm password"
                    disabled={savingPw}
                  />
                  {confirmPw && confirmPw !== newPw && (
                    <p className="text-xs text-red-400">Passwords do not match</p>
                  )}
                </div>
              </div>

              <div className="flex justify-end pt-1">
                <button
                  onClick={() => void savePassword()}
                  disabled={!currentPw || !newPw || !confirmPw || savingPw}
                  className="text-sm px-5 py-2.5 rounded-xl bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-35 transition-all font-semibold shadow-sm hover:shadow-md hover:scale-[1.02] active:scale-[0.98]"
                >
                  {savingPw ? 'Saving…' : 'Change password'}
                </button>
              </div>
            </div>
          </div>

          {/* ── Developer Settings (MCP) ──────────────────────────── */}
          <div className="rounded-2xl border border-border/30 bg-card overflow-hidden">
            <div className="px-6 py-4 border-b border-border/20 bg-muted/10 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Terminal className="h-4 w-4 text-primary/70" />
                <h2 className="text-sm font-bold text-foreground">Developer settings</h2>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-500 border border-amber-500/25 font-bold uppercase tracking-wide">Beta</span>
              </div>
              <button
                role="switch"
                aria-checked={devOn}
                onClick={() => setDevOn(v => !v)}
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40 ${devOn ? 'bg-primary' : 'bg-muted-foreground/25'}`}
              >
                <span className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${devOn ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>

            {devOn && (
              <div className="p-6 space-y-4">
                <div className="flex items-start gap-2 text-xs text-amber-500 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2.5">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <span>These settings are still in development and may not work accurately yet. Use at your own discretion.</span>
                </div>

                <p className="text-sm text-muted-foreground/75 leading-relaxed">
                  Connect ZET to Claude Code, Cursor, VS Code, or the plugin. Pick your platform,
                  then sign in with <span className="font-semibold">Microsoft</span> or use a <span className="font-semibold">bearer token</span>.
                </p>

                {/* Color-coded, per-platform connection guide */}
                <ConnectionGuide
                  mcpBase={MCP_BASE}
                  token={mcpToken}
                  onGenerate={() => void generateMcp()}
                  generating={genLoading}
                />

                {/* Connected apps & tokens — revoke access here */}
                <div className="space-y-2 pt-1">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-muted-foreground/60 uppercase tracking-wide flex items-center gap-1.5">
                      <Plug className="h-3.5 w-3.5" /> Connected apps &amp; tokens
                    </label>
                    <button onClick={() => void loadTokens()} className="text-[11px] text-muted-foreground/45 hover:text-foreground transition-colors">
                      Refresh
                    </button>
                  </div>

                  {loadingTokens ? (
                    <p className="text-xs text-muted-foreground/40 py-2">Loading…</p>
                  ) : tokens.length === 0 ? (
                    <p className="text-xs text-muted-foreground/40 py-3 text-center rounded-xl border border-dashed border-border/40">
                      No active connections yet. Connect a client with the URL above, or generate a token below.
                    </p>
                  ) : (
                    <div className="space-y-1.5">
                      {tokens.map(t => (
                        <div key={t.id} className="flex items-center gap-3 rounded-xl border border-border/40 bg-muted/20 px-3 py-2.5">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold text-foreground truncate">{t.name}</p>
                            <p className="text-[11px] text-muted-foreground/45 font-mono truncate">
                              {t.prefix}… · {t.lastUsedAt ? `last used ${fmtDate(t.lastUsedAt)}` : `created ${fmtDate(t.createdAt)}`}
                            </p>
                          </div>
                          <button
                            onClick={() => void revokeToken(t.id)}
                            disabled={revoking === t.id}
                            className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-red-500/30 text-red-400 text-xs font-semibold hover:bg-red-500/10 transition-colors disabled:opacity-50"
                          >
                            <Trash2 className="h-3.5 w-3.5" /> {revoking === t.id ? 'Revoking…' : 'Revoke'}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <p className="text-[11px] text-muted-foreground/40">
                    Revoking immediately disconnects that app — it will have to log in again.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* ── Audit Logs ───────────────────────────────────────── */}
          <div className="rounded-2xl border border-border/30 bg-card overflow-hidden">
            <div className="px-6 py-4 border-b border-border/20 bg-muted/10 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-primary/70" />
                <h2 className="text-sm font-bold text-foreground">Audit Logs</h2>
                <span className="text-[10px] text-muted-foreground/40">
                  {isManager ? 'Team activity' : 'My activity'}
                </span>
              </div>
              <button
                role="switch"
                aria-checked={auditOpen}
                onClick={() => setAuditOpen(v => !v)}
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40 ${auditOpen ? 'bg-primary' : 'bg-muted-foreground/25'}`}
              >
                <span className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${auditOpen ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>

            {auditOpen && (
              <div className="p-4 space-y-3">
                {/* Filters */}
                <div className="flex flex-wrap items-center gap-2">
                  {/* Search */}
                  <div className="flex items-center gap-2 bg-muted/40 border border-border/40 rounded-xl px-3 py-2 flex-1 min-w-[160px]">
                    <Search className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
                    <input
                      value={auditSearch}
                      onChange={e => setAuditSearch(e.target.value)}
                      placeholder="Search actions, names…"
                      className="bg-transparent text-sm focus:outline-none flex-1 placeholder:text-muted-foreground/40"
                    />
                    {auditSearch && (
                      <button onClick={() => setAuditSearch('')} className="text-muted-foreground/50 hover:text-foreground transition-colors">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>

                  {/* User filter (manager only) */}
                  {isManager && (
                    <div className="relative">
                      <select
                        value={auditFilterUser}
                        onChange={e => setAuditFilterUser(e.target.value)}
                        className="appearance-none pl-3 pr-8 py-2 rounded-xl border border-border/40 bg-muted/40 text-sm focus:outline-none text-foreground/80 cursor-pointer hover:bg-muted/60"
                      >
                        <option value="">All People</option>
                        {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                      </select>
                      <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50 pointer-events-none" />
                    </div>
                  )}

                  {/* Action filter */}
                  <div className="relative">
                    <select
                      value={auditFilterAction}
                      onChange={e => setAuditFilterAction(e.target.value)}
                      className="appearance-none pl-3 pr-8 py-2 rounded-xl border border-border/40 bg-muted/40 text-sm focus:outline-none text-foreground/80 cursor-pointer hover:bg-muted/60"
                    >
                      <option value="">All Actions</option>
                      {auditActionTypes.map(a => (
                        <option key={a} value={a}>{ACTION_LABELS[a]?.label ?? a}</option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50 pointer-events-none" />
                  </div>

                  <div className="flex items-center gap-2 ml-auto">
                    <span className="text-xs px-2.5 py-1.5 rounded-xl bg-muted/60 border border-border/40 text-muted-foreground font-medium">
                      {filteredAuditLogs.length} {filteredAuditLogs.length === 1 ? 'entry' : 'entries'}
                    </span>
                    <button
                      onClick={() => void loadAuditLogs()}
                      disabled={auditLoading}
                      className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl border border-border/40 bg-muted/30 hover:bg-muted/60 text-muted-foreground transition-all"
                    >
                      <RefreshCw className={`h-3 w-3 ${auditLoading ? 'animate-spin' : ''}`} />
                      Refresh
                    </button>
                  </div>
                </div>

                {/* Log list */}
                <div className="rounded-xl border border-border/30 overflow-hidden max-h-[480px] overflow-y-auto">
                  {auditLoading ? (
                    <div className="flex items-center justify-center py-12 gap-2 text-sm text-muted-foreground">
                      <div className="w-5 h-5 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
                      Loading…
                    </div>
                  ) : filteredAuditLogs.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                      <ShieldCheck className="h-8 w-8 text-muted-foreground/20 mb-2" />
                      <p className="text-sm text-muted-foreground/50">
                        {auditSearch || auditFilterUser || auditFilterAction ? 'No matching entries' : 'No activity yet'}
                      </p>
                    </div>
                  ) : (
                    <div className="divide-y divide-border/20">
                      {filteredAuditLogs.map(log => {
                        const actor = isManager ? users.find(u => u.id === log.userId) : currentUser;
                        const badge = ACTION_LABELS[log.action];
                        return (
                          <div
                            key={log.id}
                            className="flex items-center gap-3 px-4 py-3 hover:bg-muted/20 transition-colors group"
                          >
                            <div className="shrink-0">
                              <UserAvatar name={actor?.name ?? log.userName} avatar={actor?.avatar} size="sm" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-semibold text-foreground">{log.userName}</span>
                                <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold border ${badge?.color ?? 'bg-muted/60 text-muted-foreground border-border/40'}`}>
                                  {badge?.label ?? log.action}
                                </span>
                              </div>
                              {log.entityName && (
                                <p className="text-xs text-muted-foreground/60 truncate mt-0.5">
                                  <span className="text-muted-foreground/40 capitalize">{log.entityType}</span>
                                  {' · '}
                                  <span className="text-foreground/60">{log.entityName}</span>
                                  {log.details.status && (
                                    <span className="ml-1 text-muted-foreground/40">→ {String(log.details.status)}</span>
                                  )}
                                </p>
                              )}
                            </div>
                            <div className="shrink-0 text-right">
                              <p className="text-xs text-muted-foreground/50 font-mono tabular-nums">{timeAgo(log.createdAt)}</p>
                              <p className="text-[10px] text-muted-foreground/30 mt-0.5 hidden group-hover:block">{fmtAuditDate(log.createdAt)}</p>
                            </div>
                          </div>
                        );
                      })}

                      {auditLogs.length >= auditLimit && (
                        <div className="px-4 py-4 text-center">
                          <button
                            onClick={() => { const nl = auditLimit + 200; setAuditLimit(nl); void loadAuditLogs(nl); }}
                            className="text-sm text-primary/60 hover:text-primary font-medium transition-colors"
                          >
                            Load more…
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

        </div>
      </div>
    </motion.div>
  );
}
