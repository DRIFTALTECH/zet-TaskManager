import { motion } from 'framer-motion';
import { ZaniMessageAttachments } from './ZaniCards';
import { ZaniMarkdown } from './ZaniMarkdown';
import type { TaskPrefill } from './ZaniCards';
import type { AIChatAction, AIExtractedTask, AIProposal, AICard } from '@/types';
import { cn } from '@/lib/utils';

export interface ZaniDisplayMessage {
  role: 'user' | 'assistant';
  content: string;
  tasks?: AIExtractedTask[];
  actions?: AIChatAction[];
  proposals?: AIProposal[];
  cards?: AICard[];
  loading?: boolean;
  streaming?: boolean;
  status?: string;
}

function StreamingCursor() {
  return (
    <span className="inline-block w-[2px] h-[1em] ml-0.5 align-text-bottom bg-violet-500 animate-pulse rounded-full" aria-hidden />
  );
}

export function ZaniMessage({
  msg,
  onEditTask,
}: {
  msg: ZaniDisplayMessage;
  onEditTask: (p: TaskPrefill) => void;
}) {
  const isUser = msg.role === 'user';

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'tween', duration: 0.2 }}
      className={cn('w-full', isUser ? 'flex justify-end' : 'flex justify-start')}
    >
      <div className={cn('min-w-0 max-w-[min(100%,42rem)]', isUser ? 'items-end' : 'items-start')}>
        {isUser ? (
          <div className="rounded-2xl rounded-tr-md px-4 py-2.5 text-[15px] leading-relaxed bg-foreground text-background shadow-sm">
            <span className="whitespace-pre-wrap">{msg.content}</span>
          </div>
        ) : (
          <div className="w-full">
            {(msg.loading && !msg.content) || msg.status ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-1">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-60" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-violet-500" />
                </span>
                <span>{msg.status ?? 'Thinking…'}</span>
              </div>
            ) : null}

            {msg.content ? (
              <div className="text-[15px] text-foreground/95 py-0.5">
                <ZaniMarkdown content={msg.content} />
                {msg.streaming && <StreamingCursor />}
              </div>
            ) : null}

            {!msg.loading && !msg.streaming && (msg.actions?.length || msg.proposals?.length || msg.cards?.length || msg.tasks?.length) ? (
              <ZaniMessageAttachments
                actions={msg.actions}
                proposals={msg.proposals}
                cards={msg.cards}
                tasks={msg.tasks}
                onEditTask={onEditTask}
              />
            ) : null}
          </div>
        )}
      </div>
    </motion.div>
  );
}
