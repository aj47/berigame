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

export type RenewalOutcome = 'renewed' | 'fresh' | 'ended' | 'unavailable';
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
  storage: Storage; tokenKey: string; fetch: typeof fetch; locks?: LockManager; now?: () => number;
}): Promise<RenewalOutcome> {
  const { storage, tokenKey } = opts;
  const now = opts.now ?? Date.now;
  const attempt = async (): Promise<RenewalOutcome> => {
    if (savedExpiry(storage, tokenKey) - RENEW_MARGIN_MS > now()) return 'fresh';
    if (!canRenew(storage, tokenKey)) return 'ended';
    const presented = storage.getItem(renewKey(tokenKey))!;
    let response: Response;
    let body: any;
    try {
      response = await opts.fetch('/api/play/v1/renewals', { method: 'POST', cache: 'no-store', body: '{}',
        headers: { Authorization: `Bearer ${presented}`, 'Content-Type': 'application/json' } });
      body = await response.json().catch(() => undefined);
    } catch { return 'unavailable'; }
    if (response.ok) {
      const expiresAt = Date.parse(body?.expiresAt);
      if (typeof body?.renewToken !== 'string' || !RENEW_TOKEN.test(body.renewToken) || !(expiresAt > now())) return 'unavailable';
      storage.setItem(renewKey(tokenKey), body.renewToken);
      storage.setItem(expiryKey(tokenKey), String(expiresAt));
      return 'renewed';
    }
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
    return 'unavailable';
  };
  try {
    return opts.locks ? await opts.locks.request('berigame-visit-renewal', attempt) : await attempt();
  } catch { return 'unavailable'; }
}
