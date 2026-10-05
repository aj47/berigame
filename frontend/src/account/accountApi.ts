import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { SPACETIME_DB, SPACETIME_URI, TOKEN_KEY } from '../spacetime/connection';
import { expiryKey, renewKey, RENEW_TOKEN } from '../spacetime/visitRenewal';

/**
 * Player accounts (Worker gateway only). An account token (`bgu_`) unlocks the
 * saved character on any browser; it lives next to the character token in
 * this browser's scoped localStorage and is never logged.
 */
export const ACCOUNT_KEY = `${TOKEN_KEY}:account`;
const OAUTH_INTENT_KEY = 'berigame-account-oauth-intent';
const EMAIL_INTENT_KEY = 'berigame-account-email-intent';
const BASE = '/api/play/v1/account';
const ACCOUNT_TOKEN = /^bgu_[A-Za-z0-9_-]{43}$/;

export type Intent = 'login' | 'save' | 'add';
export type LoginMethod = 'discord' | 'google' | 'email' | 'passkey';
export type Providers = Record<LoginMethod, boolean>;
export type AccountLogin = { provider: LoginMethod; id: string; label: string; createdAt: string };
export type Account = { playerId: string | null; logins: AccountLogin[] };
export const accountsEnabled = (import.meta as any).env?.VITE_INVITE_REQUIRED === 'true';

const read = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
export const accountToken = () => { const token = read(ACCOUNT_KEY); return token && ACCOUNT_TOKEN.test(token) ? token : null; };

async function call<T>(path: string, init: { body?: unknown; auth?: string | null; method?: string } = {}): Promise<T> {
  const response = await fetch(BASE + path, {
    method: init.method ?? 'POST', cache: 'no-store', credentials: 'same-origin',
    headers: { ...(init.method === 'GET' ? {} : { 'Content-Type': 'application/json' }), ...(init.auth ? { Authorization: `Bearer ${init.auth}` } : {}) },
    body: init.method === 'GET' ? undefined : JSON.stringify(init.body ?? {}),
  });
  const data = response.status === 204 ? undefined : await response.json().catch(() => undefined);
  if (!response.ok) {
    const error = new Error(data?.error?.message ?? 'The island could not be reached. Try again shortly.') as Error & { code?: string };
    error.code = data?.error?.code;
    if (error.code === 'account_session_ended') { try { localStorage.removeItem(ACCOUNT_KEY); } catch { /* ignore */ } }
    throw error;
  }
  return data as T;
}

/** Saving sends the visit renewal token as proof and the character token to seal. */
function credentials(intent: Intent): { auth: string | null; token?: string } {
  if (intent === 'login') return { auth: null };
  if (intent === 'add') {
    const token = accountToken();
    if (!token) throw new Error('Log in to your account first.');
    return { auth: token };
  }
  const renew = read(renewKey(TOKEN_KEY)), token = read(TOKEN_KEY);
  if (!renew || !RENEW_TOKEN.test(renew) || !token) throw new Error('Enter the island before saving your character.');
  return { auth: renew, token };
}

function signedIn(result: { accountToken: string; account: Account }): Account {
  if (!ACCOUNT_TOKEN.test(result.accountToken)) throw new Error('The island returned an invalid sign-in.');
  localStorage.setItem(ACCOUNT_KEY, result.accountToken);
  return result.account;
}

export const providers = () => call<Providers>('/providers', { method: 'GET' });
export const profile = () => call<Account>('', { method: 'GET', auth: accountToken() });

export async function startOAuth(provider: 'discord' | 'google', intent: Intent): Promise<never> {
  const { auth, token } = credentials(intent);
  const { url } = await call<{ url: string }>('/oauth/start', { auth, body: { provider, ...(token ? { token } : {}) } });
  sessionStorage.setItem(OAUTH_INTENT_KEY, intent);
  window.location.assign(url);
  return new Promise<never>(() => {});
}
/** Called when Discord/Google sends the player back to `/#account`. */
export async function finishOAuth(): Promise<{ intent: Intent; account: Account }> {
  const intent = (sessionStorage.getItem(OAUTH_INTENT_KEY) ?? 'login') as Intent;
  sessionStorage.removeItem(OAUTH_INTENT_KEY);
  return { intent, account: signedIn(await call('/oauth/finish')) };
}

