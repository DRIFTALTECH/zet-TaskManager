import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate, useNavigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAppStore } from "@/stores/appStore";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { consumePendingMicrosoftAuth } from "@/lib/microsoftAuth";
import LoginPage from "./pages/LoginPage";
import SignUpPage from "./pages/SignUpPage";
import DashboardPage from "./pages/DashboardPage";
import MyTasksPage from "./pages/MyTasksPage";
import TimesheetPage from "./pages/TimesheetPage";
import TimeReportPage from "./pages/TimeReportPage";
import UsersPage from "./pages/UsersPage";
import UserDetailPage from "./pages/UserDetailPage";
import ManageEmployeesPage from "./pages/ManageEmployeesPage";
import SettingsPage from "./pages/SettingsPage";
import AuditPage from "./pages/AuditPage";
import AppSidebar from "./components/AppSidebar";
import AppNavbar from "./components/AppNavbar";

const queryClient = new QueryClient();

function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen w-full">
      <div className="aurora-layer" aria-hidden />
      <AppSidebar />
      <div className="flex-1 flex flex-col min-w-0 relative z-10">
        <AppNavbar />
        <main className="flex-1 min-w-0 overflow-auto">{children}</main>
      </div>
    </div>
  );
}

function ProtectedRoute({ children, managerOnly }: { children: React.ReactNode; managerOnly?: boolean }) {
  const currentUser = useAppStore(s => s.currentUser);
  if (!currentUser) return <Navigate to="/login" />;
  if (managerOnly && currentUser.role !== 'manager') return <Navigate to="/" />;
  return <AppLayout>{children}</AppLayout>;
}

function ThemeHandler() {
  const theme = useAppStore(s => s.theme);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);
  return null;
}

function BootstrapGate({ children }: { children: React.ReactNode }) {
  const hydrated = useAppStore(s => s.hydrated);
  const bootstrap = useAppStore(s => s.bootstrap);
  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);
  if (!hydrated) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-background">
        <div className="aurora-layer" aria-hidden />
        <div className="relative z-10 flex flex-col items-center gap-4 animate-fade-in">
          <div className="h-12 w-12 rounded-2xl bg-brand-gradient glow-brand animate-pulse" />
          <p className="text-sm font-medium text-muted-foreground tracking-wide">Warming up ZET…</p>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

/** Finish Microsoft redirect login after MSAL consumed the URL hash in `main.tsx` (sessionStorage pending). */
function MsalRedirectResume() {
  const loginWithMicrosoft = useAppStore(s => s.loginWithMicrosoft);
  const navigate = useNavigate();
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    const pending = consumePendingMicrosoftAuth();
    if (!pending) return;
    ran.current = true;
    void (async () => {
      try {
        if (pending.flow === 'signup') {
          const user = await loginWithMicrosoft(pending.idToken, false, pending.role ?? undefined);
          if (user) {
            toast.success(`Welcome to ZET, ${user.name}!`);
            navigate("/", { replace: true });
          }
        } else {
          const user = await loginWithMicrosoft(pending.idToken, pending.rememberMe);
          if (user) {
            toast.success(`Welcome back, ${user.name}!`);
            navigate("/", { replace: true });
          }
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Microsoft sign-in failed.");
      }
    })();
  }, [loginWithMicrosoft, navigate]);
  return null;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Sonner />
      <ThemeHandler />
      <BootstrapGate>
      <BrowserRouter>
        <MsalRedirectResume />
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignUpPage />} />
          <Route path="/" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
          <Route path="/tasks" element={<ProtectedRoute><MyTasksPage /></ProtectedRoute>} />
          <Route path="/timesheet" element={<ProtectedRoute><TimesheetPage /></ProtectedRoute>} />
          <Route path="/reports" element={<ProtectedRoute><TimeReportPage /></ProtectedRoute>} />
          <Route path="/users" element={<ProtectedRoute managerOnly><UsersPage /></ProtectedRoute>} />
          <Route path="/users/:userId" element={<ProtectedRoute managerOnly><UserDetailPage /></ProtectedRoute>} />
          <Route path="/manage" element={<ProtectedRoute managerOnly><ManageEmployeesPage /></ProtectedRoute>} />
          <Route path="/settings" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
          <Route path="/audit" element={<ProtectedRoute><AuditPage /></ProtectedRoute>} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </BrowserRouter>
      </BootstrapGate>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
