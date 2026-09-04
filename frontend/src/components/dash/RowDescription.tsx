/**
 * The description affordance on a list row.
 *
 * Every row carries it, story or task, so the gesture is always the same: hover
 * the glyph, read the description. The list payload deliberately ships without
 * descriptions — they would ride on every board poll — so the full text is
 * fetched on first hover and cached under the same key the detail modal uses,
 * which means opening the row afterwards costs nothing.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlignLeft, Loader2 } from 'lucide-react';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { api } from '@/lib/api';
import { storyKeys, taskKeys } from '@/lib/queryClient';
import { plainTextToHtml, sanitizeRichText } from '@/lib/rich-text';
import type { DashRow } from '@/lib/dash-rows';

export function RowDescription({ row }: { row: DashRow }) {
  const [open, setOpen] = useState(false);
  const isStory = row.type === 'story';

  const { data, isLoading } = useQuery<{ description?: string }>({
    queryKey: isStory ? storyKeys.detail(row.entityId) : taskKeys.detail(row.entityId),
    queryFn: () =>
      isStory ? api.getUserStory(row.entityId) : api.getTask(row.entityId),
    // Nothing is fetched until someone actually asks to read it.
    enabled: open,
    staleTime: 60_000,
  });

  const description = (data?.description ?? '').trim();
  const html = description ? sanitizeRichText(plainTextToHtml(description)) : '';

  return (
    <HoverCard open={open} onOpenChange={setOpen} openDelay={220} closeDelay={120}>
      <HoverCardTrigger asChild>
        <span
          role="button"
          tabIndex={-1}
          aria-label="Show description"
          onClick={e => e.stopPropagation()}
          className={`shrink-0 rounded p-0.5 transition-colors ${
            row.hasDescription
              ? 'text-muted-foreground/60 hover:text-foreground'
              : 'text-muted-foreground/25 hover:text-muted-foreground/60'
          }`}
        >
          <AlignLeft className="h-3 w-3" />
        </span>
      </HoverCardTrigger>
      <HoverCardContent
        align="start"
        side="bottom"
        onClick={e => e.stopPropagation()}
        className="w-[min(28rem,80vw)] rounded-xl p-0"
      >
        <div className="border-b border-border/50 px-3 py-2">
          <p className="truncate text-xs font-semibold">{row.title}</p>
        </div>
        {/* Scrolls on its own so a long description never grows the card. */}
        <div
          className="max-h-64 overflow-y-auto overscroll-contain px-3 py-2.5 text-[13px] leading-relaxed"
          onWheel={e => e.stopPropagation()}
        >
          {isLoading ? (
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Loading…
            </span>
          ) : html ? (
            <div
              className="[&_a]:underline [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:mb-2 [&_ul]:list-disc [&_ul]:pl-5"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          ) : (
            <span className="text-xs italic text-muted-foreground/60">No description yet.</span>
          )}
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

export default RowDescription;
