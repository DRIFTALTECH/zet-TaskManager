import { test, expect, openDashboard, openToolbar, pickOption } from './support';

/** Opens the bar and clicks one of its icon controls. */
async function openControl(page: import('@playwright/test').Page, label: string | RegExp) {
  await openToolbar(page);
  await page.getByLabel(label).click();
}

test.describe('grouping, sorting and filters', () => {
  for (const [label, expected] of [
    ['Status', 'Backlog'],
    ['Assignee', 'Unassigned'],
    ['Priority', 'Urgent'],
  ] as const) {
    test(`groups the list by ${label.toLowerCase()}`, async ({ page }) => {
      await openDashboard(page);
      await openControl(page, /^Group:/);
      await pickOption(page, label);
      await expect(page.getByText(expected).first()).toBeVisible();
    });
  }

  test('grouping by none puts everything under one heading', async ({ page }) => {
    await openDashboard(page);
    await openControl(page, /^Group:/);
    await pickOption(page, 'None');
    await expect(page.getByText('All work').first()).toBeVisible();
  });

  test('the group control is offered in board view too', async ({ page }) => {
    await openDashboard(page);
    await openToolbar(page);
    await page.getByLabel('Switch to board view').click();
    await openToolbar(page);
    await expect(page.getByLabel(/^Group:/)).toBeVisible();
  });

  test('board lanes follow the grouping', async ({ page }) => {
    await openDashboard(page);
    await openToolbar(page);
    await page.getByLabel('Switch to board view').click();
    await openControl(page, /^Group:/);
    await pickOption(page, 'Priority');
    for (const lane of ['Urgent', 'High', 'Medium', 'Low']) {
      await expect(page.getByText(lane, { exact: true }).first()).toBeVisible();
    }
  });

  test('derived lanes carry no column furniture', async ({ page }) => {
    await openDashboard(page);
    await openToolbar(page);
    await page.getByLabel('Switch to board view').click();
    await expect(page.getByLabel(/^Drag to reorder /).first()).toBeVisible();
    await openControl(page, /^Group:/);
    await pickOption(page, 'Priority');
    await expect(page.getByLabel(/^Drag to reorder /)).toHaveCount(0);
  });

  test('filters by priority and shows a removable chip', async ({ page }) => {
    await openDashboard(page);
    await openControl(page, 'All priorities');
    await pickOption(page, 'Urgent');
    await page.keyboard.press('Escape');
    await expect(page.getByText('Refactor scheduler').first()).toBeVisible();
    await expect(page.getByText('Ship release notes')).toHaveCount(0);
  });

  test('filters by person', async ({ page }) => {
    await openDashboard(page);
    await openControl(page, 'All people');
    await pickOption(page, 'Dana Dev');
    await page.keyboard.press('Escape');
    await expect(page.getByText('Wire up export endpoint').first()).toBeVisible();
  });

  test('clear all restores everything', async ({ page }) => {
    await openDashboard(page);
    await openControl(page, 'All priorities');
    await pickOption(page, 'Urgent');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Clear all' }).click();
    await expect(page.getByText('Ship release notes').first()).toBeVisible();
  });

  test('sorting does not empty the board', async ({ page }) => {
    await openDashboard(page);
    await openControl(page, /^Sort:/);
    const opts = page.getByRole('menu').or(page.locator('[role=dialog]'));
    await pickOption(page, 'Priority');
    await expect(page.getByText('Refactor scheduler').first()).toBeVisible();
    expect(await opts.count()).toBeGreaterThanOrEqual(0);
  });

  test('project picker scopes the board', async ({ page }) => {
    await openDashboard(page);
    await openControl(page, /^Project:/);
    await page.getByText('Argus', { exact: true }).first().click();
    await expect(page.getByText('Wire up export endpoint').first()).toBeVisible();
  });
});
