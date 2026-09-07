import { readFileSync } from 'node:fs';
import { test as base, expect, type Page } from '@playwright/test';
import { API, TOKEN_FILE } from './support-const';

export { API };

const token = () => readFileSync(TOKEN_FILE, 'utf8');

/** Collects anything the browser complained about, for the report. */
export function watchConsole(page: Page) {
  const problems: string[] = [];
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/\[vite\]|favicon|React DevTools/i.test(t)) return;
    problems.push(t);
  });
  page.on('pageerror', e => problems.push(`uncaught: ${e.message}`));
  page.on('requestfailed', r => {
    const f = r.failure()?.errorText ?? '';
    if (/ERR_ABORTED/.test(f)) return;
    problems.push(`request failed: ${r.method()} ${r.url()} — ${f}`);
  });
  return problems;
}

/** The dashboard, signed in and settled. */
export async function openDashboard(page: Page) {
  await page.addInitScript(t => localStorage.setItem('tm_token', t as string), token());
  await page.goto('/');
  await page.waitForURL(u => !u.pathname.includes('/login'), { timeout: 20_000 });
  await page.waitForLoadState('networkidle');
}

/**
 * Opens the toolbar by actually moving the pointer onto it.
 *
 * `hover({force:true})` looked equivalent but is not: it dispatches at a point
 * without moving the mouse there, so the row's mouseenter fires and then the
 * next real click elsewhere reads as the pointer leaving, which collapses the
 * bar mid-action. Moving for real leaves the cursor inside the row, which is
 * what a person does.
 */
export async function openToolbar(page: Page) {
  const field = page.locator('.tb-field');
  const box = await field.boundingBox();
  if (!box) throw new Error('toolbar search control not found');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 10 });
  await expect(page.getByLabel('All people')).toBeVisible({ timeout: 8000 });
}

/**
 * Clicks an option inside the popover that is currently open.
 *
 * Radix portals its content to the end of <body>, so a page-wide
 * `getByText('Urgent')` matches a task card's own priority label first and
 * clicks that instead — which opens a cell editor and hangs the test. Scoping
 * to the popper wrapper is the difference between testing the filter and
 * testing a random row.
 */
export async function pickOption(page: Page, name: string | RegExp) {
  const popover = page.locator('[data-radix-popper-content-wrapper]').last();
  await popover.getByRole('button', { name }).first().click();
}

/** The board's own column drag handles, which carry no accessible name. */
export const boardColumnGrips = (page: Page) =>
  page.locator('[class*="cursor-grab"]:has(svg.lucide-grip-vertical)');

export const test = base;
export { expect };
