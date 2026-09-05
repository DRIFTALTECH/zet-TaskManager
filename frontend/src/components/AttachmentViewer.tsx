import { useCallback, useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Download, Loader2, Code2, Eye } from 'lucide-react';

export interface ViewableAttachment {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  uploaderName: string;
}

type Kind = 'text' | 'html' | 'image' | 'pdf' | 'binary';

const TEXT_EXT =
  /\.(md|markdown|txt|diff|patch|json|log|csv|ya?ml|py|ts|tsx|js|jsx|sh|sql|css|env|toml|ini)$/i;

function fmtSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function kindOf(att: ViewableAttachment): Kind {
  const ct = att.contentType || '';
  if (/\.html?$/i.test(att.filename) || ct.includes('html')) return 'html';
  if (ct === 'application/pdf' || /\.pdf$/i.test(att.filename)) return 'pdf';
  if (ct.startsWith('image/')) return 'image';
  if (ct.startsWith('text/') || TEXT_EXT.test(att.filename)) return 'text';
  return 'binary';
}

/**
 * Opens an attachment in the app instead of downloading it.
 *
 * HTML is rendered in a sandboxed frame with neither scripts nor same-origin
 * access. A blob URL inherits the app's origin, so an uploaded page could
 * otherwise run script with the user's session — the sandbox is what makes
 * previewing someone else's HTML safe, and it is why the frame gets no
 * `allow-scripts`.
 */
export default function AttachmentViewer({
  attachment,
  fetchBlob,
  onDownload,
  onClose,
}: {
  /** null closes the dialog. */
  attachment: ViewableAttachment | null;
  fetchBlob: (att: ViewableAttachment) => Promise<Blob>;
  onDownload: (att: ViewableAttachment) => void;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  /** HTML can be read as a page or as source; default to the page. */
  const [asSource, setAsSource] = useState(false);

  const kind = attachment ? kindOf(attachment) : 'binary';

  const revoke = useCallback((u: string | null) => {
    if (u) { try { URL.revokeObjectURL(u); } catch { /* already gone */ } }
  }, []);

  useEffect(() => {
    if (!attachment) return;
    let cancelled = false;
    let created: string | null = null;
    setLoading(true); setFailed(false); setText(null); setUrl(null); setAsSource(false);
    void (async () => {
      try {
        const blob = await fetchBlob(attachment);
        if (cancelled) return;
        const k = kindOf(attachment);
        if (k === 'text' || k === 'html') setText(await blob.text());
        if (k === 'image' || k === 'pdf' || k === 'html') {
          created = URL.createObjectURL(blob);
          if (!cancelled) setUrl(created);
        }
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      revoke(created);
    };
  }, [attachment, fetchBlob, revoke]);

  const showToggle = kind === 'html' && !loading && !failed;

  return (
    <Dialog open={!!attachment} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="flex h-[calc(100dvh-4rem)] w-[calc(100vw-2rem)] max-w-none flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-[min(92vw,1100px)]" style={{ maxHeight: 'none' }}>
        <DialogTitle className="sr-only">{attachment?.filename ?? 'Attachment'}</DialogTitle>

        <div className="flex shrink-0 items-center gap-3 border-b border-border/30 px-5 py-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{attachment?.filename}</p>
            <p className="text-[10px] text-muted-foreground/60">
              {attachment && `${fmtSize(attachment.sizeBytes)} · ${attachment.uploaderName}`}
            </p>
          </div>

          {showToggle && (
            <button
              type="button"
              onClick={() => setAsSource(v => !v)}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border/50 px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
            >
              {asSource ? <><Eye className="h-3.5 w-3.5" /> Preview</> : <><Code2 className="h-3.5 w-3.5" /> Source</>}
            </button>
          )}

          {attachment && (
            <button
              type="button"
              onClick={() => onDownload(attachment)}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border/50 px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
            >
              <Download className="h-3.5 w-3.5" /> Download
            </button>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-auto bg-muted/10">
          {loading ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground/60" />
            </div>
          ) : failed ? (
            <p className="p-6 text-sm text-muted-foreground">Could not open this file.</p>
          ) : kind === 'image' && url ? (
            <div className="flex h-full items-center justify-center p-5">
              <img src={url} alt={attachment?.filename ?? ''} className="max-h-full max-w-full rounded-lg" />
            </div>
          ) : kind === 'pdf' && url ? (
            <iframe src={url} title={attachment?.filename ?? 'PDF'} className="h-full w-full border-0" />
          ) : kind === 'html' && !asSource && url ? (
            // No allow-scripts and no allow-same-origin: the page renders, but
            // cannot run anything or reach this origin.
            <iframe
              src={url}
              title={attachment?.filename ?? 'Preview'}
              sandbox=""
              className="h-full w-full border-0 bg-white"
            />
          ) : text !== null ? (
            <pre className="whitespace-pre-wrap break-words p-5 font-mono text-[12.5px] leading-relaxed text-foreground/90">
              {text}
            </pre>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
              <p className="text-sm text-muted-foreground">This file type can’t be previewed.</p>
              {attachment && (
                <button
                  type="button"
                  onClick={() => onDownload(attachment)}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
                >
                  <Download className="h-4 w-4" /> Download
                </button>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
