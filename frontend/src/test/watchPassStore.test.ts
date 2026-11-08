import { describe, expect, it } from 'vitest';
import { keepPass, keptPass } from '../watch/passStore';

function memory() {
  const map = new Map<string, string>();
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v); }, removeItem: (k: string) => { map.delete(k); }, map };
}
const NOW = Date.parse('2026-11-08T00:00:00Z');
const pass = (hoursLeft: number) => ({ token: 't', uri: 'wss://db', database: 'world', expiresAt: new Date(NOW + hoursLeft * 3600_000).toISOString() });

describe('the watch pass kept across reloads', () => {
  it('reuses a kept pass per world while it has more than the renewal margin left', () => {
    const store = memory();
    keepPass('https://beta.berigame.com', pass(40), store);
    expect(keptPass('https://beta.berigame.com', 12 * 3600_000, NOW, store)?.token).toBe('t');
    expect(keptPass('https://other.example', 12 * 3600_000, NOW, store)).toBeNull();
  });

  it('drops a pass that is close to expiry, malformed, or refused', () => {
    const store = memory();
    keepPass('w', pass(11), store);
    expect(keptPass('w', 12 * 3600_000, NOW, store)).toBeNull();
    store.setItem('berigame.watchPass:w', '{not json');
    expect(keptPass('w', 0, NOW, store)).toBeNull();
    keepPass('w', pass(40), store);
    keepPass('w', null, store);
    expect(store.map.size).toBe(0);
    expect(keptPass('w', 0, NOW, null)).toBeNull();
  });
});
