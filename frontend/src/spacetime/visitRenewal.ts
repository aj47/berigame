/**
 * Returning-browser identity (roadmap F1). A player invite yields a SpacetimeDB
 * token (the character) plus a rotating renewal token. Before the one-hour
 * permit ends, the browser trades the renewal token for a fresh permit on the
 * same character. Tokens live only in this browser's scoped localStorage and
 * are never logged. Clearing storage simply makes the next visit a new guest.
 */
export const RENEW_TOKEN = /^bgr_[A-Za-z0-9_-]{43}$/;
/** Renew this long before the permit ends, so a playing tab never drops. */
export const RENEW_MARGIN_MS = 5 * 60_000;
export const RETRY_MS = 30_000;

export const expiryKey = (tokenKey: string) => `${tokenKey}:permit-expires`;
export const renewKey = (tokenKey: string) => `${tokenKey}:renew`;

export type AdmissionIssue = { message: string; retryAt: number };
export function admissionIssue(response: Response, body: any, now = Date.now(), random = Math.random): AdmissionIssue {
  const header = response.headers?.get('Retry-After');
  const seconds = header ? Number(header) : NaN;
  const delay = header && !Number.isFinite(seconds) ? Date.parse(header) - now : seconds * 1000;
  const messages: Record<string, string> = {
    rate_limited: 'Too many attempts in a short time. Wait for the countdown before trying again.',
    session_capacity: 'The island has reached its player limit. Try again after a player leaves.',
    world_full: 'This world is full. You can return when a player leaves.',
    agent_capacity: 'All agent connections are in use. Try again after an agent session ends.',
    join_busy: 'Several players are joining at once. Try again in a moment.',
    visit_capacity: 'The sign-in service is busy. Try again shortly.',
    character_capacity: 'This world cannot create more characters right now. You can still return with an existing character.',
    daily_capacity: 'The island has reached its daily request limit. Please return later.',
    renewal_capacity: 'The island has reached its returning-player limit. Please try again later.',
  };
  return { message: messages[body?.error?.code] ?? (response.status === 429
    ? 'The island is busy. Please wait before trying again.'
    : 'The island could not be reached. We will try again shortly.'),
    retryAt: now + Math.max(1000, Number.isFinite(delay) ? delay : response.status === 429 ? 60_000 : RETRY_MS) + Math.floor(random() * 5000) };
}
const retryKey = (key: string) => `${key}:renew-retry`;

export type RenewalOutcome = 'renewed' | 'fresh' | 'ended' | 'idle' | 'unavailable';

/**
 * The world took this browser's character offline while its socket stayed
 * open (an idle logout or an ended permit). BetaAdmission listens, drops the
 * saved permit and asks the gateway what happened.
 */
const signedOutListeners = new Set<() => void>();
export function onSignedOut(listener: () => void): () => void {
  signedOutListeners.add(listener);
  return () => { signedOutListeners.delete(listener); };
}
export function reportSignedOut(): void { for (const listener of [...signedOutListeners]) listener(); }
type LockManager = { request<T>(name: string, fn: () => Promise<T>): Promise<T> };

export function savedExpiry(storage: Storage, tokenKey: string): number {
  try { return storage.getItem(tokenKey) ? Number(storage.getItem(expiryKey(tokenKey))) || 0 : 0; }
  catch { return 0; }
}

export function canRenew(storage: Storage, tokenKey: string): boolean {
  try { return !!storage.getItem(tokenKey) && RENEW_TOKEN.test(storage.getItem(renewKey(tokenKey)) ?? ''); }
  catch { return false; }
}

/** When to attempt the next renewal, relative to now (0 = immediately). */
export function renewalDelay(expiry: number, now: number): number {
  return Math.max(0, expiry - RENEW_MARGIN_MS - now);
}

/**
 * Renews the saved visit. Tabs serialize through a Web Lock and re-read storage
 * inside it, so one tab renews and the others adopt its result.
 */
export async function renewVisit(opts: {
  storage: Storage; tokenKey: string; fetch: typeof fetch; locks?: LockManager; now?: () => number; onIssue?: (issue: AdmissionIssue) => void;
  /** The player chose to return after an idle logout. */
  resume?: boolean;
}): Promise<RenewalOutcome> {
  const { storage, tokenKey } = opts;
  const now = opts.now ?? Date.now;
  const attempt = async (): Promise<RenewalOutcome> => {
    if (savedExpiry(storage, tokenKey) - RENEW_MARGIN_MS > now()) return 'fresh';
    if (!canRenew(storage, tokenKey)) return 'ended';
    const savedRetry = storage.getItem(retryKey(tokenKey));
    if (savedRetry) {
      try {
        const issue = JSON.parse(savedRetry) as AdmissionIssue;
        if (issue.retryAt > now()) { opts.onIssue?.(issue); return 'unavailable'; }
      } catch { /* Ignore malformed saved cooldowns. */ }
    }
    const presented = storage.getItem(renewKey(tokenKey))!;
    let response: Response;
    let body: any;
    try {
      response = await opts.fetch('/api/play/v1/renewals', { method: 'POST', cache: 'no-store', body: opts.resume ? '{"resume":true}' : '{}',
        headers: { Authorization: `Bearer ${presented}`, 'Content-Type': 'application/json' } });
      body = await response.json().catch(() => undefined);
    } catch { return 'unavailable'; }
    if (response.ok) {
      const expiresAt = Date.parse(body?.expiresAt);
      if (typeof body?.renewToken !== 'string' || !RENEW_TOKEN.test(body.renewToken) || !(expiresAt > now())) return 'unavailable';
      storage.removeItem(retryKey(tokenKey));
      storage.setItem(renewKey(tokenKey), body.renewToken);
      storage.setItem(expiryKey(tokenKey), String(expiresAt));
      return 'renewed';
    }
    // Logged out for inactivity: the renewal token stays valid, but only the player can choose to return.
    if (response.status === 409 && body?.error?.code === 'idle_logout') return 'idle';
    if (response.status === 409) {
      // Another tab (or a browser without Web Locks) won the race; adopt its result.
      return storage.getItem(renewKey(tokenKey)) !== presented && savedExpiry(storage, tokenKey) > now() ? 'fresh' : 'unavailable';
    }
    if (response.status === 401) {
      // Only drop the token if no other tab replaced it meanwhile.
      if (storage.getItem(renewKey(tokenKey)) === presented) {
        storage.removeItem(renewKey(tokenKey));
        storage.removeItem(expiryKey(tokenKey));
      }
      return 'ended';
    }
    const issue = admissionIssue(response, body, now());
    storage.setItem(retryKey(tokenKey), JSON.stringify(issue));
    opts.onIssue?.(issue);
    return 'unavailable';
  };
  try {
    return opts.locks ? await opts.locks.request('berigame-visit-renewal', attempt) : await attempt();
  } catch { return 'unavailable'; }
}
