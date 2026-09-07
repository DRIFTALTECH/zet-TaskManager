import { defineConfig, devices } from '@playwright/test';

/**
 * Dashboard end-to-end run.
 *
 * Points at a stack started by hand against a throwaway SQLite database, never
 * Aurora. Serial and single-worker on purpose: these tests share one seeded
 * project, and a parallel run would have them editing each other's cards.
 */
export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: 'e2e-results.json' }]],
  use: {
    baseURL: 'http://127.0.0.1:8081',
    trace: 'off',
    screenshot: 'only-on-failure',
    viewport: { width: 1440, height: 900 },
    // The collapsed toolbar control drifts forever, so the runner never sees it
    // hold still and hovering it is a coin flip. The app honours this setting by
    // stopping the drift, which makes every other test deterministic; the drift
    // itself is measured in its own test under a context that does not set it.
    reducedMotion: 'reduce',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
