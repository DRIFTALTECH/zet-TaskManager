import { useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { useAppStore } from '@/stores/appStore';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { Lock, Mail, ArrowRight } from 'lucide-react';

const LoginPage = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const login = useAppStore(s => s.login);
  const currentUser = useAppStore(s => s.currentUser);
  const navigate = useNavigate();

  // Already logged in — redirect to dashboard
  if (currentUser) return <Navigate to="/" replace />;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const user = login(email, password);
    if (user) {
      toast.success(`Welcome back, ${user.name}!`);
      navigate('/', { replace: true });
    } else {
      toast.error('Invalid credentials');
    }
  };

  const quickLogin = (em: string) => {
    setEmail(em);
    setPassword('demo123');
    const user = login(em, 'demo123');
    if (user) {
      toast.success(`Welcome back, ${user.name}!`);
      navigate('/', { replace: true });
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md"
      >
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/10 mb-4">
            <span className="text-2xl font-bold text-primary">T</span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight">TaskFlow</h1>
          <p className="text-muted-foreground mt-2">Sign in to your workspace</p>
        </div>

        <div className="rounded-2xl border bg-card p-6 shadow-lg">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  type="email" value={email} onChange={e => setEmail(e.target.value)}
                  className="w-full rounded-xl border bg-muted/50 px-10 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                  placeholder="you@company.com"
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  type="password" value={password} onChange={e => setPassword(e.target.value)}
                  className="w-full rounded-xl border bg-muted/50 px-10 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                  placeholder="••••••••"
                />
              </div>
            </div>
            <button
              type="submit"
              className="w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
            >
              Sign In <ArrowRight className="h-4 w-4" />
            </button>
          </form>
        </div>

        <div className="mt-6 rounded-2xl border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground mb-3">Quick demo access</p>
          <div className="space-y-2">
            {[
              { label: 'Manager', email: 'manager@demo.com', badge: 'bg-primary/20 text-primary' },
              { label: 'Jordan (Employee)', email: 'jordan@demo.com', badge: 'bg-secondary/20 text-secondary' },
              { label: 'Sam (Employee)', email: 'sam@demo.com', badge: 'bg-secondary/20 text-secondary' },
            ].map(d => (
              <button key={d.email} onClick={() => quickLogin(d.email)}
                className="w-full flex items-center justify-between rounded-xl border px-4 py-2.5 text-sm hover:bg-muted/50 transition-colors"
              >
                <span>{d.label}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full ${d.badge}`}>{d.email}</span>
              </button>
            ))}
          </div>
        </div>
      </motion.div>
    </div>
  );
};

export default LoginPage;
