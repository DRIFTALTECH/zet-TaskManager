import { useEffect, useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export interface ConfirmOptions {
  title: string;
  description?: string;
  /** Label on the confirming button. Name the action, not "OK". */
  confirmLabel?: string;
  cancelLabel?: string;
  /** Paints the confirm button as destructive — deletes, discards, wipes. */
  destructive?: boolean;
}

type Pending = ConfirmOptions & { resolve: (ok: boolean) => void };

let listener: ((p: Pending | null) => void) | null = null;

/**
 * App-styled replacement for `window.confirm`.
 *
 * The native one is painted by the browser, blocks the whole tab, and cannot be
 * themed or dismissed by clicking away. This resolves `false` on cancel, on
 * Escape, and on a click outside — doing nothing is always the safe outcome.
 *
 * Mount `<ConfirmDialogHost />` once at the app root; without it every call
 * resolves `false` rather than silently going ahead.
 */
export function confirmAction(options: ConfirmOptions): Promise<boolean> {
  return new Promise(resolve => {
    if (!listener) {
      resolve(false);
      return;
    }
    listener({ ...options, resolve });
  });
}

export function ConfirmDialogHost() {
  const [pending, setPending] = useState<Pending | null>(null);

  useEffect(() => {
    listener = setPending;
    return () => { listener = null; };
  }, []);

  const close = (ok: boolean) => {
    pending?.resolve(ok);
    setPending(null);
  };

  return (
    <AlertDialog open={!!pending} onOpenChange={o => { if (!o) close(false); }}>
      <AlertDialogContent className="rounded-2xl">
        <AlertDialogHeader>
          <AlertDialogTitle>{pending?.title}</AlertDialogTitle>
          {pending?.description ? (
            <AlertDialogDescription>{pending.description}</AlertDialogDescription>
          ) : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => close(false)}>
            {pending?.cancelLabel ?? 'Cancel'}
          </AlertDialogCancel>
          <AlertDialogAction
            className={pending?.destructive ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : undefined}
            onClick={() => close(true)}
          >
            {pending?.confirmLabel ?? 'Confirm'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
