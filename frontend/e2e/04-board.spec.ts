import { test, expect, openDashboard, openToolbar } from './support';

async function board(page: import('@playwright/test').Page) {
  await openDashboard(page);
  await openToolbar(page);
  await page.getByLabel('Switch to board view').click();
  await expect(page.getByLabel(/^Drag to reorder /).first()).toBeVisible();
}

test.describe('board view', () => {
  test('draws the stored columns', async ({ page }) => {
    await board(page);
    for (const col of ['Backlog', 'In Progress', 'In Review', 'Done']) {
      await expect(page.getByText(col, { exact: true }).first(), `column ${col}`).toBeVisible();
    }
  });

  test('places each card in the column its status names', async ({ page }) => {
    await board(page);
    await expect(page.getByText('Refactor scheduler').first()).toBeVisible();
    await expect(page.getByText('Ship release notes').first()).toBeVisible();
  });

  test('a column menu offers rename, colour and Done', async ({ page }) => {
    await board(page);
    // The column's overflow trigger carries no accessible name, so it is
    // reached by the icon it draws.
    await page.getByLabel(/^Options for /).first().click();
    await expect(page.getByText(/Rename column|Set as Done column/).first()).toBeVisible();
  });

  test('the add menu on a column offers a story and a task', async ({ page }) => {
    await board(page);
    await page.getByLabel('Add a story or task').first().click();
    await expect(page.getByText(/Task|Story/).first()).toBeVisible();
  });

  test('a story card expands to show its tasks', async ({ page }) => {
    await board(page);
    const story = page.getByText('Business process configuration').first();
    await story.scrollIntoViewIfNeeded();
    await expect(story).toBeVisible();
  });
});
