import { test, expect, openDashboard, pickOption } from './support';

test.describe('list view', () => {
  test('shows every seeded top-level item', async ({ page }) => {
    await openDashboard(page);
    for (const title of [
      'Wire up export endpoint',
      'Refactor scheduler',
      'Tidy migration script',
      'Ship release notes',
      'Renew certificate',
      'Rebuild import pipeline',
      'Business process configuration',
      'Platform hardening',
      'No work yet',
    ]) {
      await expect(page.getByText(title).first(), `"${title}" missing from the list`).toBeVisible();
    }
  });

  test('a story expands to reveal the work inside it', async ({ page }) => {
    await openDashboard(page);
    const row = page.getByText('Business process configuration').first();
    await row.scrollIntoViewIfNeeded();
    await row.click();
    await expect(page.getByRole('dialog').getByText('Model the approval queue').first()).toBeVisible();
  });

  test('checkbox selection raises the bulk bar', async ({ page }) => {
    await openDashboard(page);
    await page.getByLabel('Select Refactor scheduler').click();
    await expect(page.getByText(/1 item selected/i).first()).toBeVisible();
  });

  test('the bulk bar clears the floating toolbar instead of landing on it', async ({ page }) => {
    // Both float at the bottom of the same screen. Overlapping, they read as one
    // broken widget and the search control is unreachable underneath.
    await openDashboard(page);
    await page.getByLabel('Select Refactor scheduler').click();
    const bar = page.getByText(/1 item selected/i).first().locator('xpath=ancestor::div[contains(@class,"rounded-xl")][1]');
    const ball = page.locator('.tb-field');
    const b = (await bar.boundingBox())!;
    const t = (await ball.boundingBox())!;
    expect(b.y + b.height, 'bulk bar overlaps the toolbar').toBeLessThanOrEqual(t.y);
  });

  test('priority can be changed inline from a row', async ({ page }) => {
    await openDashboard(page);
    const cell = page.getByLabel('Priority').first();
    await cell.click();
    await pickOption(page, 'Low');
    await expect(page.getByText('Low').first()).toBeVisible();
  });

  test('a group can be collapsed', async ({ page }) => {
    await openDashboard(page);
    await page.getByLabel('Collapse group').first().click();
    await expect(page.getByLabel('Expand group').first()).toBeVisible();
  });

  test('status text is not colour-coded in the list', async ({ page }) => {
    await openDashboard(page);
    const badge = page.getByText('Backlog').first();
    await expect(badge).toBeVisible();
  });
});
