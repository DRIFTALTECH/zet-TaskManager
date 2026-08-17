import {
  AuthError,
  BrowserAuthError,
  BrowserAuthErrorCodes,
  PublicClientApplication,
  ServerError,
  type AuthenticationResult,
  type Configuration,
} from '@azure/msal-browser';
import {
  getMicrosoftClientId,
  getMicrosoftTenantId,
  isMicrosoftAuthConfigured,
} from '@/lib/env';

export { isMicrosoftAuthConfigured };

function clientId(): string {
  return getMicrosoftClientId();
}

let instance: PublicClientApplication | null = null;

function getMsalInstance(): PublicClientApplication {
  if (!instance) {
    const tenantId = getMicrosoftTenantId();
    const config: Configuration = {
      auth: {
        clientId: clientId(),
        authority: `https://login.microsoftonline.com/${tenantId}`,
        redirectUri: typeof window !== 'undefined' ? `${window.location.origin}/` : '/',
        // Do NOT let MSAL navigate back to the page that started the login.
        // It did a full-page GET of that path (e.g. /login), which a static host
        // 404s unless it rewrites unknown paths to index.html — killing the
        // sign-in before the app even mounted. We consume the pending token in
        // MsalRedirectResume and route with React Router instead, which is both
        // reliable and avoids a second full page load.
        navigateToLoginRequestUrl: false,
      },
      cache: {
        cacheLocation: 'sessionStorage',
        storeAuthStateInCookie: false,
      },
    };
    instance = new PublicClientApplication(config);
  }
  return instance;
}

/** Set on the app origin tab immediately before `login*` redirects to Microsoft. */
const OPTIONS_KEY = '__zet_msal_redirect_opts';
/** Written in bootstrap after `handleRedirectPromise` resolves with tokens. */
const PENDING_KEY = '__zet_msal_pending_token';

export type PendingMicrosoftAuth = {
  idToken: string;
  flow: 'login' | 'signup';
  rememberMe: boolean;
  jobTitle?: string;
  experienceMonths?: number;
};

/** Compact JWT check — Entra ID tokens are long `header.payload.sig` strings. */
function isOidcJwt(token: string | undefined | null): token is string {
  const t = token?.trim() ?? '';
  return t.length >= 100 && t.split('.').length === 3;
}

/**
 * Prefer `result.idToken`; if missing/malformed, silently refresh OIDC scopes
 * so we never POST an access token / auth code to the backend.
 */
async function resolveIdToken(
  pca: PublicClientApplication,
  result: AuthenticationResult,
): Promise<string | null> {
  if (isOidcJwt(result.idToken)) return result.idToken.trim();
  if (!result.account) return null;
  try {
    const silent = await pca.acquireTokenSilent({
      account: result.account,
      scopes: ['openid', 'profile', 'email'],
      forceRefresh: true,
    });
    if (isOidcJwt(silent.idToken)) return silent.idToken.trim();
  } catch (e) {
    console.error('MSAL acquireTokenSilent for id token failed:', e);
  }
  return null;
}

/**
 * Call once before React mounts. Consumes `#code=...` / hash from the redirect return
 * (main window or popup) before BrowserRouter / Navigate can replace the URL.
 *
 * `initialize()` is always awaited, even with no redirect to process: it is cheap
 * (it sets up storage and crypto — OIDC metadata is fetched lazily during token
 * requests, not here) and `hasMicrosoftSession()` reads the account cache
 * synchronously during render, so MSAL must be ready before React mounts.
 */
export async function initializeMsalBeforeReact(): Promise<void> {
  if (!isMicrosoftAuthConfigured()) return;
  let pca: PublicClientApplication;
  try {
    pca = getMsalInstance();
  } catch {
    return;
  }
  try {
    await pca.initialize();
    const result = await pca.handleRedirectPromise();
    if (!result) return;

    const idToken = await resolveIdToken(pca, result);
    if (!idToken) {
      console.error('MSAL redirect completed but no usable ID token was returned.');
      return;
    }

    let flow: PendingMicrosoftAuth['flow'] = 'login';
    let rememberMe = false;
    let jobTitle: string | undefined;
    let experienceMonths: number | undefined;
    try {
      const raw = sessionStorage.getItem(OPTIONS_KEY);
      if (raw) {
        const o = JSON.parse(raw) as { flow?: string; rememberMe?: boolean; jobTitle?: string; experienceMonths?: number };
        if (o.flow === 'signup') flow = 'signup';
        if (typeof o.rememberMe === 'boolean') rememberMe = o.rememberMe;
        if (typeof o.jobTitle === 'string') jobTitle = o.jobTitle;
        if (typeof o.experienceMonths === 'number') experienceMonths = o.experienceMonths;
      }
    } catch {
      /* use defaults */
    }
    sessionStorage.removeItem(OPTIONS_KEY);

    const pending: PendingMicrosoftAuth = {
      idToken,
      flow,
      rememberMe,
      jobTitle,
      experienceMonths,
    };
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  } catch (e) {
    console.error('MSAL initialize / handleRedirectPromise:', e);
  }
}

