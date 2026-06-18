import { useState, useEffect } from 'react';
import { useAppStore } from '@/stores/appStore';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Sun, Moon } from 'lucide-react';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const SettingsModal = ({ open, onOpenChange }: Props) => {
  const { currentUser, updateProfile, changePassword, theme, toggleTheme } = useAppStore();
  const [name, setName] = useState(currentUser?.name || '');
  const [avatar, setAvatar] = useState(currentUser?.avatar || '');
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');

  useEffect(() => {
    if (open && currentUser) {
      setName(currentUser.name);
      setAvatar(currentUser.avatar);
    }
  }, [open, currentUser]);

  const handleSave = async () => {
    if (!name.trim()) return toast.error('Enter your name');
    try {
      await updateProfile(name.trim(), avatar);
      toast.success('Profile updated!');
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update profile');
    }
  };

  const handlePasswordChange = async () => {
    if (!currentPw || !newPw) return toast.error('Fill in all password fields');
    if (newPw !== confirmPw) return toast.error('Passwords do not match');
    if (newPw.length < 6) return toast.error('Password must be at least 6 characters');
    try {
      await changePassword(currentPw, newPw);
      toast.success('Password updated!');
      setCurrentPw('');
      setNewPw('');
      setConfirmPw('');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update password');
    }
  };

  const emojis = ['👨‍💼', '👩‍💻', '👨‍🔬', '👩‍🎨', '🧑‍🚀', '🦊', '🐱', '🌟'];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass">
        <DialogHeader><DialogTitle>Settings</DialogTitle></DialogHeader>
        <div className="space-y-6">
          {/* Profile */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold">Profile</h3>
            <div className="flex gap-2 flex-wrap">
              {emojis.map(e => (
                <button key={e} onClick={() => setAvatar(e)}
                  className={`w-10 h-10 rounded-xl text-xl flex items-center justify-center border transition-colors ${avatar === e ? 'border-primary bg-primary/10' : 'hover:bg-muted/50'}`}
                >{e}</button>
              ))}
            </div>
            <input value={name} onChange={e => setName(e.target.value)}
              className="w-full rounded-xl border bg-muted/50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              placeholder="Full name"
            />
          </div>

          {/* Appearance */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold">Appearance</h3>
            <button onClick={toggleTheme}
              className="flex items-center gap-3 w-full rounded-xl border px-4 py-3 hover:bg-muted/50 transition-colors"
            >
              {theme === 'dark' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
              <span className="text-sm">{theme === 'dark' ? 'Dark' : 'Light'} Mode</span>
              <span className="ml-auto text-xs text-muted-foreground">Click to toggle</span>
            </button>
          </div>

          {/* Password */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold">Change Password</h3>
            <input type="password" value={currentPw} onChange={e => setCurrentPw(e.target.value)}
              className="w-full rounded-xl border bg-muted/50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              placeholder="Current password"
            />
            <input type="password" value={newPw} onChange={e => setNewPw(e.target.value)}
              className="w-full rounded-xl border bg-muted/50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              placeholder="New password"
            />
            <input type="password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)}
              className="w-full rounded-xl border bg-muted/50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              placeholder="Confirm new password"
            />
            <button onClick={handlePasswordChange}
              className="text-sm px-4 py-2 rounded-xl border hover:bg-muted/50 transition-colors"
            >Update Password</button>
          </div>

          <button onClick={handleSave}
            className="w-full rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity"
          >Save Changes</button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default SettingsModal;
