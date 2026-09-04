/**
 * Small rich-text editor for task and story descriptions.
 *
 * Deliberately not a framework: a `contenteditable` plus a handful of commands
 * covers bold/italic/lists/colour without adding an editor dependency, and the
 * value stays a single HTML string so the existing plain `description` column
 * keeps working.
 *
 * Anything stored here is rendered back as HTML, so it is sanitised on the way
 * in AND on the way out — descriptions are written by teammates, but "trusted
 * author" is not a security model.
 */
import { useEffect, useRef } from 'react';
import { Bold, Italic, List, ListOrdered, Strikethrough, Underline } from 'lucide-react';
import { sanitizeRichText, plainTextToHtml } from '@/lib/rich-text';

const TOOLS = [
  { cmd: 'bold', icon: Bold, label: 'Bold' },
  { cmd: 'italic', icon: Italic, label: 'Italic' },
  { cmd: 'underline', icon: Underline, label: 'Underline' },
  { cmd: 'strikeThrough', icon: Strikethrough, label: 'Strikethrough' },
  { cmd: 'insertUnorderedList', icon: List, label: 'Bulleted list' },
  { cmd: 'insertOrderedList', icon: ListOrdered, label: 'Numbered list' },
] as const;

const COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#a855f7'];

export function RichTextEditor({
  value,
  onChange,
  editable = true,
  placeholder = 'Write a description…',
  className = '',
}: {
  value: string;
  onChange: (html: string) => void;
  editable?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Only write into the DOM when the incoming value differs from what is already
  // rendered — assigning innerHTML on every keystroke would reset the caret.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const next = sanitizeRichText(plainTextToHtml(value));
    if (el.innerHTML !== next) el.innerHTML = next;
  }, [value]);

  const exec = (cmd: string, arg?: string) => {
    ref.current?.focus();
    document.execCommand(cmd, false, arg);
    if (ref.current) onChange(sanitizeRichText(ref.current.innerHTML));
  };

  return (
    <div className={className}>
      {editable && (
        <div className="mb-2 flex flex-wrap items-center gap-0.5 border-b border-border/40 pb-2">
          {TOOLS.map(({ cmd, icon: Icon, label }) => (
            <button
              key={cmd}
              type="button"
              title={label}
              aria-label={label}
              onMouseDown={e => e.preventDefault()} // keep the selection
              onClick={() => exec(cmd)}
              className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <Icon className="h-3.5 w-3.5" />
            </button>
          ))}
          <span className="mx-1 h-4 w-px bg-border/60" />
          {COLORS.map(c => (
            <button
              key={c}
              type="button"
              title={`Text colour ${c}`}
              aria-label={`Text colour ${c}`}
              onMouseDown={e => e.preventDefault()}
              onClick={() => exec('foreColor', c)}
              className="h-4 w-4 rounded-full border border-border/40"
              style={{ backgroundColor: c }}
            />
          ))}
          <button
            type="button"
            title="Clear formatting"
            onMouseDown={e => e.preventDefault()}
            onClick={() => exec('removeFormat')}
            className="ml-1 rounded px-1.5 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            Clear
          </button>
        </div>
      )}
      <div
        ref={ref}
        contentEditable={editable}
        suppressContentEditableWarning
        data-placeholder={placeholder}
        onInput={e => onChange(sanitizeRichText((e.target as HTMLDivElement).innerHTML))}
        className={`prose-sm w-full rounded-lg px-1 py-1 text-sm leading-relaxed outline-none
          [&:empty]:before:text-muted-foreground/40 [&:empty]:before:content-[attr(data-placeholder)]
          [&_a]:underline [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5
          ${editable
            // Grows with the text, drag-resizable past that, and never taller
            // than the modal it sits in.
            ? 'min-h-[7rem] max-h-[60vh] resize-y overflow-y-auto focus:bg-muted/30'
            : 'min-h-0'}`}
      />
    </div>
  );
}

export default RichTextEditor;
