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

export function getMicrosoftClientId(): string {
  return trimOrUndefined(import.meta.env.VITE_MICROSOFT_CLIENT_ID) ?? DEFAULT_MICROSOFT_CLIENT_ID;
}

export function getMicrosoftTenantId(): string {
  return trimOrUndefined(import.meta.env.VITE_MICROSOFT_TENANT_ID) ?? DEFAULT_MICROSOFT_TENANT_ID;
}

export function isMicrosoftAuthConfigured(): boolean {
  return Boolean(getMicrosoftClientId());
}