/** True when a redirect token is waiting to be exchanged — lets the UI keep a
 *  "signing you in" state up instead of flashing the login page. */
export function hasPendingMicrosoftAuth(): boolean {
  return !!sessionStorage.getItem(PENDING_KEY);
}

/** Pop and parse pending token from redirect completion (main runs `initializeMsalBeforeReact` first). */
export function consumePendingMicrosoftAuth(): PendingMicrosoftAuth | null {
  const raw = sessionStorage.getItem(PENDING_KEY);
  if (!raw) return null;
  sessionStorage.removeItem(PENDING_KEY);
  try {
    const p = JSON.parse(raw) as PendingMicrosoftAuth;
    if (!isOidcJwt(p.idToken)) return null;
    return { ...p, idToken: p.idToken.trim() };
  } catch {
    return null;
  }
}

function redirectRequest() {
  return {
    scopes: ['openid', 'profile', 'email'] as string[],
    prompt: 'select_account' as const,
  };
}

/** Full-page redirect to Microsoft. Page unload follows — only call from user gestures. */
export async function signInWithMicrosoftRedirect(rememberMe: boolean): Promise<void> {
  if (!isMicrosoftAuthConfigured()) return;
  const pca = getMsalInstance();
  await pca.initialize();
  sessionStorage.setItem(OPTIONS_KEY, JSON.stringify({ flow: 'login', rememberMe }));
  await pca.loginRedirect(redirectRequest());
}

export async function signUpWithMicrosoftRedirect(
  jobTitle = '',
  experienceMonths = 0,
): Promise<void> {
  if (!isMicrosoftAuthConfigured()) return;
  const pca = getMsalInstance();
  await pca.initialize();
  sessionStorage.setItem(OPTIONS_KEY, JSON.stringify({ flow: 'signup', rememberMe: false, jobTitle, experienceMonths }));
  await pca.loginRedirect(redirectRequest());
}

/**
 * Returns true if there is an active Microsoft account in the MSAL cache
 * (i.e. the user signed in via Microsoft this session).
 */
export function hasMicrosoftSession(): boolean {
  if (!isMicrosoftAuthConfigured()) return false;
  try {
    return getMsalInstance().getAllAccounts().length > 0;
  } catch {
    return false;
  }
}

/**
 * Acquires a Microsoft Graph access token scoped to Mail.Send.
 * Tries a silent refresh first; falls back to a popup for incremental consent
 * (needed the first time, or after consent is revoked).
 *
 * Throws if:
 *  - Microsoft auth is not configured
 *  - No MSAL account exists (user did not sign in via Microsoft)
 *  - The user cancels the consent popup
 */
export async function acquireGraphToken(): Promise<string> {
  if (!isMicrosoftAuthConfigured()) {
    throw new Error('Microsoft sign-in is not configured. Set VITE_MICROSOFT_CLIENT_ID in frontend/.env.');
  }
  const pca = getMsalInstance();
  await pca.initialize();
  const accounts = pca.getAllAccounts();
  if (accounts.length === 0) {
    throw new Error(
      'No Microsoft account found. Sign out and sign back in using the "Sign in with Microsoft" button.',
    );
  }
  const request = {
    scopes: ['https://graph.microsoft.com/Mail.Send'],
    account: accounts[0],
  };
  try {
    const result = await pca.acquireTokenSilent(request);
    return result.accessToken;
  } catch {
    // Silent refresh failed (no cached token or consent not yet given) → popup
    const result = await pca.acquireTokenPopup(request);
    return result.accessToken;
  }
}

export function formatMsalAuthError(e: unknown): string {
  if (e instanceof BrowserAuthError && e.errorCode === BrowserAuthErrorCodes.userCancelled) {
    return '';
  }
  if (e instanceof ServerError) {
    return `${e.errorCode}: ${e.errorMessage}`.trim();
  }
  if (e instanceof AuthError) {
    return `${e.errorCode}: ${e.errorMessage}`.trim();
  }
  if (e instanceof Error) return e.message;
  return 'Microsoft sign-in failed.';
}
