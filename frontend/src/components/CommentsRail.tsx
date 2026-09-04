import { useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageSquare, Send } from 'lucide-react';
import { toast } from 'sonner';
import { confirmAction } from '@/components/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { FieldLabel } from '@/components/ui/field';
import UserAvatar from '@/components/UserAvatar';
import { matchAgentBrand, AgentBrandBadge } from '@/lib/agent-brand';
import { useAppStore } from '@/stores/appStore';

/** Shape shared by task and user-story comments. */
export interface RailComment {
  id: string;
  userId: string;
  authorName: string;
  message: string;
  createdAt: string;
}

interface Props {
  comments: RailComment[];
  loading?: boolean;
  onPost: (message: string, mentionedUserIds: string[]) => Promise<void>;
  onEdit: (id: string, message: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

function tsShort(iso: string) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${day} ${hh}:${mm}`;
  } catch {
    return iso;
  }
}

function renderMessageWithMentions(message: string, userNames: string[]) {
  if (!message.includes('@')) return message;

  const escaped = [...new Set(userNames.filter(Boolean))]
    .sort((a, b) => b.length - a.length)
    .map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = escaped.length
    ? new RegExp(`(@(?:${escaped.join('|')}|\\S+))`, 'g')
    : /@\S+/g;

  const parts = message.split(pattern);
  return parts.map((part, i) =>
    part.startsWith('@') ? (
      <span key={i} className="font-semibold text-violet-600 dark:text-violet-400">{part}</span>
    ) : (
      part
    ),
  );
}

/** Right-hand comment rail — same markup the task modal uses, minus the AI summary. */
export function CommentsRail({ comments, loading, onPost, onEdit, onDelete }: Props) {
  const { users, currentUser } = useAppStore();
  const [newText, setNewText] = useState('');
  const [posting, setPosting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');

  // @mention state
  const [mentionedUserIds, setMentionedUserIds] = useState<string[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionStartPos, setMentionStartPos] = useState(0);
  const [mentionDropdownIdx, setMentionDropdownIdx] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const mentionCandidates = useMemo(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    return users.filter(u => u.name.toLowerCase().includes(q)).slice(0, 6);
  }, [mentionQuery, users]);

  const post = async () => {
    if (!newText.trim()) return;
    setPosting(true);
    try {
      await onPost(newText.trim(), mentionedUserIds);
      setNewText('');
      setMentionedUserIds([]);
      setMentionQuery(null);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not post comment'); }
    finally { setPosting(false); }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setNewText(val);
    const pos = e.target.selectionStart ?? val.length;
    const textBefore = val.slice(0, pos);
    const match = textBefore.match(/@([^\s@]*)$/);
    if (match) {
      setMentionQuery(match[1]);
      setMentionStartPos(textBefore.length - match[0].length);
      setMentionDropdownIdx(0);
    } else {
      setMentionQuery(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionQuery !== null && mentionCandidates.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setMentionDropdownIdx(i => (i + 1) % mentionCandidates.length); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setMentionDropdownIdx(i => (i - 1 + mentionCandidates.length) % mentionCandidates.length); return; }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        insertMention(mentionCandidates[mentionDropdownIdx]);
        return;
      }
      if (e.key === 'Escape') { setMentionQuery(null); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey && mentionQuery === null) {
      e.preventDefault();
      void post();
    }
  };

  const insertMention = (user: typeof users[number]) => {
    const before = newText.slice(0, mentionStartPos);
    const after = newText.slice(mentionStartPos + 1 + (mentionQuery?.length ?? 0));
    const newValue = `${before}@${user.name} ${after}`;
    setNewText(newValue);
    setMentionedUserIds(prev => prev.includes(user.id) ? prev : [...prev, user.id]);
    setMentionQuery(null);
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        const pos = before.length + user.name.length + 2; // "@" + name + trailing space
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(pos, pos);
      }
    });
  };

  const saveEdit = async () => {
    if (!editingId || !editingText.trim()) return;
    try {
      await onEdit(editingId, editingText.trim());
      setEditingId(null); setEditingText('');
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not update comment'); }
  };

  const remove = async (id: string) => {
    const ok = await confirmAction({
      title: 'Delete this comment?',
      description: 'This cannot be undone.',
      confirmLabel: 'Delete comment',
      destructive: true,
    });
    if (!ok) return;
    try {
      await onDelete(id);
      if (editingId === id) { setEditingId(null); setEditingText(''); }
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not delete comment'); }
  };

  return (
    <div className="flex w-full min-h-0 shrink-0 flex-col overscroll-contain bg-muted/5 md:w-[340px] md:overflow-y-auto">
      <div className="p-5 sm:p-6">
        <section>
          <div className="flex items-center justify-between mb-3">
            <FieldLabel
              icon={MessageSquare}
              label={comments.length > 0 ? `Comments (${comments.length})` : 'Comments'}
            />
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-10 gap-2 text-sm text-muted-foreground">
              <div className="w-4 h-4 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
              Loading comments…
            </div>
          ) : (
            <div className="space-y-3 mb-5">
              {comments.length === 0 && (
                <div className="text-center py-8 px-4 rounded-xl border border-dashed border-border/30 bg-muted/5">
                  <MessageSquare className="h-7 w-7 text-muted-foreground/20 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground/40 italic">No comments yet. Start the conversation!</p>
                </div>
              )}
              <AnimatePresence initial={false}>
                {comments.map(fb => {
                  const isOwn = currentUser?.id === fb.userId;
                  const brand = matchAgentBrand(fb.authorName);
                  return (
                    <motion.div
                      key={fb.id}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.96 }}
                      transition={{ duration: 0.15 }}
                      className={`flex gap-3 ${isOwn ? 'flex-row-reverse' : ''}`}
                    >
                      {brand
                        ? <AgentBrandBadge brand={brand} size={32} />
                        : <UserAvatar name={fb.authorName || '?'} avatar={users.find(u => u.id === fb.userId)?.avatar} size="sm" />}
                      <div className={`flex-1 min-w-0 flex flex-col gap-1 ${isOwn ? 'items-end' : 'items-start'}`}>
                        <div className={`flex items-center gap-2 ${isOwn ? 'flex-row-reverse' : ''}`}>
                          <span className="text-xs font-semibold text-foreground">{fb.authorName}</span>
                          {brand && (
                            <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full text-white" style={{ background: brand.bg }}>
                              AI
                            </span>
                          )}
                          <span className="text-[10px] text-muted-foreground/40 font-mono">{tsShort(fb.createdAt)}</span>
                        </div>
                        {editingId === fb.id ? (
                          <div className="w-full space-y-2">
                            <textarea
                              value={editingText}
                              onChange={e => setEditingText(e.target.value)}
                              rows={3}
                              className="w-full rounded-xl border border-border/50 bg-muted/20 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none"
                            />
                            <div className="flex gap-2">
                              <Button size="sm" onClick={() => void saveEdit()} disabled={!editingText.trim()}>Save</Button>
                              <Button size="sm" variant="ghost" onClick={() => { setEditingId(null); setEditingText(''); }}>Cancel</Button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div
                              className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed max-w-[88%] whitespace-pre-wrap shadow-sm ${
                                isOwn
                                  ? 'bg-primary/12 text-foreground rounded-tr-md border border-primary/15'
                                  : 'bg-muted/50 text-foreground rounded-tl-md border border-border/30'
                              } ${brand ? 'border-l-[3px]' : ''}`}
                              style={brand ? { borderLeftColor: brand.bg } : undefined}
                            >
                              {renderMessageWithMentions(fb.message, users.map(u => u.name))}
                            </div>
                            {isOwn && (
                              <div className="flex gap-1 mt-0.5">
                                <button
                                  onClick={() => { setEditingId(fb.id); setEditingText(fb.message); }}
                                  className="text-[11px] text-muted-foreground/50 hover:text-primary px-2 py-0.5 rounded-md hover:bg-primary/10 transition-colors"
                                >Edit</button>
                                <button
                                  onClick={() => void remove(fb.id)}
                                  className="text-[11px] text-muted-foreground/50 hover:text-red-600 dark:text-red-400 px-2 py-0.5 rounded-md hover:bg-red-500/10 transition-colors"
                                >Delete</button>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          )}

