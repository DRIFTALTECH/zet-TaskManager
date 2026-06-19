import {
  DEFAULT_API_URL,
  DEFAULT_MICROSOFT_CLIENT_ID,
  DEFAULT_MICROSOFT_TENANT_ID,
} from '../../env.defaults';

function trimOrUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

export function getApiUrl(): string {
  return (trimOrUndefined(import.meta.env.VITE_API_URL) ?? DEFAULT_API_URL).replace(/\/+$/, '');
}

/** Resolve a stored media reference for use in <img>: server-relative paths get
 *  the API origin prepended; data: and absolute http(s) URLs pass through. */
export function resolveMediaUrl(path?: string): string {
  if (!path) return '';
  if (path.startsWith('/')) return `${getApiUrl()}${path}`;
  return path;
}

export function getMicrosoftClientId(): string {
  return trimOrUndefined(import.meta.env.VITE_MICROSOFT_CLIENT_ID) ?? DEFAULT_MICROSOFT_CLIENT_ID;
}

export function getMicrosoftTenantId(): string {
  return trimOrUndefined(import.meta.env.VITE_MICROSOFT_TENANT_ID) ?? DEFAULT_MICROSOFT_TENANT_ID;
}

export function isMicrosoftAuthConfigured(): boolean {
  return Boolean(getMicrosoftClientId());
}
