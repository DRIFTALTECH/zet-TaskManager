/**
 * Stories drafted from a BRD are saved together.
 *
 * The ticks already meant "I want these", but the only way to act on them was
 * to open each story and save it on its own — a BRD producing fifteen stories
 * took fifteen trips through a dialog. The commit endpoint always accepted a
 * list; nothing was asking it for one.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { PrdStudio } from '@/components/prd/PrdStudio';
import { useAppStore } from '@/stores/appStore';
import type { PrdDraft } from '@/types';

vi.mock('@/lib/api', () => ({
  api: {
    addPrdStory: vi.fn(),
    patchPrdItem: vi.fn(),
    discardPrdDraft: vi.fn(),
    generatePrdStoryTasksPreview: vi.fn(),
  },
}));

const draft: PrdDraft = {
  importId: 'imp1',
  sourceText: 'a brd',
  stories: [
    { id: 's1', title: 'Sync confirmed issues' },
    { id: 's2', title: 'Client portal' },
    { id: 's3', title: 'Error tracking' },
  ],
} as PrdDraft;

beforeEach(() => {
  localStorage.clear();
  useAppStore.setState({ users: [] as never });
});

function studio(onCommit = vi.fn().mockResolvedValue({ storyIds: [] })) {
  render(
    <TooltipProvider>
      <PrdStudio
        draft={draft}
        projects={[]}
        saving={false}
        onChange={vi.fn()}
        onCommit={onCommit}
      />
    </TooltipProvider>,
  );
  return onCommit;
}

describe('saving several drafted stories at once', () => {
  it('offers nothing to save until something is ticked', () => {
    studio();
    expect(screen.getByText('Save selected').closest('button')?.disabled).toBe(true);
  });

  it('counts what is ticked', () => {
    studio();
    fireEvent.click(screen.getByText('Tick all'));
    expect(screen.getByText('3 selected')).toBeTruthy();
    expect(screen.getByText('Save 3 stories')).toBeTruthy();
  });

  it('sends every ticked story in one request', async () => {
    const onCommit = studio();
    fireEvent.click(screen.getByText('Tick all'));
    fireEvent.click(screen.getByText('Save 3 stories'));

    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1));
    expect(onCommit.mock.calls[0][0].sort()).toEqual(['s1', 's2', 's3']);
  });

  it('says "story" for one and "stories" for more', () => {
    studio();
    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    expect(screen.getByText('Save 1 story')).toBeTruthy();
  });

  it('clears the ticks once they are saved, since those rows have gone', async () => {
    const onCommit = studio();
    fireEvent.click(screen.getByText('Tick all'));
    fireEvent.click(screen.getByText('Save 3 stories'));
    await waitFor(() => expect(onCommit).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText('3 selected')).toBeNull());
  });

  it('keeps the ticks when saving fails, so it can be retried', async () => {
    const onCommit = vi.fn().mockRejectedValue(new Error('server said no'));
    studio(onCommit);
    fireEvent.click(screen.getByText('Tick all'));
    fireEvent.click(screen.getByText('Save 3 stories'));
    await waitFor(() => expect(onCommit).toHaveBeenCalled());
    expect(screen.getByText('3 selected')).toBeTruthy();
  });
});
