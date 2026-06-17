import {
  AuthError,
  BrowserAuthError,
  BrowserAuthErrorCodes,
  PublicClientApplication,
  ServerError,
  type Configuration,
} from '@azure/msal-browser';
import type { Role } from '@/types';
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
  role?: Role;
  jobTitle?: string;
  experienceMonths?: number;
};

/**
 * Call once before React mounts. Consumes `#code=...` / hash from the redirect return
 * (main window or popup) before BrowserRouter / Navigate can replace the URL.
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
    if (!result?.idToken?.trim()) return;

    let flow: PendingMicrosoftAuth['flow'] = 'login';
    let rememberMe = false;
    let role: Role | undefined;
    let jobTitle: string | undefined;
    let experienceMonths: number | undefined;
    try {
      const raw = sessionStorage.getItem(OPTIONS_KEY);
      if (raw) {
        const o = JSON.parse(raw) as { flow?: string; rememberMe?: boolean; role?: Role; jobTitle?: string; experienceMonths?: number };
        if (o.flow === 'signup') flow = 'signup';
        if (typeof o.rememberMe === 'boolean') rememberMe = o.rememberMe;
        if (o.role === 'manager' || o.role === 'employee') role = o.role;
        if (typeof o.jobTitle === 'string') jobTitle = o.jobTitle;
        if (typeof o.experienceMonths === 'number') experienceMonths = o.experienceMonths;
      }
    } catch {
      /* use defaults */
    }
    sessionStorage.removeItem(OPTIONS_KEY);

    const pending: PendingMicrosoftAuth = {
      idToken: result.idToken.trim(),
      flow,
      rememberMe,
      role,
      jobTitle,
      experienceMonths,
    };
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  } catch (e) {
    console.error('MSAL initialize / handleRedirectPromise:', e);
  }
}

/** Pop and parse pending token from redirect completion (main runs `initializeMsalBeforeReact` first). */
export function consumePendingMicrosoftAuth(): PendingMicrosoftAuth | null {
  const raw = sessionStorage.getItem(PENDING_KEY);
  if (!raw) return null;
  sessionStorage.removeItem(PENDING_KEY);
  try {
    const p = JSON.parse(raw) as PendingMicrosoftAuth;
    if (!p.idToken?.trim()) return null;
    return p;
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
  role: Role,
  jobTitle = '',
  experienceMonths = 0,
): Promise<void> {
  if (!isMicrosoftAuthConfigured()) return;
  const pca = getMsalInstance();
  await pca.initialize();
  sessionStorage.setItem(OPTIONS_KEY, JSON.stringify({ flow: 'signup', rememberMe: false, role, jobTitle, experienceMonths }));
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
