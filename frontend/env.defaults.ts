const MISSING_API_URL_MSG =
  'VITE_API_URL is not set. Configure it in frontend/.env.development (vite dev) ' +
  'or frontend/.env.production (vite build), or export it in the environment.';

/** Shared API URL resolution for runtime (getApiUrl) and vite.config dev proxy. */
export function requireApiUrl(viteApiUrl: string | undefined): string {
  const url = viteApiUrl?.trim();
  if (!url) {
    throw new Error(MISSING_API_URL_MSG);
  }
  return url.replace(/\/+$/, '');
}
