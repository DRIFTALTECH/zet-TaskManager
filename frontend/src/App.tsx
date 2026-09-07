import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate, useLocation, useNavigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAppStore } from "@/stores/appStore";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { consumePendingMicrosoftAuth, hasPendingMicrosoftAuth } from "@/lib/microsoftAuth";
import { getStoredToken } from "@/lib/api";
import LoginPage from "./pages/LoginPage";
import SignUpPage from "./pages/SignUpPage";
import AppSidebar from "./components/AppSidebar";
import MobileNav from "./components/MobileNav";
import ErrorBoundary from "./components/ErrorBoundary";

// Route-level code splitting: each authenticated page is its own chunk, so a
// first visit downloads the shell plus one page instead of the whole app.
const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const TimesheetPage = lazy(() => import("./pages/TimesheetPage"));
const CalendarPage = lazy(() => import("./pages/CalendarPage"));
const TimeReportPage = lazy(() => import("./pages/TimeReportPage"));
const UsersPage = lazy(() => import("./pages/UsersPage"));
const UserDetailPage = lazy(() => import("./pages/UserDetailPage"));
const WhatWillHappenNextPage = lazy(() => import("./pages/WhatWillHappenNextPage"));
const ManageProjectsOverview = lazy(() => import("./pages/ManageProjectsOverview"));
const ProjectDetailPage = lazy(() => import("./pages/ProjectDetailPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const AIPage = lazy(() => import("./pages/AIPage"));
const MeetingNotesPage = lazy(() => import("./pages/MeetingNotesPage"));
const SuperAdminPage = lazy(() => import("./pages/SuperAdminPage"));
const PromptsPage = lazy(() => import("./pages/PromptsPage"));
const OverviewPage = lazy(() => import("./pages/OverviewPage"));
const ClientDetailPage = lazy(() => import("./pages/ClientDetailPage"));
const DashboardPanArea = lazy(() =>
  import("./components/analytics/DashboardPanArea").then(m => ({ default: m.DashboardPanArea })),
);
import { useLiveSync } from "./hooks/useTaskSync";
import Companion from "./components/agents/Companion";
import { ActualHoursDialogHost } from "./components/ActualHoursDialog";
import { ConfirmDialogHost } from "./components/ConfirmDialog";
import { MascotWait } from "./components/auth/MascotWait";
import { queryClient } from "./lib/queryClient";

/** Full-screen progress used for every wait before the app is usable. */
function FullScreenStatus({ message }: { message: string }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background">
      <MascotWait label={message} />
    </div>
  );
}

/** Shown while a route's chunk is still downloading. */
function PageSkeleton() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center text-sm text-muted-foreground">
      Loading…
    </div>
  );
}

/** S3 website hosting 301s a path to a trailing slash, which no Route matches. */
function StripTrailingSlash() {
  const { pathname, search, hash } = useLocation();
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return <Navigate to={`${pathname.replace(/\/+$/, "")}${search}${hash}`} replace />;
  }
  return null;
}

function AppLayout({ children }: { children: React.ReactNode }) {
  useLiveSync(); // live updates (tasks, projects, users) via smart polling
  return (
    <div className="flex h-screen w-full overflow-hidden">
      <AppSidebar />
      {/* The top bar is gone; the sidebar carries everything it held. Under md
          the sidebar is hidden, so the drawer trigger floats over the page
          instead of sitting in a bar of its own. */}
      <div className="md:hidden fixed left-2 top-2 z-50 rounded-xl border border-border/70 bg-card/90 backdrop-blur shadow-sm">
        <MobileNav />
      </div>
      <div className="flex-1 flex flex-col min-w-0">
        {/* pt on small screens keeps page content clear of the floating drawer
            button, which would otherwise sit on top of the first heading. */}
        <main className="flex-1 min-w-0 overflow-auto pt-12 md:pt-0">
        {/* A render error in one page must not blank the whole app. */}
        <ErrorBoundary>
          <Suspense fallback={<PageSkeleton />}>{children}</Suspense>
        </ErrorBoundary>
      </main>
      </div>
      <ErrorBoundary area="Assistant">
        <Companion />
      </ErrorBoundary>
      <ActualHoursDialogHost />
      <ConfirmDialogHost />
    </div>
  );
}

