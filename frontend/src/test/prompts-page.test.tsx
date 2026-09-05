/**
 * The prompts page lists what exists and opens one to edit.
 *
 * The question this page usually answers is "which of these has someone
 * changed?" — that is a column, and eleven open editors stacked down a page
 * buried it.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@/components/ui/tooltip';
import PromptsPage from '@/pages/PromptsPage';
import { useAppStore } from '@/stores/appStore';

const listPrompts = vi.fn();
const updatePrompt = vi.fn();
const resetPrompt = vi.fn();

vi.mock('@/lib/api', () => ({
  api: {
    listPrompts: (...a: unknown[]) => listPrompts(...a),
    updatePrompt: (...a: unknown[]) => updatePrompt(...a),
    resetPrompt: (...a: unknown[]) => resetPrompt(...a),
  },
}));

const rows = [
  { key: 'EXTRACT_PRD_PROMPT', body: 'Shipped wording for {projects}', defaultBody: 'Shipped wording for {projects}', placeholders: ['projects', 'text'], isCustom: false },
  {
    key: 'AGENT_SYSTEM', body: 'My wording', defaultBody: 'Shipped', placeholders: [], isCustom: true,
    updatedAt: '2026-09-01T10:00:00Z', updatedBy: 'Swamy',
  },
];

function page(role = 'superadmin') {
  useAppStore.setState({ currentUser: { id: 'u1', name: 'S', role } as never });
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <TooltipProvider>
        <MemoryRouter><PromptsPage /></MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  listPrompts.mockResolvedValue(rows);
});

describe('the prompts table', () => {
  it('names its columns', async () => {
    page();
    await screen.findByText('Extract prd');
    for (const h of ['Prompt', 'Status', 'Last edited', 'Actions']) {
      expect(screen.getByText(h)).toBeTruthy();
    }
  });

  it('lists each prompt with a readable name and its key', async () => {
    page();
    await screen.findByText('Extract prd');
    expect(screen.getByText('EXTRACT_PRD_PROMPT')).toBeTruthy();
    expect(screen.getByText('Agent system')).toBeTruthy();
  });

  it('marks which have been changed, and by whom', async () => {
    page();
    await screen.findByText('Edited');
    expect(screen.getByText('Default')).toBeTruthy();
    expect(screen.getByText(/Swamy/)).toBeTruthy();
    expect(screen.getByText('1 edited')).toBeTruthy();
  });

  it('offers Reset only on the ones that were changed', async () => {
    page();
    await screen.findByText('Edited');
    expect(screen.getByLabelText('Reset Agent system')).toBeTruthy();
    expect(screen.queryByLabelText('Reset Extract prd')).toBeNull();
  });
});

describe('editing a prompt', () => {
  it('opens the wording in a dialog', async () => {
    page();
    await screen.findByText('Extract prd');
    fireEvent.click(screen.getByLabelText('Edit Extract prd'));

    const field = await screen.findByDisplayValue('Shipped wording for {projects}');
    expect(field.closest('[role="dialog"]')).toBeTruthy();
  });

  it('cannot save until something is actually changed', async () => {
    page();
    await screen.findByText('Extract prd');
    fireEvent.click(screen.getByLabelText('Edit Extract prd'));
    await screen.findByDisplayValue('Shipped wording for {projects}');

    const save = screen.getByText('Save prompt').closest('button') as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    fireEvent.change(screen.getByDisplayValue('Shipped wording for {projects}'), { target: { value: 'New wording' } });
    expect(save.disabled).toBe(false);
  });

  it('saves the edited wording under the right key', async () => {
    updatePrompt.mockResolvedValue({ ...rows[0], body: 'New wording', isCustom: true });
    page();
    await screen.findByText('Extract prd');
    fireEvent.click(screen.getByLabelText('Edit Extract prd'));
    await screen.findByDisplayValue('Shipped wording for {projects}');

    fireEvent.change(screen.getByDisplayValue('Shipped wording for {projects}'), { target: { value: 'New wording' } });
    fireEvent.click(screen.getByText('Save prompt'));

    await waitFor(() => expect(updatePrompt).toHaveBeenCalledWith('EXTRACT_PRD_PROMPT', 'New wording'));
  });

  it('opens each prompt with its own text, not the last one opened', async () => {
    page();
    await screen.findByText('Extract prd');
    fireEvent.click(screen.getByLabelText('Edit Extract prd'));
    await screen.findByDisplayValue('Shipped wording for {projects}');
    fireEvent.click(screen.getByText('Cancel'));

    fireEvent.click(screen.getByLabelText('Edit Agent system'));
    expect(await screen.findByDisplayValue('My wording')).toBeTruthy();
  });
});

describe('who may see it', () => {
  it('sends a manager away', () => {
    page('manager');
    expect(screen.queryByText('Prompts')).toBeNull();
    expect(listPrompts).not.toHaveBeenCalled();
  });
});


describe('placeholders in the editor', () => {
  it('blocks Save and says which name nothing fills in', async () => {
    page();
    await screen.findByText('Extract prd');
    fireEvent.click(screen.getByLabelText('Edit Extract prd'));
    await screen.findByDisplayValue('Shipped wording for {projects}');

    fireEvent.change(screen.getByDisplayValue('Shipped wording for {projects}'), {
      target: { value: 'On failure return {"error": null}' },
    });

    const warning = screen.getByText(/Nothing fills in/);
    expect(warning.textContent).toContain('{"error"}');
    expect(warning.textContent).toContain('{{like this}}');
    expect((screen.getByText('Save prompt').closest('button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('accepts it once the braces are doubled into plain text', async () => {
    page();
    await screen.findByText('Extract prd');
    fireEvent.click(screen.getByLabelText('Edit Extract prd'));
    await screen.findByDisplayValue('Shipped wording for {projects}');

    fireEvent.change(screen.getByDisplayValue('Shipped wording for {projects}'), {
      target: { value: 'On failure return {{"error": null}}' },
    });

    expect(screen.queryByText(/Nothing fills in/)).toBeNull();
    expect((screen.getByText('Save prompt').closest('button') as HTMLButtonElement).disabled).toBe(false);
  });

});


describe('a prompt whose placeholders live in the human turn', () => {
  // The wording being edited mentions none of them, so working the list out
  // from that wording found none and rejected every placeholder — including
  // the ones the server accepts. Save was disabled with no way forward.
  const humanTurn = [{
    key: 'GENERATE_DESCRIPTION_PROMPT',
    body: 'Write a description.',
    defaultBody: 'Write a description.',
    placeholders: ['context', 'project_name', 'section_name', 'title'],
    isCustom: false,
  }];

  it('accepts a placeholder the shipped wording never mentions', async () => {
    listPrompts.mockResolvedValue(humanTurn);
    page();
    await screen.findByText('Generate description');
    fireEvent.click(screen.getByLabelText('Edit Generate description'));
    await screen.findByDisplayValue('Write a description.');

    fireEvent.change(screen.getByDisplayValue('Write a description.'), {
      target: { value: 'Write a long description for {title} in {project_name}.' },
    });

    expect(screen.queryByText(/Nothing fills in/)).toBeNull();
    expect((screen.getByText('Save prompt').closest('button') as HTMLButtonElement).disabled).toBe(false);
  });

  it('lists what it may use, so the writer does not have to guess', async () => {
    listPrompts.mockResolvedValue(humanTurn);
    page();
    await screen.findByText('Generate description');
    fireEvent.click(screen.getByLabelText('Edit Generate description'));
    await screen.findByDisplayValue('Write a description.');
    expect(screen.getByText(/\{context\}, \{project_name\}/)).toBeTruthy();
  });

  it('still refuses a name nothing supplies', async () => {
    listPrompts.mockResolvedValue(humanTurn);
    page();
    await screen.findByText('Generate description');
    fireEvent.click(screen.getByLabelText('Edit Generate description'));
    await screen.findByDisplayValue('Write a description.');

    fireEvent.change(screen.getByDisplayValue('Write a description.'), {
      target: { value: 'Use {made_up_name}' },
    });
    expect(screen.getByText(/Nothing fills in/)).toBeTruthy();
    expect((screen.getByText('Save prompt').closest('button') as HTMLButtonElement).disabled).toBe(true);
  });
});
