/**
 * Guards closing a dialog that has unsaved edits.
 *
 * Replaces `window.confirm`, which blocks the whole tab, is styled by the
 * browser rather than the app, and cannot be dismissed by clicking away. This
 * shows a corner toast instead: the dialog simply stays open until you pick
 * Discard, so doing nothing is always the safe outcome.
 */
import { useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';

export function useUnsavedChangesGuard({
  isDirty,
  onOpenChange,
  what,
}: {
  isDirty: boolean;
  onOpenChange: (open: boolean) => void;
  /** Named in the prompt, e.g. "task" → "Close this task without saving?". */
  what: string;
}) {
  const toastIdRef = useRef<string | number | null>(null);

  const dismiss = useCallback(() => {
    if (toastIdRef.current !== null) {
      toast.dismiss(toastIdRef.current);
      toastIdRef.current = null;
    }
  }, []);

  // Saving clears the dirty flag, which makes any open prompt a lie.
  useEffect(() => {
    if (!isDirty) dismiss();
  }, [isDirty, dismiss]);

  // Never leave a prompt behind pointing at a dialog that is gone.
  useEffect(() => dismiss, [dismiss]);

  return useCallback(
    (next: boolean) => {
      if (next || !isDirty) {
        dismiss();
        onOpenChange(next);
        return;
      }
      // A prompt is already up. Never tear it down and rebuild it: clicking its
      // own Discard button registers as an interaction outside the dialog, which
      // asks the dialog to close and lands right back here — rebuilding would
      // destroy the button mid-click and nothing would ever close.
      if (toastIdRef.current !== null) return;
      toastIdRef.current = toast.warning('Unsaved changes', {
        description: `Close this ${what} without saving?`,
        position: 'top-right',
        duration: 10000,
        // Sonner does not tell us the id is dead otherwise, and a stale id would
        // make the guard think a prompt is still showing and silently do nothing.
        onAutoClose: () => { toastIdRef.current = null; },
        onDismiss: () => { toastIdRef.current = null; },
        action: {
          label: 'Discard',
          onClick: () => {
            toastIdRef.current = null;
            onOpenChange(false);
          },
        },
        cancel: {
          label: 'Keep editing',
          onClick: () => {
            toastIdRef.current = null;
          },
        },
      });
    },
    [isDirty, onOpenChange, what, dismiss],
  );
}