function ProtectedRoute({ children, managerOnly }: { children: React.ReactNode; managerOnly?: boolean }) {
  const currentUser = useAppStore(s => s.currentUser);
  if (!currentUser) return <Navigate to="/login" />;
  if (managerOnly && currentUser.role !== 'manager' && currentUser.role !== 'superadmin') return <Navigate to="/" />;
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
  const bootstrapError = useAppStore(s => s.bootstrapError);
  const bootstrap = useAppStore(s => s.bootstrap);
  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  // Startup failed for a reason that is NOT "you are signed out" — the token is
  // still good. Offer a retry instead of dumping the user on the login page,
  // which would look like being logged out for no reason.
  if (hydrated && bootstrapError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 text-center">
          <h2 className="text-base font-semibold">Could not reach the server</h2>
          <p className="mt-1.5 text-sm text-muted-foreground">
            You are still signed in. Check your connection and try again.
          </p>
          <p className="mt-3 rounded-lg bg-muted px-2.5 py-2 text-xs text-muted-foreground break-words">
            {bootstrapError}
          </p>
          <button
            type="button"
            onClick={() => void bootstrap()}
            className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (!hydrated) {
    // A Microsoft redirect is still mid-exchange on this load — name it, so the
    // wait reads as progress.
    return (
      <FullScreenStatus
        message={hasPendingMicrosoftAuth() ? 'Signing you in with Microsoft…' : 'Loading ZET…'}
      />
    );
  }
  return <>{children}</>;
}

/**
 * Finishes the Microsoft redirect sign-in, and holds a progress screen over the
 * routes while it runs.
 *
 * Without the gate the routes render during the exchange, so the user briefly
 * lands on the login page — the single biggest reason people concluded that
 * signing in with Microsoft had failed and clicked the button again.
 */
function MsalRedirectResume({ children }: { children: React.ReactNode }) {
  const loginWithMicrosoft = useAppStore(s => s.loginWithMicrosoft);
  const navigate = useNavigate();
  const ran = useRef(false);
  // Read synchronously on the first render: by the time an effect runs, the
  // routes would already have painted.
  // Only hold the progress screen for a genuine first-time exchange. An already
  // signed-in user must never be blocked behind it.
  const [exchanging, setExchanging] = useState(() => hasPendingMicrosoftAuth() && !getStoredToken());

  useEffect(() => {
    if (ran.current) return;
    const pending = consumePendingMicrosoftAuth();
    if (!pending) {
      setExchanging(false);
      return;
    }
    ran.current = true;

    // MSAL keeps its cache in sessionStorage, so a plain reload can make
    // handleRedirectPromise resolve again and leave a *stale* pending token behind.
    // Re-exchanging it would fail (Microsoft ID tokens last about an hour) and take
    // a working session down with it. If we are already signed in, drop it silently.
    if (getStoredToken()) {
      setExchanging(false);
      return;
    }

    void (async () => {
      try {
        const result = pending.flow === 'signup'
          ? await loginWithMicrosoft(pending.idToken, false, pending.jobTitle, pending.experienceMonths)
          : await loginWithMicrosoft(pending.idToken, pending.rememberMe);
        if ('pending' in result) {
          toast.info(result.pending);
          navigate("/login", { replace: true });
          return;
        }
        toast.success(`Welcome, ${result.name}!`);
        navigate("/", { replace: true });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Microsoft sign-in failed.");
        // Only send them to the login page if they have no session to fall back on;
        // never evict a signed-in user because a redirect replay failed.
        if (!getStoredToken()) navigate("/login", { replace: true });
      } finally {
        setExchanging(false);
      }
    })();
  }, [loginWithMicrosoft, navigate]);

  if (exchanging) return <FullScreenStatus message="Signing you in with Microsoft…" />;
  return <>{children}</>;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    {/* No hover delay: an icon-only button should name itself the moment you reach it. */}
    <TooltipProvider delayDuration={0} skipDelayDuration={0}>
      <Sonner />
      <ThemeHandler />
      <BootstrapGate>
      {/* Opt in to the v7 behaviours now. Without these, Router logs two
          deprecation warnings on every boot, which buries real errors. */}
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <StripTrailingSlash />
        <MsalRedirectResume>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignUpPage />} />
          <Route path="/" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
          <Route path="/tasks" element={<Navigate to="/" replace />} />
          <Route path="/timesheet" element={<ProtectedRoute><TimesheetPage /></ProtectedRoute>} />
          <Route path="/timesheet/approvals" element={<Navigate to="/timesheet?manage=1" replace />} />
          <Route path="/calendar" element={<ProtectedRoute><CalendarPage /></ProtectedRoute>} />
          <Route path="/meeting-notes" element={<ProtectedRoute><MeetingNotesPage /></ProtectedRoute>} />
          <Route path="/reports" element={<ProtectedRoute><TimeReportPage /></ProtectedRoute>} />
          <Route path="/reports/clients/:clientId" element={<ProtectedRoute managerOnly><ClientDetailPage /></ProtectedRoute>} />
          <Route path="/users" element={<ProtectedRoute managerOnly><UsersPage /></ProtectedRoute>} />
          <Route path="/users/forecast" element={<ProtectedRoute managerOnly><WhatWillHappenNextPage /></ProtectedRoute>} />
          <Route path="/users/:userId" element={<ProtectedRoute managerOnly><UserDetailPage /></ProtectedRoute>} />
          <Route path="/wip" element={<Navigate to="/users?tab=wip" replace />} />
          <Route path="/manage" element={<ProtectedRoute managerOnly><ManageProjectsOverview /></ProtectedRoute>} />
          <Route path="/manage/status" element={<ProtectedRoute managerOnly><ManageProjectsOverview /></ProtectedRoute>} />
          <Route path="/manage/:projectId" element={<ProtectedRoute managerOnly><ProjectDetailPage /></ProtectedRoute>} />
          <Route path="/delivery" element={<Navigate to="/manage/status" replace />} />
          <Route path="/settings" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
          <Route path="/ai" element={<ProtectedRoute><AIPage /></ProtectedRoute>} />
          <Route path="/overview" element={<ProtectedRoute managerOnly><DashboardPanArea><OverviewPage /></DashboardPanArea></ProtectedRoute>} />
          <Route path="/overview/users" element={<Navigate to="/overview?tab=user" replace />} />
          <Route path="/superadmin" element={<ProtectedRoute><SuperAdminPage /></ProtectedRoute>} />
          {/* The page gates itself on role too, so a typed URL cannot reach it. */}
          <Route path="/superadmin/prompts" element={<ProtectedRoute><PromptsPage /></ProtectedRoute>} />
          <Route path="/admin" element={<Navigate to="/superadmin" replace />} />
          <Route path="/admin/login" element={<Navigate to="/login" replace />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
        </MsalRedirectResume>
      </BrowserRouter>
      </BootstrapGate>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
