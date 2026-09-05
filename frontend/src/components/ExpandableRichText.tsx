import { useState } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';

import { RichTextEditor } from '@/components/RichTextEditor';
import { Hint } from '@/components/ui/hint';

/**
 * A rich-text field that starts short and opens on request.
 *
 * Description and acceptance criteria are the only fields in a detail modal
 * with no natural height, so a long one pushed everything under it — the task
 * list, the attachments, the whole lower half — off the screen, and a short one
 * still reserved room it never used. Capped, they cost a fixed amount and the
 * reader decides which one is worth the space today.
 *
 * The cap is a scroll box, not a crop: the text is always reachable at either
 * size, so expanding is about comfort rather than access. A fade over the last
 * few lines is what says there is more, since a plain cut-off edge reads as the
 * end of the content.
 */
export function ExpandableRichText({
  value,
  onChange,
  editable = true,
  placeholder,
  className = '',
  label,
}: {
  value: string;
  onChange: (html: string) => void;
  editable?: boolean;
  placeholder?: string;
  /** Passed to the editor itself, not the wrapper. */
  className?: string;
  /** Names the field in the toggle's tooltip, e.g. "description". */
  label: string;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="relative">
      <div className={expanded ? 'max-h-[28rem] overflow-y-auto' : 'max-h-32 overflow-y-auto'}>
        <RichTextEditor
          value={value}
          onChange={onChange}
          editable={editable}
          placeholder={placeholder}
          className={className}
        />
      </div>

      {/* Only while collapsed, and never over the button. */}
      {!expanded && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-6 rounded-b-xl bg-gradient-to-t from-card to-transparent" />
      )}

      <Hint label={expanded ? `Collapse ${label}` : `Expand ${label}`}>
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          aria-label={expanded ? `Collapse ${label}` : `Expand ${label}`}
          aria-expanded={expanded}
          className="absolute bottom-1.5 right-1.5 rounded-md border border-border/50 bg-card/90 p-1 text-muted-foreground/60 shadow-sm backdrop-blur transition-colors hover:bg-muted hover:text-foreground"
        >
          {expanded ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
        </button>
      </Hint>
    </div>
  );
}

export default ExpandableRichText;
