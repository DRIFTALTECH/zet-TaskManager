import { useAppStore } from '@/stores/appStore';
import { motion } from 'framer-motion';
import { useState, useRef, useEffect, useCallback } from 'react';
import {
  User, Lock, Sun, Moon, Camera, Check, Eye, EyeOff,
  Shield, Mail, Briefcase, Terminal, Copy, AlertTriangle, Trash2, Plug,
} from 'lucide-react';
import { toast } from 'sonner';
import { pageEnter } from '@/lib/motion';
import { api } from '@/lib/api';
import type { PersonalAccessToken } from '@/types';
import UserAvatar from '@/components/UserAvatar';

const inputCls = 'w-full rounded-xl border border-border/50 bg-muted/40 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/20 transition-all placeholder:text-muted-foreground/40';

/** The MCP endpoint is embedded in the backend at /mcp; override with VITE_MCP_URL. */
const MCP_BASE = (import.meta.env.VITE_MCP_URL as string | undefined)
  || `${(import.meta.env.VITE_API_URL as string | undefined) || 'http://127.0.0.1:8000'}/mcp/`;

function fmtDate(iso: string): string {
  if (!iso) return '';
  try { return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return iso; }
}

export default function SettingsPage() {
  const { currentUser, updateProfile, changePassword, toggleTheme, theme } = useAppStore();

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

  // Developer settings (MCP)
  const [devOn, setDevOn] = useState(false);
  const [mcpToken, setMcpToken] = useState<string | null>(null);
  const [showToken, setShowToken] = useState(false);
  const [genLoading, setGenLoading] = useState(false);
  const [copiedField, setCopiedField] = useState<'url' | 'token' | null>(null);
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
      setShowToken(false);
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

  const copyField = async (text: string, which: 'url' | 'token') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(which);
      setTimeout(() => setCopiedField(c => (c === which ? null : c)), 1500);
    } catch {
      toast.error('Could not copy');
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
      className="flex flex-col h-[calc(100dvh-3.5rem)] min-h-0"
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
      <div className="flex-1 overflow-y-auto min-h-0 p-4 sm:p-8">
        <div className="max-w-2xl mx-auto space-y-6">

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
                  Connect ZET to Claude, Cursor, or any MCP client. Just give it the URL below —
                  your client will open ZET in the browser and ask you to <span className="font-semibold">log in</span>.
                  No token to copy or paste.
                </p>

                {/* MCP URL — the only thing the user needs; auth happens via browser login */}
                <div className="space-y-2">
                  <label className="text-xs font-bold text-muted-foreground/60 uppercase tracking-wide">MCP URL</label>
                  <div className="flex gap-2">
                    <input
                      readOnly
                      value={MCP_BASE}
                      onFocus={e => e.currentTarget.select()}
                      className={`${inputCls} font-mono text-xs`}
                    />
                    <button
                      onClick={() => void copyField(MCP_BASE, 'url')}
                      className="shrink-0 flex items-center gap-1.5 px-3 rounded-xl border border-border/60 bg-muted/40 text-sm font-semibold hover:bg-muted/70 transition-colors"
                    >
                      {copiedField === 'url' ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
                      {copiedField === 'url' ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                  <p className="text-[11px] text-muted-foreground/45">
                    Uses OAuth — the client registers itself and you sign in to ZET in your browser.
                  </p>
                </div>

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

                <div className="pt-1">
                  <p className="text-xs font-bold text-muted-foreground/50 uppercase tracking-wide mb-2">Advanced — manual token</p>
                  <p className="text-[11px] text-muted-foreground/45 mb-2">
                    For clients that don't support OAuth: generate a token and add it as an
                    <span className="font-mono"> Authorization: Bearer</span> header. Acts on ZET as you — keep it secret.
                  </p>
                  <button
                    onClick={() => void generateMcp()}
                    disabled={genLoading}
                    className="flex items-center gap-2 text-sm px-4 py-2 rounded-xl border border-border/60 bg-muted/40 hover:bg-muted/70 disabled:opacity-40 transition-all font-semibold"
                  >
                    <Terminal className="h-4 w-4" />
                    {genLoading ? 'Generating…' : mcpToken ? 'Generate new token' : 'Generate access token'}
                  </button>
                </div>

                {mcpToken && (
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-muted-foreground/60 uppercase tracking-wide">Access token</label>
                    <div className="flex gap-2">
                      <input
                        readOnly
                        type={showToken ? 'text' : 'password'}
                        value={mcpToken}
                        onFocus={e => e.currentTarget.select()}
                        className={`${inputCls} font-mono text-xs`}
                      />
                      <button
                        onClick={() => setShowToken(v => !v)}
                        title={showToken ? 'Hide' : 'Reveal'}
                        className="shrink-0 flex items-center px-3 rounded-xl border border-border/60 bg-muted/40 hover:bg-muted/70 transition-colors"
                      >
                        {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                      <button
                        onClick={() => void copyField(mcpToken, 'token')}
                        className="shrink-0 flex items-center gap-1.5 px-3 rounded-xl border border-border/60 bg-muted/40 text-sm font-semibold hover:bg-muted/70 transition-colors"
                      >
                        {copiedField === 'token' ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
                        {copiedField === 'token' ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                    <p className="text-[11px] text-muted-foreground/45">
                      Add this as a <span className="font-mono">Bearer</span> token / Authorization header in your MCP client — keep it out of the URL. Shown once; copy it now.
                    </p>
                    <div className="rounded-lg border border-border/40 bg-muted/20 p-3">
                      <p className="text-[10px] font-bold text-muted-foreground/50 uppercase tracking-wide mb-1.5">Example client config</p>
                      <pre className="text-[11px] font-mono text-muted-foreground/80 overflow-x-auto whitespace-pre">{`{
  "url": "${MCP_BASE}",
  "headers": { "Authorization": "Bearer ${showToken ? mcpToken : '<your-token>'}" }
}`}</pre>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

        </div>
      </div>
    </motion.div>
  );
}
