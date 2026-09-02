/**
 * Lightweight markdown for Zani replies — bold + bullet lists, no extra deps.
 */

import { Fragment, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

function renderInline(text: string, keyPrefix: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={`${keyPrefix}-b-${i}`} className="font-semibold text-foreground">{part.slice(2, -2)}</strong>;
    }
    return <Fragment key={`${keyPrefix}-t-${i}`}>{part}</Fragment>;
  });
}

export function ZaniMarkdown({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  const lines = content.split('\n');
  const blocks: ReactNode[] = [];
  let listItems: string[] = [];
  let blockKey = 0;

  const flushList = () => {
    if (listItems.length === 0) return;
    blocks.push(
      <ul key={`ul-${blockKey++}`} className="my-2 space-y-1.5 pl-5 list-disc marker:text-violet-500/70">
        {listItems.map((item, i) => (
          <li key={i} className="leading-relaxed pl-0.5">
            {renderInline(item, `li-${blockKey}-${i}`)}
          </li>
        ))}
      </ul>,
    );
    listItems = [];
  };

  for (const line of lines) {
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    if (bullet) {
      listItems.push(bullet[1]);
      continue;
    }
    flushList();
    const trimmed = line.trim();
    if (!trimmed) {
      blocks.push(<div key={`sp-${blockKey++}`} className="h-2" aria-hidden />);
    } else {
      blocks.push(
        <p key={`p-${blockKey++}`} className="leading-relaxed">
          {renderInline(trimmed, `p-${blockKey}`)}
        </p>,
      );
    }
  }
  flushList();

  return <div className={cn('space-y-0.5', className)}>{blocks}</div>;
}
