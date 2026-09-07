import { writeFileSync } from 'node:fs';
import { API, ADMIN, TOKEN_FILE } from './support-const';

/**
 * One login for the whole run.
 *
 * Logging in per test tripped the API's own per-IP rate limit after six or so
 * tests, and every later test failed with 429 — a harness artefact that looks
 * exactly like a broken app.
 */
export default async function globalSetup() {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ADMIN),
  });
  if (!res.ok) throw new Error(`E2E login failed: ${res.status} ${await res.text()}`);
  const { access_token } = await res.json();
  writeFileSync(TOKEN_FILE, access_token, 'utf8');
}
