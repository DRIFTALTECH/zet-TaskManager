import { describe, it, expect, beforeEach, vi } from 'vitest';

// getApiUrl() throws when VITE_API_URL is unset, which would make every
// assertion below pass for the wrong reason (the request never happens).
vi.stubEnv('VITE_API_URL', 'http://localhost:8000');

// Exercise the real bootstrap logic against a stubbed fetch, since the whole
// question is "which failures end the session".
const TOKEN_KEY = 'tm_token';

async function freshStore() {
  vi.resetModules();
  const { useAppStore } = await import('@/stores/appStore');
  return useAppStore;
}

function jsonRes(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, statusText: 'x' } as Response;
}

describe('bootstrap session handling', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(TOKEN_KEY, 'existing-jwt');
  });

  it('keeps the token when the server is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const useAppStore = await freshStore();
    await useAppStore.getState().bootstrap();
    expect(localStorage.getItem(TOKEN_KEY)).toBe('existing-jwt');
    expect(useAppStore.getState().bootstrapError).toBeTruthy();
  });

  it('keeps the token on a 500', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonRes({ detail: 'boom' }, 500)));
    const useAppStore = await freshStore();
    await useAppStore.getState().bootstrap();
    expect(localStorage.getItem(TOKEN_KEY)).toBe('existing-jwt');
    expect(useAppStore.getState().bootstrapError).toBeTruthy();
  });

  it('clears the token on a 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonRes({ detail: 'Token expired' }, 401)));
    const useAppStore = await freshStore();
    await useAppStore.getState().bootstrap();
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(useAppStore.getState().currentUser).toBeNull();
  });
});
