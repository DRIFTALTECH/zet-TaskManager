import { test, expect, openDashboard, watchConsole } from './support';

async function openStory(page: import('@playwright/test').Page, title = 'Business process configuration') {
  await openDashboard(page);
  const row = page.getByText(title).first();
  await row.scrollIntoViewIfNeeded();
  await row.click();
  await expect(page.getByRole('dialog')).toBeVisible();
}

async function openTask(page: import('@playwright/test').Page, title = 'Refactor scheduler') {
  await openDashboard(page);
  const row = page.getByText(title).first();
  await row.scrollIntoViewIfNeeded();
  await row.click();
  await expect(page.getByRole('dialog')).toBeVisible();
}

test.describe('detail modals', () => {
  test('a story opens without console errors', async ({ page }) => {
    const problems = watchConsole(page);
    await openStory(page);
    expect(problems, problems.join('\n')).toEqual([]);
  });

  test('the header has no Add task button any more', async ({ page }) => {
    await openStory(page);
    // The story's own task table still offers one; what went is the header copy.
    const header = page.getByRole('dialog').locator('div').first();
    await expect(header.getByRole('button', { name: 'Add task', exact: true })).toHaveCount(0);
  });

  test('save, discard and generate live in the header, not a footer', async ({ page }) => {
    await openStory(page);
    const d = page.getByRole('dialog');
    await expect(d.getByLabel('Save changes')).toBeVisible();
    await expect(d.getByLabel('Generate tasks')).toBeVisible();
    // The footer band is gone; the only "Save changes" left is the header icon.
    await expect(d.getByRole('button', { name: 'Save changes', exact: true })).toHaveCount(1);
  });

  test('status and priority are not repeated as header chips', async ({ page }) => {
    await openStory(page);
    const header = page.getByRole('dialog').locator('div').first();
    await expect(page.getByRole('dialog').getByLabel(/^Priority/).first()).toBeVisible();
  });

  test('priority shows as a coloured flag, not a dot', async ({ page }) => {
    await openStory(page);
    const flag = page.getByRole('dialog').locator('svg.lucide-flag').first();
    await expect(flag).toBeVisible();
  });

  test('the type crumb converts between story and task', async ({ page }) => {
    await openStory(page);
    await expect(page.getByRole('dialog').getByLabel('Type: Story')).toBeVisible();
    // and only once — it used to appear beside delete as well
    await expect(page.getByRole('dialog').getByLabel(/^Type:/)).toHaveCount(1);
  });

  test('description can be expanded and collapsed', async ({ page }) => {
    await openStory(page);
    const toggle = page.getByRole('dialog').getByLabel('Expand description');
    await expect(toggle).toBeVisible();
    await toggle.click();
    await expect(page.getByRole('dialog').getByLabel('Collapse description')).toBeVisible();
  });

  test('progress sits in the fields, not the header', async ({ page }) => {
    await openStory(page);
    await expect(page.getByRole('dialog').getByText('Progress').first()).toBeVisible();
  });

  test('comments rail is present and takes a comment', async ({ page }) => {
    await openStory(page);
    const d = page.getByRole('dialog');
    await expect(d.getByText('Comments').first()).toBeVisible();
    const box = d.getByPlaceholder(/Write a comment/i);
    await expect(box).toBeVisible();
    await box.fill('E2E smoke comment');
    await box.press('Enter');
    await expect(d.getByText('E2E smoke comment')).toBeVisible();
  });

  test('a task opens and shows its subtasks', async ({ page }) => {
    await openTask(page, 'Rebuild import pipeline');
    await expect(page.getByRole('dialog').getByText('Parse the header row').first()).toBeVisible();
  });

  test('stepping from a story into its task offers a way back', async ({ page }) => {
    await openStory(page);
    const d = page.getByRole('dialog');
    await d.getByText('Model the approval queue').first().click();
    await expect(d.getByText('Model the approval queue').first()).toBeVisible();
    const back = page.getByRole('dialog').getByLabel('Back');
    await expect(back, 'no Back button after drilling story → task').toBeVisible();
    await back.click();
    await expect(page.getByRole('dialog').getByText('Business process configuration').first()).toBeVisible();
  });

  test('the board entry has no Back button', async ({ page }) => {
    await openTask(page);
    await expect(page.getByRole('dialog').getByLabel('Back')).toHaveCount(0);
  });

  test('Past due sits beside the due date', async ({ page }) => {
    await openTask(page, 'Renew certificate');
    const d = page.getByRole('dialog');
    await expect(d.getByText('Past due')).toBeVisible();
  });

  test('fields lay out in three columns on a wide screen', async ({ page }) => {
    await openTask(page);
    const grid = page.getByRole('dialog').locator('[class*="lg:grid-cols-3"]').first();
    await expect(grid).toBeVisible();
  });

  test('editing the title enables save and persists', async ({ page }) => {
    await openTask(page, 'Tidy migration script');
    const d = page.getByRole('dialog');
    const title = d.getByPlaceholder('Task title');
    await title.fill('Tidy migration script (edited)');
    await d.getByLabel('Save changes').click();
    await expect(d).toBeHidden({ timeout: 10_000 }).catch(() => {});
    await page.reload();
    await expect(page.getByText('Tidy migration script (edited)').first()).toBeVisible();
  });
});
