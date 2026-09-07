import { test, expect, openDashboard, openToolbar, watchConsole } from './support';

test.describe('dashboard toolbar', () => {
  test('loads the seeded board without console errors', async ({ page }) => {
    const problems = watchConsole(page);
    await openDashboard(page);
    await expect(page.getByText('Wire up export endpoint').first()).toBeVisible();
    expect(problems, `console problems:\n${problems.join('\n')}`).toEqual([]);
  });

  test('starts collapsed to the search ball and unfolds on hover', async ({ page }) => {
    await openDashboard(page);
    const field = page.locator('.tb-field');
    await expect(field).toHaveClass(/w-9/);
    await expect(field).toHaveClass(/tb-ball/);

    await openToolbar(page);
    await expect(field).toHaveClass(/w-\[min\(70vw,22rem\)\]/);
    await expect(page.getByLabel('All people')).toBeVisible();
  });

  test('the drifting ball never leaves the area you aim at', async ({ browser }) => {
    // The ball drifts to catch the eye, which makes it a moving target on the
    // one control that opens the whole toolbar. It keeps the motion, but the
    // row around it does not move and is padded to cover the whole travel, so
    // aiming at where the ball appears always lands on the hit area.
    const ctx = await browser.newContext({ reducedMotion: 'no-preference', viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await openDashboard(page);
    const field = page.locator('.tb-field');
    const row = field.locator('xpath=..');
    const hit = (await row.boundingBox())!;

    let worst = 0;
    for (let i = 0; i < 22; i++) {
      const b = (await field.boundingBox())!;
      worst = Math.max(worst, hit.x - b.x, (b.x + b.width) - (hit.x + hit.width));
      await page.waitForTimeout(250);
    }
    await ctx.close();
    expect(worst, 'ball drifts outside the stationary area the pointer aims at').toBeLessThanOrEqual(0);
  });

  test('the drift stops for good once the bar has been opened', async ({ browser }) => {
    // Ambient motion is only useful while the control still needs introducing.
    const ctx = await browser.newContext({ reducedMotion: 'no-preference', viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await openDashboard(page);
    const field = page.locator('.tb-field');
    await expect(field).toHaveClass(/tb-ball-drift/);
    await openToolbar(page);
    await page.mouse.move(10, 10);
    await expect(field).toHaveClass(/w-9/);
    await expect(field).not.toHaveClass(/tb-ball-drift/);
    await ctx.close();
  });

  test('shows a tooltip naming each icon', async ({ page }) => {
    await openDashboard(page);
    await openToolbar(page);
    await page.getByLabel('All priorities').hover();
    await expect(page.getByRole('tooltip')).toContainText('All priorities');
  });

  test('leads with the view switch and trails with the project picker', async ({ page }) => {
    await openDashboard(page);
    await openToolbar(page);
    const wings = page.locator('.tb-field').locator('xpath=..').locator('> span');
    await expect(wings.first()).toContainText('', { timeout: 5000 });
    const switchBox = await page.getByLabel(/Switch to (board|list) view/).boundingBox();
    const projectBox = await page.getByLabel(/^Project:/).boundingBox();
    const fieldBox = await page.locator('.tb-field').boundingBox();
    expect(switchBox!.x, 'view switch sits left of the search field').toBeLessThan(fieldBox!.x);
    expect(projectBox!.x, 'project picker sits right of the search field').toBeGreaterThan(fieldBox!.x);
  });

  test('search narrows the board and offers a chip to undo it', async ({ page }) => {
    await openDashboard(page);
    await openToolbar(page);
    await page.getByLabel('Search tasks and stories').fill('scheduler');
    await expect(page.getByText('Refactor scheduler').first()).toBeVisible();
    await expect(page.getByText('Wire up export endpoint')).toHaveCount(0);
    await expect(page.getByText('“scheduler”')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Clear all' })).toBeVisible();
  });

  test('Escape in the search box drops the query', async ({ page }) => {
    await openDashboard(page);
    await openToolbar(page);
    const box = page.getByLabel('Search tasks and stories');
    await box.fill('scheduler');
    await box.press('Escape');
    await expect(box).toHaveValue('');
    await expect(page.getByText('Wire up export endpoint').first()).toBeVisible();
  });

  test('stays open while a query is holding the board', async ({ page }) => {
    await openDashboard(page);
    const field = page.locator('.tb-field');
    await openToolbar(page);
    await page.getByLabel('Search tasks and stories').fill('scheduler');
    await page.getByText('Argus').first().hover({ force: true }).catch(() => {});
    await page.mouse.move(10, 10);
    await expect(field).toHaveClass(/w-\[min\(70vw,22rem\)\]/);
  });

  test('toggles between list and board', async ({ page }) => {
    await openDashboard(page);
    await openToolbar(page);
    await page.getByLabel('Switch to board view').click();
    await expect(page.getByLabel(/^Drag to reorder /).first()).toBeVisible();
    await openToolbar(page);
    await page.getByLabel('Switch to list view').click();
    await expect(page.getByLabel('Switch to board view')).toBeVisible();
    await expect(page.getByLabel('Drag to reorder this column').first()).toBeVisible();
  });
});
