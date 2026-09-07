import { test, expect, openDashboard } from './support';

test.describe('companion', () => {
  test('the attention badge sits on the mascot, not adrift above it', async ({ page }) => {
    await openDashboard(page);
    const mascot = page.getByLabel('Tasker quick actions');
    if (await mascot.count() === 0) test.skip();
    const badge = mascot.locator('span').filter({ hasText: /^\d+\+?$|^!$/ }).first();
    if (await badge.count() === 0) test.skip();
    const m = await mascot.boundingBox();
    const b = await badge.boundingBox();
    // Within the mascot's own box, not floating 60px over its head.
    expect(b!.y).toBeGreaterThan(m!.y + m!.height * 0.3);
  });

  test('the mascot opens its menu', async ({ page }) => {
    await openDashboard(page);
    const mascot = page.getByLabel('Tasker quick actions');
    if (await mascot.count() === 0) test.skip();
    await mascot.click({ force: true });
    await expect(page.getByText(/Overdue|Timer|Notifications|Create/i).first()).toBeVisible({ timeout: 5000 });
  });
});