          {/* Comment input */}
          <div className="flex gap-3 items-end">
            {currentUser && <UserAvatar name={currentUser.name} avatar={currentUser.avatar} size="sm" />}
            <div className="flex-1 relative">
              <AnimatePresence>
                {mentionQuery !== null && mentionCandidates.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 4 }}
                    transition={{ duration: 0.1 }}
                    className="absolute bottom-full mb-1.5 left-0 w-56 glass border border-border/40 rounded-xl shadow-xl z-50 overflow-hidden"
                  >
                    {mentionCandidates.map((u, i) => (
                      <button
                        key={u.id}
                        onMouseDown={e => { e.preventDefault(); insertMention(u); }}
                        className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left transition-colors ${
                          i === mentionDropdownIdx ? 'bg-primary/15 text-foreground' : 'hover:bg-muted/40 text-foreground/80'
                        }`}
                      >
                        <UserAvatar name={u.name} avatar={u.avatar} size="sm" />
                        <div className="min-w-0">
                          <p className="font-medium truncate text-xs">{u.name}</p>
                          <p className="text-[10px] text-muted-foreground/50 capitalize">{u.role}</p>
                        </div>
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
              <textarea
                ref={textareaRef}
                value={newText}
                onChange={handleChange}
                onKeyDown={handleKeyDown}
                placeholder="Add a comment… (@ to mention, Enter to send)"
                rows={2}
                className="w-full rounded-xl border border-border/40 bg-muted/20 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/20 resize-none pr-14 transition-all placeholder:text-muted-foreground/35 leading-relaxed"
              />
              <button
                onClick={() => void post()}
                disabled={posting || !newText.trim()}
                className="absolute right-2.5 bottom-2.5 p-2 rounded-lg bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-25 transition-all hover:scale-105 active:scale-95 shadow-sm"
              >
                <Send className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

export default CommentsRail;
