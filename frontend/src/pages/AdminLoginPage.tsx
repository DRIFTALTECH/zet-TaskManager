import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { adminApi, getAdminToken } from '@/lib/adminApi';
import {
  formatMsalAuthError,
  isMicrosoftAuthConfigured,
  signInWithMicrosoftAdminRedirect,
} from '@/lib/microsoftAuth';

const AdminLoginPage = () => {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  // Already signed in as admin → straight to the console.
  if (getAdminToken()) {
    navigate('/admin', { replace: true });
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) return;
    setLoading(true);
    try {
      await adminApi.login(username.trim(), password);
      toast.success('Welcome, admin');
      navigate('/admin', { replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-8 shadow-xl">
        <div className="flex flex-col items-center text-center mb-6">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-400 mb-3">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">Admin Console</h1>
          <p className="text-sm text-muted-foreground mt-1">Sign in to manage user accounts</p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="admin-username">Username or email</Label>
            <Input
              id="admin-username"
              autoComplete="username"
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="admin or you@company.com"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="admin-password">Password</Label>
            <Input
              id="admin-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>

        {isMicrosoftAuthConfigured() && (
          <>
            <div className="flex items-center gap-3 my-4">
              <div className="h-px flex-1 bg-border" />
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground/50">or</span>
              <div className="h-px flex-1 bg-border" />
            </div>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              disabled={loading}
              onClick={async () => {
                try {
                  await signInWithMicrosoftAdminRedirect();
                } catch (e) {
                  const msg = formatMsalAuthError(e);
                  if (msg) toast.error(msg);
                }
              }}
            >
              Sign in with Microsoft
            </Button>
            <p className="text-[11px] text-muted-foreground/50 text-center mt-3">
              Microsoft sign-in works only for accounts with the admin role.
            </p>
          </>
        )}
      </div>
    </div>
  );
};

export default AdminLoginPage;
