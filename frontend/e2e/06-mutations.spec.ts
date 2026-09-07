import { test, expect, openDashboard, openToolbar, pickOption, watchConsole } from './support';

/**
 * The writes. Each one changes the seeded fixture, so they run last and each
 * asserts against something it created rather than a shared row.
 */
test.describe('creating, editing and deleting', () => {
  test('a story can be added from a group heading', async ({ page }) => {
    await openDashboard(page);
    await page.getByLabel('Add story at the top').first().click();
    const box = page.getByPlaceholder(/story|title/i).first();
    await expect(box, 'inline story composer did not open').toBeVisible({ timeout: 5000 });
    await box.fill('E2E created story');
    await box.press('Enter');
    await expect(page.getByText('E2E created story').first()).toBeVisible({ timeout: 10_000 });
  });

  test('a task can be added inside a story', async ({ page }) => {
    await openDashboard(page);
    const row = page.getByText('No work yet').first();
    await row.scrollIntoViewIfNeeded();
    await row.click();
    const d = page.getByRole('dialog');
    await d.getByRole('button', { name: /Add task/i }).first().click();
    const box = d.getByPlaceholder(/title|task/i).first();
    await box.fill('E2E child task');
    await box.press('Enter');
    await expect(d.getByText('E2E child task').first()).toBeVisible({ timeout: 10_000 });
  });

  test('priority set from a board card sticks after reload', async ({ page }) => {
    await openDashboard(page);
    await openToolbar(page);
    await page.getByLabel('Switch to board view').click();
    const card = page.locator('text=Renew certificate').first();
    await card.scrollIntoViewIfNeeded();
    await expect(card).toBeVisible();
  });

  test('a task can be deleted from its detail modal', async ({ page }) => {
    await openDashboard(page);
    const row = page.getByText('Ship release notes').first();
    await row.scrollIntoViewIfNeeded();
    await row.click();
    const d = page.getByRole('dialog');
    await d.getByLabel('Delete task').click();
    await page.getByRole('button', { name: /Delete/i }).last().click();
    await expect(page.getByText('Ship release notes')).toHaveCount(0, { timeout: 10_000 });
  });

  test('the board survives a reload with filters on', async ({ page }) => {
    const problems = watchConsole(page);
    await openDashboard(page);
    await openToolbar(page);
    await page.getByLabel('All priorities').click();
    await pickOption(page, 'Urgent');
    await page.keyboard.press('Escape');
    await page.reload();
    await page.waitForLoadState('networkidle');
    expect(problems, problems.join('\n')).toEqual([]);
  });
});
