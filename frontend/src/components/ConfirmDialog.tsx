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

/**
 * A question with more than one way to say yes.
 *
 * Dropping a card onto another card is genuinely ambiguous — the card and the
 * column behind it are both under the cursor — so offering only "do it" and
 * "cancel" makes the reader drag again to get the other outcome. Each choice
 * carries its own value and Cancel still means nothing happens.
 */
export interface ChoiceOptions {
  title: string;
  description?: string;
  /** Rendered left to right; the last one reads as the primary action. */
  choices: { label: string; value: string }[];
  cancelLabel?: string;
}

type Pending =
  | ({ kind: 'confirm'; resolve: (ok: boolean) => void } & ConfirmOptions)
  | ({ kind: 'choice'; resolve: (value: string | null) => void } & ChoiceOptions);

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
    listener({ kind: 'confirm', ...options, resolve });
  });
}

/**
 * Ask which of several things the reader meant. Resolves to the chosen value,
 * or `null` for cancel, Escape and clicking away — doing nothing stays the safe
 * outcome, exactly as it is for `confirmAction`.
 */
export function chooseAction(options: ChoiceOptions): Promise<string | null> {
  return new Promise(resolve => {
    if (!listener) {
      resolve(null);
      return;
    }
    listener({ kind: 'choice', ...options, resolve });
  });
}

export function ConfirmDialogHost() {
  const [pending, setPending] = useState<Pending | null>(null);

  useEffect(() => {
    listener = setPending;
    return () => { listener = null; };
  }, []);

  /** Dismissing without choosing: `false` for a confirm, `null` for a choice. */
  const dismiss = () => {
    if (pending?.kind === 'choice') pending.resolve(null);
    else pending?.resolve(false);
    setPending(null);
  };

  const answer = (value: boolean | string) => {
    if (pending?.kind === 'choice') pending.resolve(value as string);
    else pending?.resolve(value as boolean);
    setPending(null);
  };

  return (
    <AlertDialog open={!!pending} onOpenChange={o => { if (!o) dismiss(); }}>
      <AlertDialogContent className="rounded-2xl">
        <AlertDialogHeader>
          <AlertDialogTitle>{pending?.title}</AlertDialogTitle>
          {pending?.description ? (
            <AlertDialogDescription>{pending.description}</AlertDialogDescription>
          ) : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={dismiss}>
            {pending?.cancelLabel ?? 'Cancel'}
          </AlertDialogCancel>
          {pending?.kind === 'choice' ? (
            pending.choices.map((c, i) => (
              <AlertDialogAction
                key={c.value}
                // Only the last reads as the primary action; the others are
                // equal alternatives, not lesser ones.
                className={i < pending.choices.length - 1
                  ? 'bg-muted text-foreground hover:bg-muted/80'
                  : undefined}
                onClick={() => answer(c.value)}
              >
                {c.label}
              </AlertDialogAction>
            ))
          ) : (
            <AlertDialogAction
              className={pending?.destructive ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : undefined}
              onClick={() => answer(true)}
            >
              {pending?.confirmLabel ?? 'Confirm'}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
