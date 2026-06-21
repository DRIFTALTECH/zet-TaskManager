import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate, useNavigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAppStore } from "@/stores/appStore";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { consumePendingMicrosoftAuth } from "@/lib/microsoftAuth";
import { adminApi } from "@/lib/adminApi";
import LoginPage from "./pages/LoginPage";
import SignUpPage from "./pages/SignUpPage";
import DashboardPage from "./pages/DashboardPage";
import MyTasksPage from "./pages/MyTasksPage";
import TimesheetPage from "./pages/TimesheetPage";
import CalendarPage from "./pages/CalendarPage";
import TimeReportPage from "./pages/TimeReportPage";
import UsersPage from "./pages/UsersPage";
import UserDetailPage from "./pages/UserDetailPage";
import ManageProjectsOverview from "./pages/ManageProjectsOverview";
import ProjectDetailPage from "./pages/ProjectDetailPage";
import SettingsPage from "./pages/SettingsPage";
import AppSidebar from "./components/AppSidebar";
import AppNavbar from "./components/AppNavbar";
import AIPage from "./pages/AIPage";
import MeetingNotesPage from "./pages/MeetingNotesPage";
import AdminLoginPage from "./pages/AdminLoginPage";
import AdminPage from "./pages/AdminPage";
import { useLiveSync } from "./hooks/useTaskSync";

const queryClient = new QueryClient();

function AppLayout({ children }: { children: React.ReactNode }) {
  useLiveSync(); // live updates (tasks, projects, users) via smart polling
  return (
    <div className="flex min-h-screen w-full">
      <AppSidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <AppNavbar />
        <main className="flex-1 min-w-0 overflow-auto">{children}</main>
      </div>
    </div>
  );
}

function ProtectedRoute({ children, managerOnly }: { children: React.ReactNode; managerOnly?: boolean }) {
  const currentUser = useAppStore(s => s.currentUser);
  if (!currentUser) return <Navigate to="/login" />;
  if (managerOnly && currentUser.role !== 'manager' && currentUser.role !== 'admin') return <Navigate to="/" />;
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
      <div className="min-h-screen flex items-center justify-center bg-background text-muted-foreground text-sm">
        Loading…
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
        if (pending.flow === 'admin') {
          await adminApi.loginMicrosoft(pending.idToken);
          toast.success('Welcome, admin');
          navigate("/admin", { replace: true });
          return;
        }
        if (pending.flow === 'signup') {
          const user = await loginWithMicrosoft(pending.idToken, false, pending.role ?? undefined, pending.jobTitle, pending.experienceMonths);
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
        const msg = e instanceof Error ? e.message : "";
        // Backend returns "no_account" when a new Microsoft email hits the login flow.
        // Redirect to /signup so the user can choose their role.
        if (msg.includes("no_account")) {
          toast.info("No account found. Please sign up and choose your role.");
          navigate("/signup", { replace: true });
          return;
        }
        toast.error(msg || "Microsoft sign-in failed.");
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
          <Route path="/calendar" element={<ProtectedRoute><CalendarPage /></ProtectedRoute>} />
          <Route path="/meeting-notes" element={<ProtectedRoute><MeetingNotesPage /></ProtectedRoute>} />
          <Route path="/reports" element={<ProtectedRoute><TimeReportPage /></ProtectedRoute>} />
          <Route path="/users" element={<ProtectedRoute managerOnly><UsersPage /></ProtectedRoute>} />
          <Route path="/users/:userId" element={<ProtectedRoute managerOnly><UserDetailPage /></ProtectedRoute>} />
          <Route path="/manage" element={<ProtectedRoute managerOnly><ManageProjectsOverview /></ProtectedRoute>} />
          <Route path="/manage/:projectId" element={<ProtectedRoute managerOnly><ProjectDetailPage /></ProtectedRoute>} />
          <Route path="/settings" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
          <Route path="/ai" element={<ProtectedRoute><AIPage /></ProtectedRoute>} />
          <Route path="/admin/login" element={<AdminLoginPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </BrowserRouter>
      </BootstrapGate>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
