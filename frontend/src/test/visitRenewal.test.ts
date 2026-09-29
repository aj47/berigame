import { beforeEach, describe, expect, it, vi } from 'vitest';
import { canRenew, expiryKey, renewalDelay, renewKey, renewVisit, RENEW_MARGIN_MS, savedExpiry } from '../spacetime/visitRenewal';

const entries = new Map<string, string>();
const storage: Storage = {
  get length() { return entries.size; },
  clear: () => entries.clear(),
  getItem: (key) => entries.get(key) ?? null,
  setItem: (key, value) => { entries.set(key, value); },
  removeItem: (key) => { entries.delete(key); },
  key: (index) => [...entries.keys()][index] ?? null,
};
const KEY = 'berigame_stdb_token:v2:wss%3A%2F%2Fexample:berigame-beta';
const NOW = 1_000_000_000_000;
const token = (c: string) => 'bgr_' + c.repeat(43);
const reply = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status }));
const saved = (expiry: number) => {
  storage.setItem(KEY, 'stdb-character-token');
  storage.setItem(renewKey(KEY), token('a'));
  storage.setItem(expiryKey(KEY), String(expiry));
};
const run = (fetch: any, locks?: any) => renewVisit({ storage, tokenKey: KEY, fetch, locks, now: () => NOW });

beforeEach(() => storage.clear());
describe('returning-browser visit renewal', () => {
  it('renews an ended visit, rotates the token and keeps the same character token', async () => {
    saved(NOW - 1);
    const fetch = reply(200, { renewToken: token('b'), expiresAt: new Date(NOW + 3600_000).toISOString() });
    expect(await run(fetch)).toBe('renewed');
    const [url, init] = fetch.mock.calls[0] as any;
    expect(url).toBe('/api/play/v1/renewals');
    expect(init.headers.Authorization).toBe(`Bearer ${token('a')}`);
    expect(storage.getItem(renewKey(KEY))).toBe(token('b'));
    expect(storage.getItem(KEY)).toBe('stdb-character-token');
    expect(savedExpiry(storage, KEY)).toBe(NOW + 3600_000);
  });

  it('does nothing while the permit is fresh (another tab already renewed)', async () => {
    saved(NOW + RENEW_MARGIN_MS + 1000);
    const fetch = reply(200, {});
    expect(await run(fetch)).toBe('fresh');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('serializes tabs through a Web Lock', async () => {
    saved(NOW - 1);
    const request = vi.fn(async (_name: string, fn: () => Promise<unknown>) => fn());
    await run(reply(200, { renewToken: token('b'), expiresAt: new Date(NOW + 3600_000).toISOString() }), { request });
    expect(request).toHaveBeenCalledWith('berigame-visit-renewal', expect.any(Function));
  });

  it('adopts a racing tab result on 409', async () => {
    saved(NOW - 1);
    const fetch = vi.fn(async () => {
      storage.setItem(renewKey(KEY), token('c'));
      storage.setItem(expiryKey(KEY), String(NOW + 3600_000));
      return new Response('{}', { status: 409 });
    });
    expect(await run(fetch)).toBe('fresh');
    expect(storage.getItem(renewKey(KEY))).toBe(token('c'));
  });

  it('a revoked or expired sign-in ends: the browser becomes a new guest on its next invite', async () => {
    saved(NOW - 1);
    expect(await run(reply(401, { error: { code: 'visit_ended' } }))).toBe('ended');
    expect(storage.getItem(renewKey(KEY))).toBeNull();
    expect(canRenew(storage, KEY)).toBe(false);
  });

  it('keeps the token on network errors and malformed replies', async () => {
    saved(NOW - 1);
    expect(await run(vi.fn(async () => { throw new TypeError('offline'); }))).toBe('unavailable');
    expect(await run(reply(200, { renewToken: 'nope', expiresAt: new Date(NOW + 1).toISOString() }))).toBe('unavailable');
    expect(await run(reply(503, {}))).toBe('unavailable');
    expect(storage.getItem(renewKey(KEY))).toBe(token('a'));
  });

  it('cleared storage cannot renew', async () => {
    const fetch = reply(200, {});
    expect(await run(fetch)).toBe('ended');
    expect(fetch).not.toHaveBeenCalled();
    storage.setItem(renewKey(KEY), token('a')); // renewal without its character token
    expect(canRenew(storage, KEY)).toBe(false);
  });

  it('schedules renewal ahead of expiry', () => {
    expect(renewalDelay(NOW + 3600_000, NOW)).toBe(3600_000 - RENEW_MARGIN_MS);
    expect(renewalDelay(NOW - 5, NOW)).toBe(0);
  });
});
