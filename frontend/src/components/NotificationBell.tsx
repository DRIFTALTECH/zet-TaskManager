import { useState, useEffect, useRef, useCallback } from 'react';
import { Bell, CheckCheck, X, UserPlus, MessageSquare, AtSign, CheckCircle2, ArrowRightLeft } from 'lucide-react';
import { api } from '@/lib/api';
import type { Notification } from '@/types';
import { motion, AnimatePresence } from 'framer-motion';
import UserAvatar from '@/components/UserAvatar';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '@/stores/appStore';

const POLL_INTERVAL = 30_000; // 30 seconds

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const TYPE_ICON: Record<string, React.ReactNode> = {
  task_assigned: <UserPlus className="h-3.5 w-3.5 text-blue-400" />,
  task_mentioned: <AtSign className="h-3.5 w-3.5 text-violet-400" />,
  task_status_changed: <ArrowRightLeft className="h-3.5 w-3.5 text-amber-400" />,
  task_commented: <MessageSquare className="h-3.5 w-3.5 text-sky-400" />,
  task_approved: <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />,
};

export default function NotificationBell() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const selectTask = useAppStore(s => s.selectProject); // just for triggering task open

  const unread = notifications.filter(n => !n.isRead).length;

  const load = useCallback(async () => {
    try {
      const data = await api.getNotifications();
      setNotifications(data);
    } catch {
      // silently fail — don't disrupt the app
    }
  }, []);

  // Initial load + polling
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), POLL_INTERVAL);
    return () => clearInterval(timer);
  }, [load]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open]);

  // Open the panel when another component asks (e.g. the Tasker mascot).
  useEffect(() => {
    function openPanel() { void load(); setOpen(true); }
    window.addEventListener('zet:open-notifications', openPanel);
    return () => window.removeEventListener('zet:open-notifications', openPanel);
  }, [load]);

  async function handleMarkAll() {
    try {
      await api.markAllNotificationsRead();
      setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
    } catch { /* ignore */ }
  }

  async function handleClickNotification(n: Notification) {
    // Mark as read
    if (!n.isRead) {
      try {
        await api.markNotificationRead(n.id);
        setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, isRead: true } : x));
      } catch { /* ignore */ }
    }
    // Navigate to the task
    if (n.entityType === 'task' && n.entityId) {
      setOpen(false);
      navigate('/tasks');
      // Dispatch custom event so MyTasksPage can open the task modal
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('zet:open-task', { detail: { taskId: n.entityId } }));
      }, 100);
    }
  }

  return (
    <div className="relative" ref={panelRef}>
      {/* Bell button */}
      <button
        onClick={() => setOpen(o => !o)}
        className="relative p-2 rounded-xl border border-transparent hover:border-border/60 hover:bg-accent/60 transition-colors"
        title="Notifications"
      >
        <Bell className="h-4 w-4" />
        <AnimatePresence>
          {unread > 0 && (
            <motion.span
              key="badge"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0 }}
              className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white leading-none"
            >
              {unread > 9 ? '9+' : unread}
            </motion.span>
          )}
        </AnimatePresence>
      </button>

      {/* Dropdown panel */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.96 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className="absolute right-0 top-full mt-2 w-[min(360px,calc(100vw-1.5rem))] max-h-[480px] flex flex-col glass border border-border/50 rounded-2xl shadow-2xl z-50 overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border/30 shrink-0">
              <div className="flex items-center gap-2">
                <Bell className="h-3.5 w-3.5 text-muted-foreground/60" />
                <span className="text-sm font-semibold text-foreground">Notifications</span>
                {unread > 0 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-500/15 text-red-400 font-bold border border-red-500/25">
                    {unread} new
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                {unread > 0 && (
                  <button
                    onClick={handleMarkAll}
                    className="flex items-center gap-1 text-[11px] text-muted-foreground/60 hover:text-foreground px-2 py-1 rounded-lg hover:bg-muted/40 transition-colors"
                    title="Mark all as read"
                  >
                    <CheckCheck className="h-3 w-3" />
                    All read
                  </button>
                )}
                <button
                  onClick={() => setOpen(false)}
                  className="p-1 rounded-lg hover:bg-muted/40 text-muted-foreground/40 hover:text-foreground transition-colors"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto min-h-0">
              {notifications.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <Bell className="h-8 w-8 text-muted-foreground/20 mb-2" />
                  <p className="text-sm text-muted-foreground/50">No notifications yet</p>
                </div>
              ) : (
                <div className="divide-y divide-border/20">
                  {notifications.map(n => (
                    <button
                      key={n.id}
                      onClick={() => void handleClickNotification(n)}
                      className={`w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-muted/20 transition-colors group ${
                        !n.isRead ? 'bg-primary/5' : ''
                      }`}
                    >
                      {/* Avatar */}
                      <div className="shrink-0 mt-0.5 relative">
                        <UserAvatar
                          name={n.triggeredByName}
                          avatar={n.triggeredByAvatar}
                          size="sm"
                        />
                        <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-card border border-border/40">
                          {TYPE_ICON[n.type] ?? <Bell className="h-2.5 w-2.5 text-muted-foreground" />}
                        </span>
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <p className={`text-xs leading-snug ${!n.isRead ? 'font-semibold text-foreground' : 'text-foreground/80'}`}>
                          {n.message}
                        </p>
                        <p className="text-[10px] text-muted-foreground/50 mt-0.5 font-mono">
                          {timeAgo(n.createdAt)}
                        </p>
                      </div>

                      {/* Unread dot */}
                      {!n.isRead && (
                        <span className="shrink-0 mt-1.5 h-2 w-2 rounded-full bg-primary" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
