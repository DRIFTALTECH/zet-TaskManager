/**
 * Dropping on a card asks which of two things you meant.
 *
 * The card and the column behind it are both under the cursor, so the gesture
 * cannot say on its own whether the item belongs *in* that card or simply in
 * that column. A yes/no question made "outside" cost a second drag.
 */
import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { chooseAction, confirmAction, ConfirmDialogHost } from '@/components/ConfirmDialog';

const opts = {
  title: 'Where should "A" go?',
  description: 'You dropped it on "B".',
  choices: [
    { label: 'Leave it outside', value: 'outside' },
    { label: 'Put it inside', value: 'inside' },
  ],
};

describe('the inside-or-outside question', () => {
  it('offers both outcomes plus cancel', async () => {
    render(<ConfirmDialogHost />);
    const answer = chooseAction(opts);
    await screen.findByText('Where should "A" go?');

    expect(screen.getByText('Leave it outside')).toBeTruthy();
    expect(screen.getByText('Put it inside')).toBeTruthy();
    expect(screen.getByText('Cancel')).toBeTruthy();

    fireEvent.click(screen.getByText('Put it inside'));
    expect(await answer).toBe('inside');
  });

  it('returns "outside" when that is chosen', async () => {
    render(<ConfirmDialogHost />);
    const answer = chooseAction(opts);
    await screen.findByText('Leave it outside');
    fireEvent.click(screen.getByText('Leave it outside'));
    expect(await answer).toBe('outside');
  });

  it('returns null on cancel, so nothing happens', async () => {
    render(<ConfirmDialogHost />);
    const answer = chooseAction(opts);
    await screen.findByText('Cancel');
    fireEvent.click(screen.getByText('Cancel'));
    expect(await answer).toBeNull();
  });

  it('leaves the plain yes/no question working', async () => {
    render(<ConfirmDialogHost />);
    const answer = confirmAction({ title: 'Delete this?', confirmLabel: 'Delete' });
    await screen.findByText('Delete this?');
    expect(screen.queryByText('Leave it outside')).toBeNull();
    fireEvent.click(screen.getByText('Delete'));
    expect(await answer).toBe(true);
  });
});