export async function startEmail(email: string, intent: Intent): Promise<string> {
  const { auth, token } = credentials(intent);
  const { requestId } = await call<{ requestId: string }>('/email/start', { auth, body: { email, ...(token ? { token } : {}) } });
  // The emailed link may open in another tab of this browser; remember why it was sent.
  try { localStorage.setItem(`${EMAIL_INTENT_KEY}:${requestId}`, intent); } catch { /* the code still works here */ }
  return requestId;
}
/** An email opened on another browser is a login there. */
export async function verifyEmail(requestId: string, code: string): Promise<{ intent: Intent; account: Account }> {
  const account = signedIn(await call('/email/verify', { body: { requestId, code } }));
  const intent = (read(`${EMAIL_INTENT_KEY}:${requestId}`) ?? 'login') as Intent;
  try { localStorage.removeItem(`${EMAIL_INTENT_KEY}:${requestId}`); } catch { /* ignore */ }
  return { intent, account };
}

export async function withPasskey(intent: Intent): Promise<Account> {
  const { auth, token } = credentials(intent);
  const mode = intent === 'login' ? 'login' : 'register';
  const { challengeId, options } = await call<{ challengeId: string; options: any }>('/passkey/options', { auth, body: { mode, ...(token ? { token } : {}) } });
  let response;
  try {
    response = mode === 'login' ? await startAuthentication({ optionsJSON: options }) : await startRegistration({ optionsJSON: options });
  } catch (error) {
    throw new Error(error instanceof Error && error.name === 'NotAllowedError' ? 'The passkey prompt was closed.' : 'This browser could not use a passkey.');
  }
  return signedIn(await call('/passkey/verify', { body: { challengeId, response: JSON.stringify(response) } }));
}

export const removeLogin = (id: string) => call<Account>('/logins/remove', { auth: accountToken(), body: { id } });

/**
 * Loads the account's character into this browser. When it is already the
 * character here, only the visit renewal is replaced (another device had taken
 * it over) and the caller renews; otherwise the guest is replaced and the page reloads.
 */
export async function playAccountCharacter(): Promise<'renew'> {
  const result = await call<{ token: string; uri: string; database: string; renewToken: string }>('/play', { auth: accountToken() });
  if (result.uri !== SPACETIME_URI || result.database !== SPACETIME_DB || !RENEW_TOKEN.test(result.renewToken)) throw new Error('This account has no character in this world.');
  const same = read(TOKEN_KEY) === result.token;
  localStorage.setItem(TOKEN_KEY, result.token);
  localStorage.setItem(renewKey(TOKEN_KEY), result.renewToken);
  localStorage.setItem(expiryKey(TOKEN_KEY), '0');
  if (same) return 'renew';
  window.location.reload();
  return new Promise<never>(() => {});
}

/** Forgets the account and its character on this browser only. */
export async function logOut(): Promise<void> {
  const token = accountToken();
  if (token) await call('/logout', { auth: token }).catch(() => undefined);
  for (const key of [ACCOUNT_KEY, TOKEN_KEY, renewKey(TOKEN_KEY), expiryKey(TOKEN_KEY)]) localStorage.removeItem(key);
  window.location.reload();
}

/**
 * Finishes a login that returned to this page: `#account` after Discord/Google,
 * or `#login=<request>.<code>` from an email link. Returns what happened, if anything.
 */
export async function completeReturningLogin(): Promise<{ intent: Intent; account: Account } | null> {
  const hash = window.location.hash;
  const email = /^#login=(bge_[A-Za-z0-9_-]{43})\.([0-9]{6})$/.exec(hash);
  if (hash !== '#account' && !email) return null;
  history.replaceState(null, '', window.location.pathname);
  if (email) return verifyEmail(email[1], email[2]);
  return finishOAuth();
}
