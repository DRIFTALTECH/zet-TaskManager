import {
  requireApiUrl,
} from '../../env.defaults';

function trimOrUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

/** Absolute API origin from env — never the Vite `/api` rewrite. */
export function getConfiguredApiUrl(): string {
  return requireApiUrl(import.meta.env.VITE_API_URL);
}

function isRemoteApi(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname !== 'localhost' && hostname !== '127.0.0.1';
  } catch {
    return false;
  }
}

export function getApiUrl(): string {
  const configured = getConfiguredApiUrl();
  // Prod CORS only allows the deployed SPA. In Vite, same-origin `/api` avoids
  // that (and the "login then instantly logged out" loop from a 401/CORS mix).
  if (import.meta.env.DEV && isRemoteApi(configured)) {
    return '/api';
  }
  return configured;
}

/** Resolve a stored media reference for use in <img>: server-relative paths get
 *  the API origin prepended; data: and absolute http(s) URLs pass through. */
export function resolveMediaUrl(path?: string): string {
  if (!path) return '';
  if (path.startsWith('/')) return `${getApiUrl()}${path}`;
  return path;
}

export function getMicrosoftClientId(): string {
  return trimOrUndefined(import.meta.env.VITE_MICROSOFT_CLIENT_ID) ?? '';
}

export function getMicrosoftTenantId(): string {
  return trimOrUndefined(import.meta.env.VITE_MICROSOFT_TENANT_ID) ?? 'common';
}

export function isMicrosoftAuthConfigured(): boolean {
  return Boolean(getMicrosoftClientId());
}
