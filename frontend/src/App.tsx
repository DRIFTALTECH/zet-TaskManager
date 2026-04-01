import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAppStore } from "@/stores/appStore";
import { useEffect } from "react";
import LoginPage from "./pages/LoginPage";
import SignUpPage from "./pages/SignUpPage";
import DashboardPage from "./pages/DashboardPage";
import MyTasksPage from "./pages/MyTasksPage";
import TimesheetPage from "./pages/TimesheetPage";
import UsersPage from "./pages/UsersPage";
import UserDetailPage from "./pages/UserDetailPage";
import ManageEmployeesPage from "./pages/ManageEmployeesPage";
import AppSidebar from "./components/AppSidebar";
import AppNavbar from "./components/AppNavbar";

const queryClient = new QueryClient();

function AppLayout({ children }: { children: React.ReactNode }) {
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
      <div className="min-h-screen flex items-center justify-center bg-background text-muted-foreground text-sm">
        Loading…
      </div>
    );
  }
  return <>{children}</>;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Sonner />
      <ThemeHandler />
      <BootstrapGate>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignUpPage />} />
          <Route path="/" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
          <Route path="/tasks" element={<ProtectedRoute><MyTasksPage /></ProtectedRoute>} />
          <Route path="/timesheet" element={<ProtectedRoute><TimesheetPage /></ProtectedRoute>} />
          <Route path="/users" element={<ProtectedRoute managerOnly><UsersPage /></ProtectedRoute>} />
          <Route path="/users/:userId" element={<ProtectedRoute managerOnly><UserDetailPage /></ProtectedRoute>} />
          <Route path="/manage" element={<ProtectedRoute managerOnly><ManageEmployeesPage /></ProtectedRoute>} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </BrowserRouter>
      </BootstrapGate>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
