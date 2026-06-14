import { useAppStore } from '@/stores/appStore';
import { motion } from 'framer-motion';
import { useState, useRef } from 'react';
import {
  User, Lock, Sun, Moon, Camera, Check, Eye, EyeOff,
  Shield, Mail, Briefcase,
} from 'lucide-react';
import { toast } from 'sonner';
import { pageEnter } from '@/lib/motion';
import UserAvatar from '@/components/UserAvatar';

const inputCls = 'w-full rounded-xl border border-border/50 bg-muted/40 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/20 transition-all placeholder:text-muted-foreground/40';

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

        </div>
      </div>
    </motion.div>
  );
}
